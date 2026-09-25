-- Admins are a fixed list of email addresses kept in the database, not "whoever signed in
-- first" and not something the app can change. Admins see every envelope and can void,
-- resend, finish or delete (drafts) any of them; everyone else sees what they send and what
-- is sent to them.

create table private.admin_emails (
  email text primary key check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+$')
);
comment on table private.admin_emails is 'The only accounts with the admin role. Change with a migration.';
revoke all on private.admin_emails from public, anon, authenticated;
insert into private.admin_emails (email) values ('devantew@flmlnk.com'), ('sara.s@flmlnk.com');

-- profiles.role always follows the list: set on every insert and on any change to email or role
create function private.sync_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.role := case
    when exists (select 1 from private.admin_emails a where a.email = lower(btrim(new.email))) then 'admin'
    else 'member'
  end;
  return new;
end;
$$;
revoke all on function private.sync_profile_role() from public, anon, authenticated;

create trigger sync_profile_role
before insert or update of email, role on public.profiles
for each row execute function private.sync_profile_role();

update public.profiles set role = role;

-- New accounts: the trigger decides the role
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  email_domain text := lower(split_part(new.email, '@', 2));
begin
  if exists (select 1 from private.allowed_email_domains)
     and not exists (select 1 from private.allowed_email_domains where domain = email_domain) then
    raise exception 'Sign-ups are limited to approved email domains';
  end if;

  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'));
  return new;
end;
$$;

-- Roles are no longer changed from the app
drop function public.set_user_role(uuid, text);
drop function private.set_user_role(uuid, text);

-- Admins may delete anyone's unsent draft (and its document)
create function private.can_delete_draft(p_envelope_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.envelopes e
    where e.id = p_envelope_id and e.status = 'draft'
      and (e.owner_id = (select auth.uid()) or private.is_admin())
  );
$$;
revoke all on function private.can_delete_draft(uuid) from public, anon;
grant execute on function private.can_delete_draft(uuid) to authenticated;

drop policy "Delete own draft envelopes" on public.envelopes;
create policy "Delete own drafts, or any draft as admin" on public.envelopes
for delete to authenticated
using (status = 'draft' and (owner_id = (select auth.uid()) or (select private.is_admin())));

drop policy "Delete original of own draft" on storage.objects;
create policy "Delete original of a deletable draft" on storage.objects
for delete to authenticated
using (
  bucket_id = 'documents' and storage.filename(name) = 'original.pdf'
  and private.can_delete_draft(private.try_uuid((storage.foldername(name))[1]))
);

-- Resending a signing link: the sender or an admin (recorded as the one who resent it)
create or replace function public.svc_reissue_signing_link(p_envelope_id uuid, p_owner_id uuid, p_recipient_id uuid)
returns table(recipient_id uuid, name text, email text, token text)
language plpgsql
set search_path = ''
as $$
declare
  env public.envelopes;
  r public.recipients;
begin
  select * into env from public.envelopes where id = p_envelope_id for update;
  if not found or (env.owner_id <> p_owner_id
                   and not exists (select 1 from public.profiles p where p.id = p_owner_id and p.role = 'admin')) then
    raise exception 'Envelope not found' using errcode = 'P0002';
  end if;
  if env.status <> 'sent' then
    raise exception 'This envelope is no longer out for signature' using errcode = '55000';
  end if;
  if env.expires_at is not null and env.expires_at <= now() then
    raise exception 'This envelope has expired; void it and send a new one' using errcode = '55000';
  end if;
  select * into r from public.recipients rc where rc.id = p_recipient_id and rc.envelope_id = env.id and rc.role = 'signer';
  if not found then
    raise exception 'Recipient not found' using errcode = 'P0002';
  end if;
  if r.status not in ('sent', 'viewed') then
    raise exception '% is not waiting to sign', r.name using errcode = '55000';
  end if;

  update public.recipients set last_reminded_at = now() where id = r.id;
  insert into public.audit_events (envelope_id, recipient_id, actor_user_id, action, details)
  values (env.id, r.id, p_owner_id, 'recipient_reminded', jsonb_build_object('email', r.email));

  recipient_id := r.id; name := r.name; email := r.email;
  token := private.new_signing_token(r.id, env.expires_at);
  return next;
end;
$$;
