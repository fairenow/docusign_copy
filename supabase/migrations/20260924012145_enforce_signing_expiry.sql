-- Signing links expire with their envelope (recipient_tokens.expires_at = envelopes.expires_at).
-- Enforce the same deadline for team members signing without a link, and do not email a
-- "fresh" link that is already expired.

create or replace function private.find_signer(p_token_hash text, p_envelope_id uuid, p_email text)
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
    join public.envelopes e on e.id = r.envelope_id
    where r.envelope_id = p_envelope_id and r.role = 'signer' and lower(r.email) = lower(p_email)
      and (e.expires_at is null or e.expires_at > now());
  end if;

  if result.id is null then
    raise exception 'This signing link is invalid or has expired' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function public.svc_reissue_signing_link(p_envelope_id uuid, p_owner_id uuid, p_recipient_id uuid)
returns table (recipient_id uuid, name text, email text, token text)
language plpgsql
set search_path = ''
as $$
declare
  env public.envelopes;
  r public.recipients;
  raw text;
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

  raw := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.recipient_tokens (recipient_id, token_hash, expires_at)
  values (r.id, encode(sha256(convert_to(raw, 'UTF8')), 'hex'), env.expires_at)
  on conflict on constraint recipient_tokens_pkey do update
    set token_hash = excluded.token_hash, expires_at = excluded.expires_at, created_at = now();

  insert into public.audit_events (envelope_id, recipient_id, actor_user_id, action, details)
  values (env.id, r.id, p_owner_id, 'recipient_reminded', jsonb_build_object('email', r.email));

  recipient_id := r.id; name := r.name; email := r.email; token := raw;
  return next;
end;
$$;

-- create or replace keeps existing grants; restate them so this file stands on its own
revoke all on function private.find_signer(text, uuid, text) from public, anon, authenticated;
grant execute on function private.find_signer(text, uuid, text) to service_role;
revoke all on function public.svc_reissue_signing_link(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_reissue_signing_link(uuid, uuid, uuid) to service_role;
