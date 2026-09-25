-- "Sign now": when the owner is the only signer they sign in the app straight away. They are
-- not emailed a link, and the audit trail (and certificate) says so instead of "emailed".

drop function if exists private.issue_signing_tokens(uuid);

-- p_in_app_email: that signer signs in the app now, so they get no link email and are not returned
create or replace function private.issue_signing_tokens(p_envelope_id uuid, p_in_app_email text default null)
returns table (recipient_id uuid, name text, email text, token text)
language plpgsql
set search_path = ''
as $$
declare
  env public.envelopes;
  turn integer;
  r record;
  v_in_app boolean;
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
    v_in_app := p_in_app_email is not null and lower(r.email) = lower(p_in_app_email);

    update public.recipients set status = 'sent', sent_at = now() where id = r.id;

    insert into public.audit_events (envelope_id, recipient_id, action, details)
    values (p_envelope_id, r.id, case when v_in_app then 'recipient_signing_in_app' else 'recipient_notified' end,
            jsonb_build_object('email', r.email));

    if not v_in_app then
      recipient_id := r.id;
      name := r.name;
      email := r.email;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function private.issue_signing_tokens(uuid, text) from public, anon, authenticated;
grant execute on function private.issue_signing_tokens(uuid, text) to service_role;

drop function if exists public.svc_send_envelope(uuid, uuid, text);

create or replace function public.svc_send_envelope(p_envelope_id uuid, p_owner_id uuid, p_original_sha256 text, p_sign_now boolean default false)
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
    select 2, 'Every recipient needs a name and an email address.'
      where exists (select 1 from public.recipients
                    where envelope_id = env.id and (name = '' or email is null))
    union all
    select 2, format('Fill in "%s" before sending.', coalesce(nullif(f.label, ''), 'Fill in now'))
      from public.fields f
      where f.envelope_id = env.id and f.type = 'prefill' and f.prefill is null
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
    'notify', coalesce((select jsonb_agg(to_jsonb(t)) from private.issue_signing_tokens(
      env.id,
      case when p_sign_now then (select p.email from public.profiles p where p.id = p_owner_id) end
    ) t), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.svc_send_envelope(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.svc_send_envelope(uuid, uuid, text, boolean) to service_role;
