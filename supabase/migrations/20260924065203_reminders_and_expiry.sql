-- Automatic reminders and expiration.
--
-- Each envelope has a reminder interval in days (null = off) and a lifetime in days, both
-- chosen while drafting. Sending sets expires_at = now + lifetime. An hourly pg_cron job
-- calls the signing-api Edge Function ("reminders"), which runs svc_run_reminders(): it
-- expires envelopes whose deadline passed before everyone signed, and issues reminder links
-- to signers whose turn it is and who have not heard from us within the interval. The
-- function sends the emails.

alter table public.envelopes
  add column remind_every_days integer check (remind_every_days between 1 and 30),
  add column expire_after_days integer not null default 30 check (expire_after_days between 1 and 365);
-- New envelopes remind every 3 days; envelopes that are already out keep reminders off
alter table public.envelopes alter column remind_every_days set default 3;

alter table public.envelopes drop constraint envelopes_status_check;
alter table public.envelopes add constraint envelopes_status_check
  check (status in ('draft', 'sent', 'completed', 'declined', 'voided', 'expired'));

alter table public.recipients add column last_reminded_at timestamptz;

grant insert (remind_every_days, expire_after_days), update (remind_every_days, expire_after_days)
  on public.envelopes to authenticated;

-------------------------------------------------------------------------------
-- Signing links: a signer may hold several valid links (the first email and each
-- reminder), so an older email keeps working after a reminder. Links still expire with
-- the envelope and are all removed when the signer finishes or the envelope closes.
-------------------------------------------------------------------------------
alter table public.recipient_tokens drop constraint recipient_tokens_pkey;
alter table public.recipient_tokens drop constraint recipient_tokens_token_hash_key;
alter table public.recipient_tokens add primary key (token_hash);
create index recipient_tokens_recipient_id_idx on public.recipient_tokens (recipient_id);

-- Store a new link for a signer and return the raw token (only its hash is kept)
create function private.new_signing_token(p_recipient_id uuid, p_expires_at timestamptz)
returns text
language plpgsql
set search_path = ''
as $$
declare
  raw text := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
begin
  insert into public.recipient_tokens (recipient_id, token_hash, expires_at)
  values (p_recipient_id, encode(sha256(convert_to(raw, 'UTF8')), 'hex'), p_expires_at);
  return raw;
end;
$$;

create or replace function private.issue_signing_tokens(p_envelope_id uuid)
returns table (recipient_id uuid, name text, email text, token text)
language plpgsql
set search_path = ''
as $$
declare
  env public.envelopes;
  turn integer;
  r record;
begin
  select * into env from public.envelopes where id = p_envelope_id;

  select min(routing_order) into turn
  from public.recipients
  where envelope_id = p_envelope_id and role = 'signer' and status <> 'signed';

  for r in
    select rc.id, rc.name, rc.email
    from public.recipients rc
    where rc.envelope_id = p_envelope_id
      and rc.role = 'signer'
      and rc.status = 'pending'
      and (env.signing_order = 'parallel' or rc.routing_order = turn)
    order by rc.routing_order, rc.name
  loop
    token := private.new_signing_token(r.id, env.expires_at);

    update public.recipients set status = 'sent', sent_at = now() where id = r.id;

    insert into public.audit_events (envelope_id, recipient_id, action, details)
    values (p_envelope_id, r.id, 'recipient_notified', jsonb_build_object('email', r.email));

    recipient_id := r.id;
    name := r.name;
    email := r.email;
    return next;
  end loop;
end;
$$;

-- Owner-triggered "resend link": emails a waiting signer a new link (earlier links keep working)
create or replace function public.svc_reissue_signing_link(p_envelope_id uuid, p_owner_id uuid, p_recipient_id uuid)
returns table (recipient_id uuid, name text, email text, token text)
language plpgsql
set search_path = ''
as $$
declare
  env public.envelopes;
  r public.recipients;
begin
  select * into env from public.envelopes where id = p_envelope_id for update;
  if not found or env.owner_id <> p_owner_id then
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

  insert into public.audit_events (envelope_id, recipient_id, actor_user_id, action, details)
  values (env.id, r.id, p_owner_id, 'recipient_reminded', jsonb_build_object('email', r.email));

  recipient_id := r.id; name := r.name; email := r.email;
  token := private.new_signing_token(r.id, env.expires_at);
  return next;
end;
$$;

