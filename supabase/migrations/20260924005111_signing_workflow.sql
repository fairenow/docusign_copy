-- Phase 2: sending and signing.
--
-- These functions are the only way envelopes leave 'draft' or get signed. They are
-- called by Edge Functions with the service role and are not executable by clients.
-- Each one is a single short transaction; PDF generation and emails happen outside.
--
-- A signer is identified either by a signing-link token (its SHA-256 hash is passed in)
-- or, for team members signed in to the app, by envelope id + the email in their JWT.

-- Signature and initials fields store a PNG data URL, so allow larger values for them
alter table public.fields drop constraint fields_value_check;
alter table public.fields add constraint fields_value_check
  check (char_length(value) <= case when type in ('signature', 'initials') then 300000 else 2000 end);

-------------------------------------------------------------------------------
-- Helpers
-------------------------------------------------------------------------------

-- Issue signing links to the signers whose turn it is and mark them sent.
-- Returns the raw tokens so the caller can email them; only hashes are stored.
create function private.issue_signing_tokens(p_envelope_id uuid)
returns table (recipient_id uuid, name text, email text, token text)
language plpgsql
set search_path = ''
as $$
declare
  env public.envelopes;
  turn integer;
  r record;
  raw text;
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
    raw := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');

    insert into public.recipient_tokens (recipient_id, token_hash, expires_at)
    values (r.id, encode(sha256(convert_to(raw, 'UTF8')), 'hex'), env.expires_at)
    on conflict on constraint recipient_tokens_pkey do update
      set token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_at = now();

    update public.recipients set status = 'sent', sent_at = now() where id = r.id;

    insert into public.audit_events (envelope_id, recipient_id, action, details)
    values (p_envelope_id, r.id, 'recipient_notified', jsonb_build_object('email', r.email));

    recipient_id := r.id;
    name := r.name;
    email := r.email;
    token := raw;
    return next;
  end loop;
end;
$$;

-- Find the signer for a token hash, or for a signed-in team member by envelope + email.
-- Raises P0002 with a generic message when nothing matches (no information leaks).
create function private.find_signer(p_token_hash text, p_envelope_id uuid, p_email text)
returns public.recipients
language plpgsql
set search_path = ''
as $$
declare
  result public.recipients;
begin
  if p_token_hash is not null then
    select r.* into result
    from public.recipient_tokens t
    join public.recipients r on r.id = t.recipient_id
    where t.token_hash = p_token_hash and t.expires_at > now();
  elsif p_envelope_id is not null and p_email is not null then
    select r.* into result
    from public.recipients r
    where r.envelope_id = p_envelope_id and r.role = 'signer' and lower(r.email) = lower(p_email);
  end if;

  if result.id is null then
    raise exception 'This signing link is invalid or has expired' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- Whether it is this signer's turn (always true for parallel envelopes)
create function private.is_signers_turn(p_recipient public.recipients, p_signing_order text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_signing_order = 'parallel' or not exists (
    select 1 from public.recipients r
    where r.envelope_id = p_recipient.envelope_id
      and r.role = 'signer'
      and r.status <> 'signed'
      and r.routing_order < p_recipient.routing_order
  );
$$;

-------------------------------------------------------------------------------
-- Service functions (Edge Functions only)
-------------------------------------------------------------------------------

-- Send a draft: validate it, record the document hash, and issue links to the first signers.
create function public.svc_send_envelope(
  p_envelope_id uuid,
  p_owner_id uuid,
  p_original_sha256 text,
  p_link_lifetime interval default interval '30 days'
)
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
      expires_at = coalesce(expires_at, now() + p_link_lifetime)
  where id = env.id;

  update public.recipients
  set status = 'pending', sent_at = null, viewed_at = null, signed_at = null, declined_at = null
  where envelope_id = env.id;

  return jsonb_build_object(
    'notify', coalesce((select jsonb_agg(to_jsonb(t)) from private.issue_signing_tokens(env.id) t), '[]'::jsonb)
  );
end;
$$;

-- Open a signing session: what the signer needs to see, and record that they viewed it.
create function public.svc_signing_session(
  p_token_hash text,
  p_envelope_id uuid,
  p_email text,
  p_ip inet,
  p_user_agent text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r public.recipients := private.find_signer(p_token_hash, p_envelope_id, p_email);
  env public.envelopes;
  state text;
begin
  select * into env from public.envelopes where id = r.envelope_id;

  state := case
    when env.status = 'voided' then 'voided'
    when env.status = 'declined' then 'declined'
    when r.status = 'signed' then 'signed'
    when env.status <> 'sent' then 'closed'
    when not private.is_signers_turn(r, env.signing_order) then 'waiting'
    else 'ready'
  end;

  if state = 'ready' and r.status = 'sent' then
    update public.recipients
    set status = 'viewed', viewed_at = now(), signer_ip = p_ip, signer_user_agent = left(p_user_agent, 500)
    where id = r.id;
    insert into public.audit_events (envelope_id, recipient_id, action, ip, user_agent, doc_sha256)
    values (env.id, r.id, 'recipient_viewed', p_ip, left(p_user_agent, 500), env.original_sha256);
  end if;

  return jsonb_build_object(
    'state', state,
    'envelope', jsonb_build_object(
      'id', env.id,
      'title', env.title,
      'message', env.message,
      'original_path', env.original_path,
      'sender', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = env.owner_id)
    ),
    'recipient', jsonb_build_object('id', r.id, 'name', r.name, 'email', r.email),
    'fields', case when state = 'ready' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'type', f.type, 'page', f.page, 'x', f.x, 'y', f.y, 'w', f.w, 'h', f.h,
        'required', f.required, 'label', f.label, 'font_size', f.font_size
      ) order by f.page, f.y, f.x)
      from public.fields f where f.recipient_id = r.id
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

