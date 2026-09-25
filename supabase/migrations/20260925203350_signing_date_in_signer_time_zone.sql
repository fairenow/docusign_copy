-- "Date signed" uses the signer's time zone (sent by their browser, checked against the known
-- zone names) instead of always UTC, so an evening signature in Michigan is not dated tomorrow.
-- The date still comes from the server's clock. The zone used is kept in the audit trail.

drop function if exists public.svc_complete_signing(text, uuid, text, jsonb, boolean, inet, text, jsonb);

create or replace function public.svc_complete_signing(p_token_hash text, p_envelope_id uuid, p_email text, p_values jsonb, p_consent boolean, p_ip inet, p_user_agent text, p_positions jsonb default '{}'::jsonb, p_time_zone text default null)
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
  pos jsonb;
  px double precision; py double precision; pw double precision; ph double precision;
  moves jsonb := '[]'::jsonb;
  -- Tolerance for floating-point rounding in the browser
  eps constant double precision := 0.000001;
  -- "Date signed" is today in the signer's time zone (a known zone name), else UTC
  v_time_zone text := coalesce(
    (select z.name from pg_catalog.pg_timezone_names z where z.name = left(p_time_zone, 64)), 'UTC');
  signed_date text := to_char(now() at time zone v_time_zone, 'MM/DD/YYYY');
begin
  if p_consent is not true then
    raise exception 'You must agree to sign electronically' using errcode = '22023';
  end if;
  if jsonb_typeof(p_values) <> 'object' then
    raise exception 'values must be an object' using errcode = '22023';
  end if;
  p_positions := coalesce(p_positions, '{}'::jsonb);
  if jsonb_typeof(p_positions) <> 'object' then
    raise exception 'positions must be an object' using errcode = '22023';
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

  -- Values and positions may only refer to this signer's own fields
  select k into unknown
  from (select jsonb_object_keys(p_values) k union all select jsonb_object_keys(p_positions)) keys
  where k not in (select id::text from public.fields where recipient_id = r.id)
  limit 1;
  if unknown is not null then
    raise exception 'Unknown field %', unknown using errcode = '22023';
  end if;

  for f in select * from public.fields where recipient_id = r.id order by page, y, x loop
    pos := p_positions -> f.id::text;
    if pos is not null then
      if jsonb_typeof(pos) <> 'object'
         or jsonb_typeof(pos -> 'x') <> 'number' or jsonb_typeof(pos -> 'y') <> 'number'
         or jsonb_typeof(pos -> 'w') <> 'number' or jsonb_typeof(pos -> 'h') <> 'number' then
        raise exception 'Invalid position for field %', f.id using errcode = '22023';
      end if;
      px := (pos ->> 'x')::double precision; py := (pos ->> 'y')::double precision;
      pw := (pos ->> 'w')::double precision; ph := (pos ->> 'h')::double precision;

      -- Only when the sender allowed it, and never "Date signed" (it fills itself in)
      if (not env.allow_signer_adjustments or f.type = 'date')
         and (abs(px - f.x) > eps or abs(py - f.y) > eps or abs(pw - f.w) > eps or abs(ph - f.h) > eps) then
        raise exception 'This field cannot be moved' using errcode = '22023';
      end if;
      if px < 0 or py < 0 or px + pw > 1 + eps or py + ph > 1 + eps then
        raise exception 'Fields must stay on the page' using errcode = '22023';
      end if;
      if abs(px - f.x) > 0.15 + eps or abs(py - f.y) > 0.10 + eps then
        raise exception 'Fields can only be moved a short distance from where the sender placed them' using errcode = '22023';
      end if;
      if pw < f.w * 0.5 - eps or pw > f.w * 2 + eps or ph < f.h * 0.5 - eps or ph > f.h * 2 + eps then
        raise exception 'Fields can only be resized to between half and twice their size' using errcode = '22023';
      end if;
      if exists (
        select 1 from public.fields o
        where o.envelope_id = f.envelope_id and o.recipient_id is distinct from r.id and o.page = f.page
          and px < o.x + o.w and o.x < px + pw and py < o.y + o.h and o.y < py + ph
      ) then
        raise exception 'A field cannot be moved over another field' using errcode = '22023';
      end if;

      if (px, py, pw, ph) is distinct from (f.x, f.y, f.w, f.h) then
        update public.fields
        set x = px, y = py, w = least(pw, 1 - px), h = least(ph, 1 - py), updated_at = now()
        where id = f.id;
        moves := moves || jsonb_build_object(
          'field_id', f.id, 'type', f.type, 'page', f.page,
          'from', jsonb_build_object('x', f.x, 'y', f.y, 'w', f.w, 'h', f.h),
          'to', jsonb_build_object('x', px, 'y', py, 'w', pw, 'h', ph)
        );
      end if;
    end if;

    v := nullif(btrim(p_values ->> f.id::text), '');
    if f.type = 'date' then
      v := signed_date;  -- "Date signed" is always the server's clock, never the browser's
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

  if jsonb_array_length(moves) > 0 then
    insert into public.audit_events (envelope_id, recipient_id, action, ip, user_agent, details)
    values (env.id, r.id, 'fields_adjusted', p_ip, left(p_user_agent, 500),
            jsonb_build_object('count', jsonb_array_length(moves), 'fields', moves));
  end if;

  insert into public.audit_events (envelope_id, recipient_id, action, ip, user_agent, doc_sha256, details)
  values (env.id, r.id, 'recipient_signed', p_ip, left(p_user_agent, 500), env.original_sha256,
          jsonb_build_object('consent', true, 'time_zone', v_time_zone));

  -- recipient_id: who signed, so the sender can be told
  if not exists (
    select 1 from public.recipients where envelope_id = env.id and role = 'signer' and status <> 'signed'
  ) then
    return jsonb_build_object('envelope_id', env.id, 'recipient_id', r.id, 'complete', true, 'notify', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'envelope_id', env.id,
    'recipient_id', r.id,
    'complete', false,
    'notify', coalesce((select jsonb_agg(to_jsonb(t)) from private.issue_signing_tokens(env.id) t), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.svc_complete_signing(text, uuid, text, jsonb, boolean, inet, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.svc_complete_signing(text, uuid, text, jsonb, boolean, inet, text, jsonb, text) to service_role;
