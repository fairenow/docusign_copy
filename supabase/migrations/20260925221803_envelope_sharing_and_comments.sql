-- Collaboration: share an envelope with a teammate, and comment on it with @mentions.
--
-- Sharing gives view-and-comment access (drafts included), never editing or signing. Only the
-- owner or an admin shares; a teammate can leave a share. Comments are internal: signers who
-- are not on the team never see them, and they are not part of the audit trail or the
-- certificate. Emails for shares and mentions go out through the signing-api Edge Function,
-- which reads what to send from the svc_* functions below (service role only).

-------------------------------------------------------------------------------
-- Shares
-------------------------------------------------------------------------------

create table public.envelope_shares (
  envelope_id uuid not null references public.envelopes (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  shared_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (envelope_id, user_id)
);
comment on table public.envelope_shares is 'Teammates an envelope is shared with: they can view it and comment, not edit or sign.';
create index envelope_shares_user_id_idx on public.envelope_shares (user_id);
create index envelope_shares_shared_by_idx on public.envelope_shares (shared_by);

-------------------------------------------------------------------------------
-- Access checks
-------------------------------------------------------------------------------

-- Whether a given user can see an envelope (the service functions act for a user id)
create or replace function private.user_can_view_envelope(p_envelope_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.envelopes e
    where e.id = p_envelope_id
      and (
        e.owner_id = p_user_id
        or private.is_admin(p_user_id)
        or exists (select 1 from public.envelope_shares s where s.envelope_id = e.id and s.user_id = p_user_id)
        or (
          e.status <> 'draft'
          and exists (
            select 1 from public.recipients r join public.profiles p on lower(p.email) = lower(r.email)
            where r.envelope_id = e.id and p.id = p_user_id
          )
        )
      )
  );
$$;

-- Owners and admins decide who an envelope is shared with (never a template working copy)
create or replace function private.can_share_envelope(p_envelope_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.envelopes e
    where e.id = p_envelope_id and e.editing_template_id is null
      and (e.owner_id = (select auth.uid()) or private.is_admin())
  );
$$;

create or replace function private.is_shared_with_me(p_envelope_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.envelope_shares where envelope_id = p_envelope_id and user_id = (select auth.uid()));
$$;


alter table public.envelope_shares enable row level security;

create policy "View shares of visible envelopes" on public.envelope_shares
  for select to authenticated using (private.can_view_envelope(envelope_id));
create policy "Owners and admins share envelopes" on public.envelope_shares
  for insert to authenticated with check (
    shared_by = (select auth.uid())
    and private.can_share_envelope(envelope_id)
    and user_id <> (select owner_id from public.envelopes where id = envelope_id)
  );
create policy "Owners and admins unshare; anyone leaves a share" on public.envelope_shares
  for delete to authenticated using (user_id = (select auth.uid()) or private.can_share_envelope(envelope_id));

revoke all on public.envelope_shares from anon, authenticated;
grant select, delete on public.envelope_shares to authenticated;
grant insert (envelope_id, user_id) on public.envelope_shares to authenticated;

-- Shared envelopes are visible: the helper used by recipients, fields, audit and storage rules,
-- and the envelopes policy itself (which checks the owner inline so INSERT ... RETURNING works)
create or replace function private.can_view_envelope(envelope uuid)
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
        or exists (select 1 from public.envelope_shares s where s.envelope_id = e.id and s.user_id = (select auth.uid()))
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

drop policy "View own, admin, or addressed envelopes" on public.envelopes;
create policy "View own, admin, shared or addressed envelopes" on public.envelopes
  for select to authenticated using (
    owner_id = (select auth.uid())
    or (select private.is_admin())
    or private.is_shared_with_me(id)
    or (status <> 'draft' and private.is_envelope_recipient(id))
  );

-------------------------------------------------------------------------------
-- Comments
-------------------------------------------------------------------------------

create table public.envelope_comments (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.envelopes (id) on delete cascade,
  -- A reply belongs to a top-level comment (one level of replies)
  parent_id uuid references public.envelope_comments (id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  -- Optional pin on the document, as fractions of the page
  page integer check (page >= 1),
  x double precision check (x >= 0 and x <= 1),
  y double precision check (y >= 0 and y <= 1),
  mentions uuid[] not null default '{}' check (cardinality(mentions) <= 20),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint envelope_comments_pin_complete check ((page is null) = (x is null) and (x is null) = (y is null))
);
comment on table public.envelope_comments is 'Internal team comments on an envelope. Never shown to external signers or printed.';
create index envelope_comments_envelope_id_idx on public.envelope_comments (envelope_id, created_at);
create index envelope_comments_parent_id_idx on public.envelope_comments (parent_id);
create index envelope_comments_author_id_idx on public.envelope_comments (author_id);
create index envelope_comments_resolved_by_idx on public.envelope_comments (resolved_by);

-- Replies: same envelope, under a top-level comment, never pinned. Resolving records who and when.
create or replace function private.envelope_comment_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.body := btrim(new.body);
    if new.parent_id is not null then
      if not exists (
        select 1 from public.envelope_comments p
        where p.id = new.parent_id and p.envelope_id = new.envelope_id and p.parent_id is null
      ) then
        raise exception 'Reply to a comment on this envelope' using errcode = '22023';
      end if;
      new.page := null; new.x := null; new.y := null;
    end if;
    new.resolved_at := null; new.resolved_by := null; new.notified_at := null;
  elsif new.resolved_at is distinct from old.resolved_at then
    new.resolved_at := case when new.resolved_at is null then null else now() end;
    new.resolved_by := case when new.resolved_at is null then null else (select auth.uid()) end;
  end if;
  return new;
end;
$$;

create trigger envelope_comment_rules
  before insert or update on public.envelope_comments
  for each row execute function private.envelope_comment_rules();

alter table public.envelope_comments enable row level security;

create policy "View comments of visible envelopes" on public.envelope_comments
  for select to authenticated using (private.can_view_envelope(envelope_id));
create policy "Comment on visible envelopes" on public.envelope_comments
  for insert to authenticated with check (author_id = (select auth.uid()) and private.can_view_envelope(envelope_id));
create policy "Resolve comments of visible envelopes" on public.envelope_comments
  for update to authenticated using (private.can_view_envelope(envelope_id)) with check (private.can_view_envelope(envelope_id));
create policy "Delete own comments" on public.envelope_comments
  for delete to authenticated using (author_id = (select auth.uid()));

revoke all on public.envelope_comments from anon, authenticated;
grant select, delete on public.envelope_comments to authenticated;
grant insert (envelope_id, parent_id, body, page, x, y, mentions) on public.envelope_comments to authenticated;
grant update (resolved_at) on public.envelope_comments to authenticated;

alter publication supabase_realtime add table public.envelope_comments;

-------------------------------------------------------------------------------
-- Notifications (service role only; each is sent once)
-------------------------------------------------------------------------------

-- Who to email about a new comment: the people it mentions and, for a reply, the author of the
-- comment it answers; only teammates who can see the envelope, never the author.
create or replace function public.svc_comment_notifications(p_comment_id uuid, p_author_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c public.envelope_comments;
  env public.envelopes;
  parent_author uuid;
begin
  update public.envelope_comments set notified_at = now()
  where id = p_comment_id and author_id = p_author_id and notified_at is null
  returning * into c;
  if not found then
    return jsonb_build_object('notify', '[]'::jsonb);
  end if;
  select * into env from public.envelopes where id = c.envelope_id;
  select author_id into parent_author from public.envelope_comments where id = c.parent_id;

  return jsonb_build_object(
    'envelope_id', env.id,
    'comment_id', c.id,
    'title', env.title,
    'body', c.body,
    'author', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = c.author_id),
    'notify', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', p.email,
        'name', coalesce(nullif(p.full_name, ''), p.email),
        'mentioned', p.id = any (c.mentions)
      ))
      from public.profiles p
      where (p.id = any (c.mentions) or p.id = parent_author)
        and p.id <> c.author_id
        and private.user_can_view_envelope(env.id, p.id)
    ), '[]'::jsonb)
  );
