-- Tidy-up, no change for users except that an abandoned template edit no longer blocks others.
--
-- 1. svc_complete_signing written out in full (the previous migration patched it in place, so
--    its body lived in no file). Same behaviour: it also returns who signed.
-- 2. One admin check for any user: private.is_admin(user_id); is_admin() is the caller's.
-- 3. A template copy nobody has changed for 24 hours is released when someone else starts
--    editing that template, instead of blocking them for good.

create or replace function public.svc_complete_signing(p_token_hash text, p_envelope_id uuid, p_email text, p_values jsonb, p_consent boolean, p_ip inet, p_user_agent text, p_positions jsonb default '{}'::jsonb)
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

-- 2. Admin check for a given user (the service functions act for a user id they are passed)
create function private.is_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = p_user_id and role = 'admin');
$$;
revoke all on function private.is_admin(uuid) from public, anon, authenticated;
grant execute on function private.is_admin(uuid) to service_role;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin((select auth.uid()));
$$;

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
  if not found or (env.owner_id <> p_owner_id and not private.is_admin(p_owner_id)) then
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

-- 3. Release another person's template copy that has not been changed for 24 hours. Runs with
--    definer rights because that copy is invisible to the caller. (Its stored PDF stays in the
--    bucket; drafts' documents are small and this is rare.)
create function private.release_stale_template_copies(p_template_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.envelopes
  where editing_template_id = p_template_id
    and owner_id <> (select auth.uid())
    and status = 'draft'
    and updated_at < now() - interval '24 hours';
$$;
revoke all on function private.release_stale_template_copies(uuid) from public, anon;
grant execute on function private.release_stale_template_copies(uuid) to authenticated;

create or replace function public.start_template_edit(p_template_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t public.templates;
  v_envelope_id uuid;
begin
  -- Only the owner or an admin may change a template (its update policy decides)
  update public.templates set name = name where id = p_template_id returning * into t;
  if not found or t.file_path is null then
    raise exception 'Template not found, or you cannot edit it' using errcode = 'P0002';
  end if;

  select id into v_envelope_id from public.envelopes
  where editing_template_id = t.id and owner_id = (select auth.uid()) and status = 'draft'
  limit 1;
  if v_envelope_id is not null then
    return jsonb_build_object('envelope_id', v_envelope_id, 'resumed', true);
  end if;

  perform private.release_stale_template_copies(t.id);

  insert into public.envelopes (title, message, signing_order, original_filename, page_count,
                                remind_every_days, expire_after_days, allow_signer_adjustments, editing_template_id)
  values (t.name, t.message, t.signing_order, t.original_filename, t.page_count,
          t.remind_every_days, t.expire_after_days, t.allow_signer_adjustments, t.id)
  returning id into v_envelope_id;

  -- The copy's recipients reuse the role ids, so a second copy (someone else's, hidden by RLS)
  -- shows up as a duplicate key
  begin
    insert into public.recipients (id, envelope_id, name, email, role, routing_order, color)
    select tr.id, v_envelope_id, tr.name, tr.default_email, tr.role, tr.routing_order, tr.color
    from public.template_roles tr where tr.template_id = t.id;
  exception when unique_violation then
    raise exception 'Someone else is editing this template right now. Try again when they have finished (an edit left untouched for a day is released).' using errcode = '55000';
  end;

  insert into public.fields (envelope_id, recipient_id, page, type, x, y, w, h, required, label, font_size, prefill)
  select v_envelope_id, f.role_id, f.page, f.type, f.x, f.y, f.w, f.h, f.required, f.label, f.font_size, f.prefill
  from public.template_fields f where f.template_id = t.id;

  return jsonb_build_object('envelope_id', v_envelope_id, 'resumed', false);
end;
$$;
