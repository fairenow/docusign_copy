-- DocSign initial schema: envelopes, recipients, fields, audit trail, templates.
--
-- Access model
--   * Team members sign in with Supabase Auth (restricted to allowed email domains).
--   * Owners manage their own envelopes; admins can see everything.
--   * A team member listed as a recipient can see an envelope once it has been sent.
--   * External signers never get a database session: they use a signing link whose
--     token is verified by an Edge Function running with the service role.
--   * Envelopes are editable only while in 'draft'. Status transitions after that
--     happen through Edge Functions / security-definer RPCs, never direct updates.
--   * The audit trail is append-only from the client's point of view.

-------------------------------------------------------------------------------
-- Private schema for helpers (not exposed through the Data API)
-------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- Sign-ups are limited to these email domains. Leave empty to allow any domain.
create table private.allowed_email_domains (
  domain text primary key check (domain = lower(domain))
);
insert into private.allowed_email_domains (domain) values ('flmlnk.com');

-------------------------------------------------------------------------------
-- Tables
-------------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text check (char_length(full_name) <= 200),
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Team members (one per auth user).';

create table public.envelopes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  message text check (char_length(message) <= 5000),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'completed', 'declined', 'voided')),
  signing_order text not null default 'sequential'
    check (signing_order in ('sequential', 'parallel')),
  original_filename text check (char_length(original_filename) <= 255),
  original_path text,
  original_sha256 text check (original_sha256 ~ '^[0-9a-f]{64}$'),
  page_count integer check (page_count > 0),
  final_path text,
  final_sha256 text check (final_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  voided_at timestamptz,
  void_reason text check (char_length(void_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.envelopes is 'A document sent out for signature.';

create table public.recipients (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.envelopes (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 320),
  role text not null default 'signer' check (role in ('signer', 'cc')),
  routing_order integer not null default 1 check (routing_order >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'viewed', 'signed', 'declined')),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  sent_at timestamptz,
  viewed_at timestamptz,
  consented_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  decline_reason text check (char_length(decline_reason) <= 1000),
  signer_ip inet,
  signer_user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, envelope_id)
);
create unique index recipients_envelope_email_key on public.recipients (envelope_id, lower(email));
comment on table public.recipients is 'Signers and CC recipients of an envelope.';

-- Signing-link tokens. Only a SHA-256 hash is stored; the raw token exists only in the email.
-- No policies: readable and writable by the service role only.
create table public.recipient_tokens (
  recipient_id uuid primary key references public.recipients (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.fields (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null,
  recipient_id uuid not null,
  page integer not null check (page >= 1),
  type text not null check (type in ('signature', 'initials', 'text', 'date', 'checkbox')),
  -- Position and size as fractions of the displayed page (see src/lib/fields.js)
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),
  w double precision not null check (w > 0 and w <= 1),
  h double precision not null check (h > 0 and h <= 1),
  required boolean not null default true,
  label text check (char_length(label) <= 200),
  font_size real not null default 12 check (font_size between 4 and 72),
  value text check (char_length(value) <= 2000),
  filled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The assigned recipient must belong to the same envelope
  foreign key (recipient_id, envelope_id) references public.recipients (id, envelope_id) on delete cascade,
  foreign key (envelope_id) references public.envelopes (id) on delete cascade
);
comment on table public.fields is 'Fields placed on an envelope, each assigned to one recipient.';

create table public.audit_events (
  id bigint generated always as identity primary key,
  envelope_id uuid not null references public.envelopes (id) on delete cascade,
  recipient_id uuid references public.recipients (id) on delete set null,
  actor_user_id uuid references public.profiles (id) on delete set null,
  action text not null check (char_length(action) <= 64),
  ip inet,
  user_agent text,
  doc_sha256 text check (doc_sha256 ~ '^[0-9a-f]{64}$'),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
comment on table public.audit_events is 'Append-only audit trail used for the certificate of completion.';

create table public.templates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  description text check (char_length(description) <= 2000),
  original_filename text check (char_length(original_filename) <= 255),
  file_path text,
  page_count integer check (page_count > 0),
  shared boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.templates is 'Reusable documents with fields assigned to roles instead of people.';

create table public.template_roles (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  routing_order integer not null default 1 check (routing_order >= 1),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  unique (id, template_id)
);

create table public.template_fields (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.templates (id) on delete cascade,
  role_id uuid not null,
  page integer not null check (page >= 1),
  type text not null check (type in ('signature', 'initials', 'text', 'date', 'checkbox')),
  x double precision not null check (x >= 0 and x <= 1),
  y double precision not null check (y >= 0 and y <= 1),
  w double precision not null check (w > 0 and w <= 1),
  h double precision not null check (h > 0 and h <= 1),
  required boolean not null default true,
  label text check (char_length(label) <= 200),
  font_size real not null default 12 check (font_size between 4 and 72),
  foreign key (role_id, template_id) references public.template_roles (id, template_id) on delete cascade
);

-------------------------------------------------------------------------------
-- Indexes (foreign keys and common filters)
-------------------------------------------------------------------------------
create index envelopes_owner_id_idx on public.envelopes (owner_id);
create index envelopes_status_idx on public.envelopes (status);
create index recipients_envelope_id_idx on public.recipients (envelope_id);
create index recipients_email_idx on public.recipients (lower(email));
create index fields_envelope_id_idx on public.fields (envelope_id);
create index fields_recipient_id_idx on public.fields (recipient_id, envelope_id);
create index audit_events_envelope_id_idx on public.audit_events (envelope_id, created_at);
create index audit_events_recipient_id_idx on public.audit_events (recipient_id);
create index audit_events_actor_user_id_idx on public.audit_events (actor_user_id);
create index templates_owner_id_idx on public.templates (owner_id);
create index template_roles_template_id_idx on public.template_roles (template_id);
create index template_fields_template_id_idx on public.template_fields (template_id);
create index template_fields_role_id_idx on public.template_fields (role_id, template_id);

-------------------------------------------------------------------------------
-- Helper functions (security definer so policies can use them without recursion)
-------------------------------------------------------------------------------
create function private.try_uuid(value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return value::uuid;
exception when others then
  return null;
end;
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

create function private.owns_envelope(envelope uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.envelopes
    where id = envelope and owner_id = (select auth.uid())
  );
$$;

create function private.is_draft_owner(envelope uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.envelopes
    where id = envelope and owner_id = (select auth.uid()) and status = 'draft'
  );
$$;

create function private.can_view_envelope(envelope uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.envelopes e
    where e.id = envelope
      and (
        e.owner_id = (select auth.uid())
        or private.is_admin()
        or (
          e.status <> 'draft'
          and exists (
            select 1 from public.recipients r
            where r.envelope_id = e.id
              and lower(r.email) = lower((select auth.jwt() ->> 'email'))
          )
        )
      )
  );
$$;

create function private.can_view_template(template uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.templates
    where id = template
      and (shared or owner_id = (select auth.uid()) or private.is_admin())
  );
$$;

create function private.can_edit_template(template uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.templates
    where id = template
      and (owner_id = (select auth.uid()) or private.is_admin())
  );
$$;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

-------------------------------------------------------------------------------
-- Triggers
-------------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.envelopes
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.recipients
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.fields
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.templates
  for each row execute function private.set_updated_at();

-- Create a profile for each new auth user; enforce the allowed-domain list.
-- The first user to sign up becomes an admin.
create function private.handle_new_user()
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

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when exists (select 1 from public.profiles) then 'member' else 'admin' end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Keep profile email in sync with auth
create function private.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.handle_user_email_change();

-- Record envelope lifecycle events in the audit trail
create function private.audit_envelope_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_events (envelope_id, actor_user_id, action)
    values (new.id, (select auth.uid()), 'envelope_created');
  elsif new.status is distinct from old.status then
    insert into public.audit_events (envelope_id, actor_user_id, action, doc_sha256, details)
    values (
      new.id,
      (select auth.uid()),
      'envelope_' || new.status,
      coalesce(new.final_sha256, new.original_sha256),
      jsonb_build_object('from', old.status, 'to', new.status)
        || case when new.void_reason is not null then jsonb_build_object('reason', new.void_reason) else '{}'::jsonb end
    );
  end if;
  return new;
end;
$$;

create trigger audit_envelope_change
  after insert or update of status on public.envelopes
  for each row execute function private.audit_envelope_change();

-------------------------------------------------------------------------------
-- Row level security
-------------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.envelopes enable row level security;
alter table public.recipients enable row level security;
alter table public.recipient_tokens enable row level security;
alter table public.fields enable row level security;
alter table public.audit_events enable row level security;
alter table public.templates enable row level security;
alter table public.template_roles enable row level security;
alter table public.template_fields enable row level security;

-- Nothing is available without signing in (external signers go through Edge Functions)
revoke all on all tables in schema public from anon;
revoke all on public.recipient_tokens from authenticated;

-- profiles: team directory is visible to the team; users may edit their own name only
create policy "Team members can view profiles" on public.profiles
  for select to authenticated using (true);
create policy "Users can update their own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- envelopes
create policy "View own, admin, or addressed envelopes" on public.envelopes
  for select to authenticated using (private.can_view_envelope(id));
create policy "Create draft envelopes" on public.envelopes
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and status = 'draft');
create policy "Edit own draft envelopes" on public.envelopes
  for update to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft')
  with check (owner_id = (select auth.uid()) and status = 'draft');
create policy "Delete own draft envelopes" on public.envelopes
  for delete to authenticated
  using (owner_id = (select auth.uid()) and status = 'draft');
revoke insert, update on public.envelopes from authenticated;
grant insert (title, message, signing_order, original_filename, original_path, page_count, expires_at)
  on public.envelopes to authenticated;
grant update (title, message, signing_order, original_filename, original_path, page_count, expires_at)
  on public.envelopes to authenticated;

-- recipients
create policy "View recipients of visible envelopes" on public.recipients
  for select to authenticated using (private.can_view_envelope(envelope_id));
create policy "Add recipients to own drafts" on public.recipients
  for insert to authenticated with check (private.is_draft_owner(envelope_id));
create policy "Edit recipients of own drafts" on public.recipients
  for update to authenticated
  using (private.is_draft_owner(envelope_id))
  with check (private.is_draft_owner(envelope_id));
create policy "Remove recipients from own drafts" on public.recipients
  for delete to authenticated using (private.is_draft_owner(envelope_id));
revoke insert, update on public.recipients from authenticated;
grant insert (envelope_id, name, email, role, routing_order, color) on public.recipients to authenticated;
grant update (name, email, role, routing_order, color) on public.recipients to authenticated;

-- fields
create policy "View fields of visible envelopes" on public.fields
  for select to authenticated using (private.can_view_envelope(envelope_id));
create policy "Add fields to own drafts" on public.fields
  for insert to authenticated with check (private.is_draft_owner(envelope_id));
create policy "Edit fields of own drafts" on public.fields
  for update to authenticated
  using (private.is_draft_owner(envelope_id))
  with check (private.is_draft_owner(envelope_id));
create policy "Remove fields from own drafts" on public.fields
  for delete to authenticated using (private.is_draft_owner(envelope_id));
revoke insert, update on public.fields from authenticated;
grant insert (envelope_id, recipient_id, page, type, x, y, w, h, required, label, font_size)
  on public.fields to authenticated;
grant update (recipient_id, page, type, x, y, w, h, required, label, font_size)
  on public.fields to authenticated;

-- audit_events: read-only for clients
create policy "View audit trail of visible envelopes" on public.audit_events
  for select to authenticated using (private.can_view_envelope(envelope_id));
revoke insert, update, delete, truncate on public.audit_events from authenticated;

-- templates
create policy "View shared or own templates" on public.templates
  for select to authenticated
  using (shared or owner_id = (select auth.uid()) or private.is_admin());
create policy "Create templates" on public.templates
  for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Edit own templates" on public.templates
  for update to authenticated
  using (owner_id = (select auth.uid()) or private.is_admin())
  with check (owner_id = (select auth.uid()) or private.is_admin());
create policy "Delete own templates" on public.templates
  for delete to authenticated
  using (owner_id = (select auth.uid()) or private.is_admin());

create policy "View roles of visible templates" on public.template_roles
  for select to authenticated using (private.can_view_template(template_id));
create policy "Manage roles of own templates" on public.template_roles
  for all to authenticated
  using (private.can_edit_template(template_id))
  with check (private.can_edit_template(template_id));

create policy "View fields of visible templates" on public.template_fields
  for select to authenticated using (private.can_view_template(template_id));
create policy "Manage fields of own templates" on public.template_fields
  for all to authenticated
  using (private.can_edit_template(template_id))
  with check (private.can_edit_template(template_id));

-------------------------------------------------------------------------------
-- RPCs
-------------------------------------------------------------------------------
-- Void a sent envelope (owner or admin). Invalidates all signing links.
create function public.void_envelope(envelope_id uuid, reason text default null)
returns public.envelopes
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.envelopes;
begin
  select * into result from public.envelopes e where e.id = void_envelope.envelope_id for update;
  if not found or not (result.owner_id = (select auth.uid()) or private.is_admin()) then
    raise exception 'Envelope not found' using errcode = 'P0002';
  end if;
  if result.status <> 'sent' then
    raise exception 'Only envelopes that are out for signature can be voided (status is %)', result.status;
  end if;

  delete from public.recipient_tokens t
  using public.recipients r
  where t.recipient_id = r.id and r.envelope_id = void_envelope.envelope_id;

  update public.envelopes e
  set status = 'voided', voided_at = now(), void_reason = left(reason, 1000)
  where e.id = void_envelope.envelope_id
  returning * into result;

  return result;
end;
$$;

-- Change a team member's role (admin only)
create function public.set_user_role(user_id uuid, new_role text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.profiles;
begin
  if not private.is_admin() then
    raise exception 'Only admins can change roles' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'member') then
    raise exception 'Invalid role: %', new_role;
  end if;
  if user_id = (select auth.uid()) and new_role <> 'admin' then
    raise exception 'Admins cannot demote themselves';
  end if;

  update public.profiles p set role = new_role where p.id = set_user_role.user_id
  returning * into result;
  return result;
end;
$$;

revoke all on function public.void_envelope(uuid, text) from public, anon;
revoke all on function public.set_user_role(uuid, text) from public, anon;
grant execute on function public.void_envelope(uuid, text) to authenticated;
grant execute on function public.set_user_role(uuid, text) to authenticated;

-------------------------------------------------------------------------------
-- Storage
-------------------------------------------------------------------------------
-- documents/<envelope_id>/original.pdf   uploaded by the owner while drafting
-- documents/<envelope_id>/signed.pdf     written by the finalize Edge Function
-- templates/<template_id>/original.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 52428800, array['application/pdf']),
  ('templates', 'templates', false, 52428800, array['application/pdf']);

create policy "Read documents of visible envelopes" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and private.can_view_envelope(private.try_uuid((storage.foldername(name))[1]))
  );
create policy "Upload original to own draft" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and storage.filename(name) = 'original.pdf'
    and private.is_draft_owner(private.try_uuid((storage.foldername(name))[1]))
  );
create policy "Replace original of own draft" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and storage.filename(name) = 'original.pdf'
    and private.is_draft_owner(private.try_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'documents'
    and storage.filename(name) = 'original.pdf'
    and private.is_draft_owner(private.try_uuid((storage.foldername(name))[1]))
  );
create policy "Delete original of own draft" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and private.is_draft_owner(private.try_uuid((storage.foldername(name))[1]))
  );

create policy "Read files of visible templates" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'templates'
    and private.can_view_template(private.try_uuid((storage.foldername(name))[1]))
  );
create policy "Upload files to own templates" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'templates'
    and private.can_edit_template(private.try_uuid((storage.foldername(name))[1]))
  );
create policy "Replace files of own templates" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'templates'
    and private.can_edit_template(private.try_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id = 'templates'
    and private.can_edit_template(private.try_uuid((storage.foldername(name))[1]))
  );
create policy "Delete files of own templates" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'templates'
    and private.can_edit_template(private.try_uuid((storage.foldername(name))[1]))
  );

-------------------------------------------------------------------------------
-- Realtime (dashboard updates live as recipients view and sign)
-------------------------------------------------------------------------------
alter publication supabase_realtime add table public.envelopes, public.recipients;