-------------------------------------------------------------------------------
-- Drafts save the reminder and expiration settings with everything else
-------------------------------------------------------------------------------
-- (The previous six-argument version is dropped once the app calling it is replaced.)
create function public.save_envelope_draft(
  p_envelope_id uuid,
  p_title text,
  p_message text,
  p_signing_order text,
  p_remind_every_days integer,
  p_expire_after_days integer,
  p_recipients jsonb,
  p_fields jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_recipients) <> 'array' or jsonb_typeof(p_fields) <> 'array' then
    raise exception 'recipients and fields must be arrays' using errcode = '22023';
  end if;

  -- RLS limits this to the caller's own draft; zero rows means not found / not editable
  update public.envelopes
  set title = p_title, message = p_message, signing_order = p_signing_order,
      remind_every_days = p_remind_every_days, expire_after_days = p_expire_after_days
  where id = p_envelope_id;
  if not found then
    raise exception 'Envelope not found or no longer a draft' using errcode = 'P0002';
  end if;

  -- Deleting recipients cascades to their fields
  delete from public.recipients where envelope_id = p_envelope_id;

  insert into public.recipients (id, envelope_id, name, email, role, routing_order, color)
  select
    (e ->> 'id')::uuid,
    p_envelope_id,
    e ->> 'name',
    e ->> 'email',
    coalesce(e ->> 'role', 'signer'),
    coalesce((e ->> 'routing_order')::integer, 1),
    e ->> 'color'
  from jsonb_array_elements(p_recipients) e;

  insert into public.fields (id, envelope_id, recipient_id, page, type, x, y, w, h, required, label, font_size)
  select
    (e ->> 'id')::uuid,
    p_envelope_id,
    (e ->> 'recipient_id')::uuid,
    (e ->> 'page')::integer,
    e ->> 'type',
    (e ->> 'x')::double precision,
    (e ->> 'y')::double precision,
    (e ->> 'w')::double precision,
    (e ->> 'h')::double precision,
    coalesce((e ->> 'required')::boolean, true),
    e ->> 'label',
    coalesce((e ->> 'font_size')::real, 12)
  from jsonb_array_elements(p_fields) e;
end;
$$;

revoke all on function public.save_envelope_draft(uuid, text, text, text, integer, integer, jsonb, jsonb) from public, anon;
grant execute on function public.save_envelope_draft(uuid, text, text, text, integer, integer, jsonb, jsonb) to authenticated;

-------------------------------------------------------------------------------
-- Sending: the lifetime chosen while drafting sets the deadline
-------------------------------------------------------------------------------
drop function public.svc_send_envelope(uuid, uuid, text, interval);

