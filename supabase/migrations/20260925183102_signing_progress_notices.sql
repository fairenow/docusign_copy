-- svc_complete_signing also returns who signed, so the sender can be told "Carol signed".
-- Patched in place so the long function body stays as the earlier migrations define it.
do $$
declare
  d text := pg_get_functiondef('public.svc_complete_signing'::regproc);
  done_marker text := $a$jsonb_build_object('envelope_id', env.id, 'complete', true,$a$;
  open_marker text := $a$    'envelope_id', env.id,
    'complete', false,$a$;
begin
  if position(done_marker in d) = 0 or position(open_marker in d) = 0 then
    raise exception 'svc_complete_signing did not look as expected; not patched';
  end if;
  d := replace(d, done_marker, $a$jsonb_build_object('envelope_id', env.id, 'recipient_id', r.id, 'complete', true,$a$);
  d := replace(d, open_marker, $a$    'envelope_id', env.id,
    'recipient_id', r.id,
    'complete', false,$a$);
  execute d;
end $$;

-- A signing link can be resent (by hand) at most once every 10 minutes per signer
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
  if r.last_reminded_at > now() - interval '10 minutes' then
    raise exception '% was sent a link a few minutes ago. Try again in 10 minutes.', r.name using errcode = '55000';
  end if;

  update public.recipients set last_reminded_at = now() where id = r.id;
  insert into public.audit_events (envelope_id, recipient_id, actor_user_id, action, details)
  values (env.id, r.id, p_owner_id, 'recipient_reminded', jsonb_build_object('email', r.email));

  recipient_id := r.id; name := r.name; email := r.email;
  token := private.new_signing_token(r.id, env.expires_at);
  return next;
end;
$$;
