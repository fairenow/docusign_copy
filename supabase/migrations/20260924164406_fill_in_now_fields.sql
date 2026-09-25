-- "Fill in now" fields: text the sender types before sending (e.g. the other company's
-- name). They belong to no recipient, are printed into the signed document, and signers
-- see them but cannot change them. Templates keep them with their text as a default.

alter table public.fields drop constraint fields_type_check;
alter table public.fields add constraint fields_type_check
  check (type in ('signature', 'initials', 'text', 'date', 'checkbox', 'prefill'));
alter table public.fields alter column recipient_id drop not null;
alter table public.fields add column prefill text check (char_length(prefill) <= 500);
alter table public.fields add constraint fields_prefill_shape check (
  (type = 'prefill') = (recipient_id is null) and (prefill is null or type = 'prefill')
);
comment on column public.fields.prefill is 'Text the sender filled in ("Fill in now" fields only).';

alter table public.template_fields drop constraint template_fields_type_check;
alter table public.template_fields add constraint template_fields_type_check
  check (type in ('signature', 'initials', 'text', 'date', 'checkbox', 'prefill'));
alter table public.template_fields alter column role_id drop not null;
alter table public.template_fields add column prefill text check (char_length(prefill) <= 500);
alter table public.template_fields add constraint template_fields_prefill_shape check (
  (type = 'prefill') = (role_id is null) and (prefill is null or type = 'prefill')
);

grant insert (prefill), update (prefill) on public.fields to authenticated;
grant select (prefill) on public.fields to authenticated;
grant insert (prefill), select (prefill) on public.template_fields to authenticated;

create or replace function public.save_envelope_draft(
  p_envelope_id uuid,
  p_title text,
  p_message text,
  p_signing_order text,
  p_remind_every_days integer,
  p_expire_after_days integer,
  p_allow_signer_adjustments boolean,
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
      remind_every_days = p_remind_every_days, expire_after_days = p_expire_after_days,
      allow_signer_adjustments = coalesce(p_allow_signer_adjustments, false)
  where id = p_envelope_id;
  if not found then
    raise exception 'Envelope not found or no longer a draft' using errcode = 'P0002';
  end if;

  -- Deleting recipients cascades to their fields; "Fill in now" fields have no recipient
  delete from public.fields where envelope_id = p_envelope_id;
  delete from public.recipients where envelope_id = p_envelope_id;

  insert into public.recipients (id, envelope_id, name, email, role, routing_order, color)
  select
    (e ->> 'id')::uuid,
    p_envelope_id,
    coalesce(btrim(e ->> 'name'), ''),
    nullif(btrim(e ->> 'email'), ''),
    coalesce(e ->> 'role', 'signer'),
    coalesce((e ->> 'routing_order')::integer, 1),
    e ->> 'color'
  from jsonb_array_elements(p_recipients) e;

  insert into public.fields (id, envelope_id, recipient_id, page, type, x, y, w, h, required, label, font_size, prefill)
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
    coalesce((e ->> 'font_size')::real, 12),
    case when e ->> 'type' = 'prefill' then nullif(btrim(e ->> 'prefill'), '') end
  from jsonb_array_elements(p_fields) e;
end;
$$;

create or replace function public.svc_send_envelope(p_envelope_id uuid, p_owner_id uuid, p_original_sha256 text)
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
    'notify', coalesce((select jsonb_agg(to_jsonb(t)) from private.issue_signing_tokens(env.id) t), '[]'::jsonb)
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.svc_signing_session(p_token_hash text, p_envelope_id uuid, p_email text, p_ip inet, p_user_agent text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      'allow_signer_adjustments', env.allow_signer_adjustments,
      'sender', (select coalesce(p.full_name, p.email) from public.profiles p where p.id = env.owner_id)
    ),
    'recipient', jsonb_build_object('id', r.id, 'name', r.name, 'email', r.email),
    'fields', case when state = 'ready' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'type', f.type, 'page', f.page, 'x', f.x, 'y', f.y, 'w', f.w, 'h', f.h,
        'required', f.required, 'label', f.label, 'font_size', f.font_size
      ) order by f.page, f.y, f.x)
      from public.fields f where f.recipient_id = r.id
    ), '[]'::jsonb) else '[]'::jsonb end,
    -- What the sender filled in, shown as part of the document
    'prefilled', case when state = 'ready' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'page', f.page, 'x', f.x, 'y', f.y, 'w', f.w, 'h', f.h,
        'font_size', f.font_size, 'text', f.prefill
      ) order by f.page, f.y, f.x)
      from public.fields f where f.envelope_id = env.id and f.type = 'prefill'
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$function$;

