-- Owner-triggered "resend link": replaces a waiting signer's link (the old one stops working).
create function public.svc_reissue_signing_link(p_envelope_id uuid, p_owner_id uuid, p_recipient_id uuid)
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
revoke all on function public.svc_reissue_signing_link(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_reissue_signing_link(uuid, uuid, uuid) to service_role;
