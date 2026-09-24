-- svc_complete_signing also returns envelope_id (like svc_decline_signing), so callers
-- need no extra lookup before the signing token is deleted.
create or replace function public.svc_complete_signing(
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
    return jsonb_build_object('envelope_id', env.id, 'complete', true, 'notify', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'envelope_id', env.id,
    'complete', false,
    'notify', coalesce((select jsonb_agg(to_jsonb(t)) from private.issue_signing_tokens(env.id) t), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.svc_complete_signing(text, uuid, text, jsonb, boolean, inet, text) from public, anon, authenticated;
grant execute on function public.svc_complete_signing(text, uuid, text, jsonb, boolean, inet, text) to service_role;