create or replace function public.svc_complete_signing(
  p_token_hash text,
  p_envelope_id uuid,
  p_email text,
  p_values jsonb,
  p_consent boolean,
  p_ip inet,
  p_user_agent text,
  -- { "<field id>": { "x": 0.1, "y": 0.2, "w": 0.3, "h": 0.05 } } for the signer's own fields
  p_positions jsonb default '{}'::jsonb
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
  pos jsonb;
  px double precision; py double precision; pw double precision; ph double precision;
  moves jsonb := '[]'::jsonb;
  -- Tolerance for floating-point rounding in the browser
  eps constant double precision := 0.000001;
  signed_date text := to_char(now() at time zone 'UTC', 'MM/DD/YYYY');
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

  if jsonb_array_length(moves) > 0 then
    insert into public.audit_events (envelope_id, recipient_id, action, ip, user_agent, details)
    values (env.id, r.id, 'fields_adjusted', p_ip, left(p_user_agent, 500),
            jsonb_build_object('count', jsonb_array_length(moves), 'fields', moves));
  end if;

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

create or replace function public.create_template_from_envelope(p_envelope_id uuid, p_name text, p_roles jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  env public.envelopes;
  v_template_id uuid := gen_random_uuid();
  v_role_id uuid;
  r public.recipients;
  role_spec jsonb;
  v_keep boolean;
begin
  if jsonb_typeof(p_roles) <> 'array' then
    raise exception 'roles must be an array' using errcode = '22023';
  end if;

  select * into env from public.envelopes where id = p_envelope_id and owner_id = (select auth.uid());
  if not found then
    raise exception 'Envelope not found' using errcode = 'P0002';
  end if;
  if env.original_path is null then
    raise exception 'Upload a document first.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.recipients where envelope_id = env.id and role = 'signer') then
    raise exception 'Add at least one signer before saving a template.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_roles) <> (select count(*) from public.recipients where envelope_id = env.id) then
    raise exception 'Give every recipient a role.' using errcode = '22023';
  end if;

  insert into public.templates (id, name, original_filename, file_path, page_count, message, signing_order,
                                remind_every_days, expire_after_days, allow_signer_adjustments)
  values (v_template_id, btrim(p_name), env.original_filename, v_template_id::text || '/original.pdf', env.page_count,
          env.message, env.signing_order, env.remind_every_days, env.expire_after_days, env.allow_signer_adjustments);

  for r in select * from public.recipients where envelope_id = env.id order by routing_order, name loop
    select e.value into role_spec from jsonb_array_elements(p_roles) e where e.value ->> 'recipient_id' = r.id::text;
    if role_spec is null then
      raise exception 'Give every recipient a role.' using errcode = '22023';
    end if;
    -- Only someone with a name and email can be kept as the fixed person
    v_keep := coalesce((role_spec ->> 'keep_recipient')::boolean, false) and r.name <> '' and r.email is not null;

    insert into public.template_roles (template_id, name, role, routing_order, color, default_name, default_email)
    values (
      v_template_id, btrim(role_spec ->> 'name'), r.role, r.routing_order, r.color,
      case when v_keep then r.name end,
      case when v_keep then r.email end
    )
    returning id into v_role_id;

    insert into public.template_fields (template_id, role_id, page, type, x, y, w, h, required, label, font_size)
    select v_template_id, v_role_id, f.page, f.type, f.x, f.y, f.w, f.h, f.required, f.label, f.font_size
    from public.fields f
    where f.recipient_id = r.id;
  end loop;

  insert into public.template_fields (template_id, role_id, page, type, x, y, w, h, required, label, font_size, prefill)
  select v_template_id, null, f.page, f.type, f.x, f.y, f.w, f.h, f.required, f.label, f.font_size, f.prefill
  from public.fields f
  where f.envelope_id = env.id and f.type = 'prefill';

  return v_template_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.create_envelope_from_template(p_template_id uuid, p_title text, p_people jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  t public.templates;
  tr public.template_roles;
  v_envelope_id uuid;
  v_recipient_id uuid;
  v_name text;
  v_email text;
begin
  if jsonb_typeof(p_people) <> 'object' then
    raise exception 'people must be an object' using errcode = '22023';
  end if;

  select * into t from public.templates where id = p_template_id;
  if not found or t.file_path is null then
    raise exception 'Template not found' using errcode = 'P0002';
  end if;

  insert into public.envelopes (title, message, signing_order, original_filename, page_count,
                                remind_every_days, expire_after_days, allow_signer_adjustments)
  values (coalesce(nullif(btrim(p_title), ''), t.name), t.message, t.signing_order, t.original_filename, t.page_count,
          t.remind_every_days, t.expire_after_days, t.allow_signer_adjustments)
  returning id into v_envelope_id;

  for tr in select * from public.template_roles where template_id = t.id order by routing_order, name loop
    v_name := coalesce(nullif(btrim(p_people -> tr.id::text ->> 'name'), ''), tr.default_name);
    v_email := coalesce(nullif(btrim(p_people -> tr.id::text ->> 'email'), ''), tr.default_email);
    if v_name is null or v_email is null then
      raise exception 'Enter a name and email for %.', tr.name using errcode = '22023';
    end if;

    insert into public.recipients (envelope_id, name, email, role, routing_order, color)
    values (v_envelope_id, v_name, v_email, tr.role, tr.routing_order, tr.color)
    returning id into v_recipient_id;

    insert into public.fields (envelope_id, recipient_id, page, type, x, y, w, h, required, label, font_size)
    select v_envelope_id, v_recipient_id, f.page, f.type, f.x, f.y, f.w, f.h, f.required, f.label, f.font_size
    from public.template_fields f
    where f.role_id = tr.id;
  end loop;

  insert into public.fields (envelope_id, recipient_id, page, type, x, y, w, h, required, label, font_size, prefill)
  select v_envelope_id, null, f.page, f.type, f.x, f.y, f.w, f.h, f.required, f.label, f.font_size, f.prefill
  from public.template_fields f
  where f.template_id = t.id and f.type = 'prefill';

  return v_envelope_id;
end;
$function$;