-- Record a signer's field values and signature. Returns whether the envelope is now
-- fully signed, and the next signers to notify (sequential envelopes).
create function public.svc_complete_signing(
  p_token_hash text,
  p_envelope_id uuid,
  p_email text,
  p_values jsonb,
  p_consent boolean,
  p_ip inet,
  p_user_agent text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r public.recipients := private.find_signer(p_token_hash, p_envelope_id, p_email);
  env public.envelopes;
  f public.fields;
  v text;
  unknown text;
  signed_date text := to_char(now() at time zone 'UTC', 'MM/DD/YYYY');
begin
  if p_consent is not true then
    raise exception 'You must agree to sign electronically' using errcode = '22023';
  end if;
  if jsonb_typeof(p_values) <> 'object' then
    raise exception 'values must be an object' using errcode = '22023';
  end if;

  -- Serialize signers of the same envelope so exactly one of them sees completion
  select * into env from public.envelopes where id = r.envelope_id for update;
  select * into r from public.recipients where id = r.id;

  if env.status <> 'sent' then
    raise exception 'This envelope is no longer open for signing' using errcode = '55000';
  end if;
  if r.status not in ('sent', 'viewed') then
    raise exception 'You have already completed this envelope' using errcode = '55000';
  end if;
  if not private.is_signers_turn(r, env.signing_order) then
    raise exception 'It is not your turn to sign yet' using errcode = '55000';
  end if;

  select k into unknown
  from jsonb_object_keys(p_values) k
  where k not in (select id::text from public.fields where recipient_id = r.id)
  limit 1;
  if unknown is not null then
    raise exception 'Unknown field %', unknown using errcode = '22023';
  end if;

  for f in select * from public.fields where recipient_id = r.id order by page, y, x loop
    v := nullif(btrim(p_values ->> f.id::text), '');
    if f.type = 'date' then
      v := signed_date;  -- "Date signed" is always the server's date
    elsif f.type = 'checkbox' then
      v := case when v = 'true' then 'true' else 'false' end;
    elsif f.type in ('signature', 'initials') and v is not null and v !~ '^data:image/png;base64,[A-Za-z0-9+/]+=*$' then
      raise exception '% must be a PNG image', coalesce(nullif(f.label, ''), initcap(f.type)) using errcode = '22023';
    end if;

    if f.required and (v is null or (f.type = 'checkbox' and v <> 'true')) then
      raise exception 'Please complete the required field: %', coalesce(nullif(f.label, ''), initcap(f.type)) using errcode = '22023';
    end if;

    update public.fields set value = v, filled_at = now() where id = f.id;
  end loop;

  update public.recipients
  set status = 'signed',
      signed_at = now(),
      consented_at = coalesce(consented_at, now()),
      signer_ip = p_ip,
      signer_user_agent = left(p_user_agent, 500)
  where id = r.id;

  delete from public.recipient_tokens where recipient_id = r.id;

  insert into public.audit_events (envelope_id, recipient_id, action, ip, user_agent, doc_sha256, details)
  values (env.id, r.id, 'recipient_signed', p_ip, left(p_user_agent, 500), env.original_sha256,
          jsonb_build_object('consent', true));

  if not exists (
    select 1 from public.recipients where envelope_id = env.id and role = 'signer' and status <> 'signed'
  ) then
    return jsonb_build_object('complete', true, 'notify', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'complete', false,
    'notify', coalesce((select jsonb_agg(to_jsonb(t)) from private.issue_signing_tokens(env.id) t), '[]'::jsonb)
  );
end;
$$;

-- Decline to sign: closes the envelope and invalidates every signing link.
create function public.svc_decline_signing(
  p_token_hash text,
  p_envelope_id uuid,
  p_email text,
  p_reason text,
  p_ip inet,
  p_user_agent text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r public.recipients := private.find_signer(p_token_hash, p_envelope_id, p_email);
  env public.envelopes;
begin
  select * into env from public.envelopes where id = r.envelope_id for update;
  select * into r from public.recipients where id = r.id;

  if env.status <> 'sent' then
    raise exception 'This envelope is no longer open for signing' using errcode = '55000';
  end if;
  if r.status not in ('sent', 'viewed') then
    raise exception 'You have already completed this envelope' using errcode = '55000';
  end if;

  update public.recipients
  set status = 'declined', declined_at = now(), decline_reason = left(nullif(btrim(p_reason), ''), 1000),
      signer_ip = p_ip, signer_user_agent = left(p_user_agent, 500)
  where id = r.id;

  delete from public.recipient_tokens t using public.recipients rc
  where t.recipient_id = rc.id and rc.envelope_id = env.id;

  insert into public.audit_events (envelope_id, recipient_id, action, ip, user_agent, details)
  values (env.id, r.id, 'recipient_declined', p_ip, left(p_user_agent, 500),
          jsonb_build_object('reason', left(nullif(btrim(p_reason), ''), 1000)));

  update public.envelopes set status = 'declined' where id = env.id;

  return jsonb_build_object('envelope_id', env.id, 'recipient_id', r.id);
end;
$$;

-- Mark a fully signed envelope completed once its signed PDF has been stored.
create function public.svc_mark_completed(p_envelope_id uuid, p_final_sha256 text)
returns public.envelopes
language plpgsql
set search_path = ''
as $$
declare
  result public.envelopes;
begin
  update public.envelopes e
  set status = 'completed', completed_at = now(), final_path = e.id::text || '/signed.pdf', final_sha256 = p_final_sha256
  where e.id = p_envelope_id
    and e.status = 'sent'
    and not exists (
      select 1 from public.recipients r where r.envelope_id = e.id and r.role = 'signer' and r.status <> 'signed'
    )
  returning * into result;

  if result.id is null then
    raise exception 'Envelope is not ready to complete' using errcode = '55000';
  end if;
  return result;
end;
$$;

-------------------------------------------------------------------------------
-- Privileges: service role only
-------------------------------------------------------------------------------
revoke all on function private.issue_signing_tokens(uuid) from public, anon, authenticated;
revoke all on function private.find_signer(text, uuid, text) from public, anon, authenticated;
revoke all on function private.is_signers_turn(public.recipients, text) from public, anon, authenticated;
revoke all on function public.svc_send_envelope(uuid, uuid, text, interval) from public, anon, authenticated;
revoke all on function public.svc_signing_session(text, uuid, text, inet, text) from public, anon, authenticated;
revoke all on function public.svc_complete_signing(text, uuid, text, jsonb, boolean, inet, text) from public, anon, authenticated;
revoke all on function public.svc_decline_signing(text, uuid, text, text, inet, text) from public, anon, authenticated;
revoke all on function public.svc_mark_completed(uuid, text) from public, anon, authenticated;

grant execute on function private.issue_signing_tokens(uuid) to service_role;
grant execute on function private.find_signer(text, uuid, text) to service_role;
grant execute on function private.is_signers_turn(public.recipients, text) to service_role;
grant execute on function public.svc_send_envelope(uuid, uuid, text, interval) to service_role;
grant execute on function public.svc_signing_session(text, uuid, text, inet, text) to service_role;
grant execute on function public.svc_complete_signing(text, uuid, text, jsonb, boolean, inet, text) to service_role;
grant execute on function public.svc_decline_signing(text, uuid, text, text, inet, text) to service_role;
grant execute on function public.svc_mark_completed(uuid, text) to service_role;