end;
$$;

-- The teammate to tell about a new share (once, and only when this user shared it)
create or replace function public.svc_share_notification(p_envelope_id uuid, p_user_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  s public.envelope_shares;
begin
  update public.envelope_shares set notified_at = now()
  where envelope_id = p_envelope_id and user_id = p_user_id and shared_by = p_actor_id and notified_at is null
  returning * into s;
  if not found then
    return null;
  end if;
  return (
    select jsonb_build_object(
      'envelope_id', e.id,
      'title', e.title,
      'email', p.email,
      'name', coalesce(nullif(p.full_name, ''), p.email),
      'sharer', (select coalesce(nullif(full_name, ''), email) from public.profiles where id = s.shared_by)
    )
    from public.envelopes e, public.profiles p
    where e.id = s.envelope_id and p.id = s.user_id
  );
end;
$$;

revoke all on function private.user_can_view_envelope(uuid, uuid) from public, anon, authenticated;
revoke all on function public.svc_comment_notifications(uuid, uuid) from public, anon, authenticated;
revoke all on function public.svc_share_notification(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.user_can_view_envelope(uuid, uuid) to service_role;
grant execute on function public.svc_comment_notifications(uuid, uuid) to service_role;
grant execute on function public.svc_share_notification(uuid, uuid, uuid) to service_role;