create function public.svc_send_envelope(p_envelope_id uuid, p_owner_id uuid, p_original_sha256 text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  env public.envelopes;
  problem text;
begin
  select * into env from public.envelopes where id = p_envelope_id for update;
  if not found or env.owner_id <> p_owner_id then
    raise exception 'Envelope not found' using errcode = 'P0002';
  end if;
  if env.status <> 'draft' then
    raise exception 'This envelope has already been sent' using errcode = '55000';
  end if;

  select msg into problem from (
    select 1 as ord, 'Upload a document first.' as msg where env.original_path is null
    union all
    select 2, 'Add at least one signer.'
      where not exists (select 1 from public.recipients where envelope_id = env.id and role = 'signer')
    union all
    select 3, format('%s has no signature field.', r.name)
      from public.recipients r
      where r.envelope_id = env.id and r.role = 'signer'
        and not exists (select 1 from public.fields f where f.recipient_id = r.id and f.type = 'signature')
    union all
    select 4, format('%s receives a copy only and cannot have fields.', r.name)
      from public.recipients r
      where r.envelope_id = env.id and r.role = 'cc'
        and exists (select 1 from public.fields f where f.recipient_id = r.id)
    order by 1
    limit 1
  ) problems;
  if problem is not null then
    raise exception '%', problem using errcode = '22023';
  end if;

  -- Attribute the status change to the owner in the audit trail
  perform set_config('request.jwt.claims', json_build_object('sub', p_owner_id)::text, true);

  update public.envelopes
  set status = 'sent',
      sent_at = now(),
      original_sha256 = p_original_sha256,
      expires_at = now() + make_interval(days => env.expire_after_days)
  where id = env.id;

  update public.recipients
  set status = 'pending', sent_at = null, viewed_at = null, signed_at = null, declined_at = null, last_reminded_at = null
  where envelope_id = env.id;

  return jsonb_build_object(
    'notify', coalesce((select jsonb_agg(to_jsonb(t)) from private.issue_signing_tokens(env.id) t), '[]'::jsonb)
  );
end;
$$;

-------------------------------------------------------------------------------
-- Hourly job: expire overdue envelopes and issue reminders
-------------------------------------------------------------------------------

-- The job authenticates to the Edge Function with a random secret kept in Vault
create function private.reminders_secret_matches(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_secret is not null and exists (
    select 1 from vault.decrypted_secrets
    where name = 'signing_reminders_secret' and decrypted_secret = p_secret
  );
$$;

-- Returns { expired: [{ envelope_id }], reminders: [{ envelope_id, recipient_id, name, email, token }] }
create function public.svc_run_reminders(p_secret text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  expired jsonb;
  reminders jsonb := '[]'::jsonb;
  r record;
begin
  if not private.reminders_secret_matches(p_secret) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  -- The deadline passed before every signer finished: close the envelope and its links.
  -- (Fully signed envelopes waiting for their final PDF are left alone.)
  with closed as (
    update public.envelopes e
    set status = 'expired'
    where e.status = 'sent'
      and e.expires_at <= now()
      and exists (
        select 1 from public.recipients rc
        where rc.envelope_id = e.id and rc.role = 'signer' and rc.status <> 'signed'
      )
    returning e.id
  ), removed_links as (
    delete from public.recipient_tokens t
    using public.recipients rc, closed c
    where t.recipient_id = rc.id and rc.envelope_id = c.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('envelope_id', c.id)), '[]'::jsonb) into expired from closed c;

  -- Signers whose turn it is and who were last emailed at least an interval ago.
  -- SKIP LOCKED: an overlapping run never reminds the same signer twice.
  for r in
    select rc.id, rc.envelope_id, rc.name, rc.email, e.expires_at
    from public.recipients rc
    join public.envelopes e on e.id = rc.envelope_id
    where e.status = 'sent'
      and e.remind_every_days is not null
      and (e.expires_at is null or e.expires_at > now())
      and rc.role = 'signer'
      and rc.status in ('sent', 'viewed')
      and coalesce(rc.last_reminded_at, rc.sent_at) <= now() - make_interval(days => e.remind_every_days)
      and private.is_signers_turn(rc, e.signing_order)
    order by rc.envelope_id, rc.routing_order
    for update of rc skip locked
  loop
    update public.recipients set last_reminded_at = now() where id = r.id;
    insert into public.audit_events (envelope_id, recipient_id, action, details)
    values (r.envelope_id, r.id, 'recipient_auto_reminded', jsonb_build_object('email', r.email));
    reminders := reminders || jsonb_build_object(
      'envelope_id', r.envelope_id, 'recipient_id', r.id, 'name', r.name, 'email', r.email,
      'token', private.new_signing_token(r.id, r.expires_at)
    );
  end loop;

  return jsonb_build_object('expired', expired, 'reminders', reminders);
end;
$$;

-------------------------------------------------------------------------------
-- Privileges: service role only
-------------------------------------------------------------------------------
revoke all on function private.new_signing_token(uuid, timestamptz) from public, anon, authenticated;
revoke all on function private.reminders_secret_matches(text) from public, anon, authenticated;
revoke all on function private.issue_signing_tokens(uuid) from public, anon, authenticated;
revoke all on function public.svc_reissue_signing_link(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.svc_send_envelope(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.svc_run_reminders(text) from public, anon, authenticated;

grant execute on function private.new_signing_token(uuid, timestamptz) to service_role;
grant execute on function private.reminders_secret_matches(text) to service_role;
grant execute on function private.issue_signing_tokens(uuid) to service_role;
grant execute on function public.svc_reissue_signing_link(uuid, uuid, uuid) to service_role;
grant execute on function public.svc_send_envelope(uuid, uuid, text) to service_role;
grant execute on function public.svc_run_reminders(text) to service_role;

-------------------------------------------------------------------------------
-- Schedule (pg_cron + pg_net). The secret is generated here and never leaves the database
-- except in the job's request header.
-------------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'signing_reminders_secret',
  'Sent by the hourly reminders job to the signing-api Edge Function'
);

select cron.schedule(
  'signing-reminders',
  '7 * * * *',
  $job$
  select net.http_post(
    url := 'https://tdgwdniwwkqqyfuoxnwx.supabase.co/functions/v1/signing-api/reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminders-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'signing_reminders_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
