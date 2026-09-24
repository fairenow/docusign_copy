-- Review fixes for reminders:
-- 1. A manual "resend link" counts as a reminder, so the hourly job does not email the same
--    signer again within the hour.
-- 2. The job reads the Edge Function URL from Vault (signing_reminders_url) instead of having
--    it written into the job, so another project or a local stack points it at its own
--    functions by changing that secret.

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

  update public.recipients set last_reminded_at = now() where id = r.id;
  insert into public.audit_events (envelope_id, recipient_id, actor_user_id, action, details)
  values (env.id, r.id, p_owner_id, 'recipient_reminded', jsonb_build_object('email', r.email));

  recipient_id := r.id; name := r.name; email := r.email;
  token := private.new_signing_token(r.id, env.expires_at);
  return next;
end;
$$;

revoke all on function public.svc_reissue_signing_link(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.svc_reissue_signing_link(uuid, uuid, uuid) to service_role;

select vault.create_secret(
  'https://tdgwdniwwkqqyfuoxnwx.supabase.co/functions/v1/signing-api/reminders',
  'signing_reminders_url',
  'Where the hourly reminders job sends its request (this project''s signing-api)'
);

-- Scheduling under an existing name replaces that job
select cron.schedule(
  'signing-reminders',
  '7 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'signing_reminders_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminders-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'signing_reminders_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
