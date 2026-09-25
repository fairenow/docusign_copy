-- Drafts may hold recipients whose name and email are not filled in yet, so a
-- document can be prepared (and saved as a template) before the people are known.
-- Sending still requires every recipient to have both.
alter table public.recipients alter column name set default '';
alter table public.recipients drop constraint recipients_name_check;
alter table public.recipients add constraint recipients_name_check check (char_length(name) <= 200);
alter table public.recipients alter column email drop not null;
-- recipients_email_check still validates any email that is present;
-- the unique (envelope_id, lower(email)) index ignores missing ones.

create or replace function public.save_envelope_draft(
  p_envelope_id uuid,
  p_title text,
  p_message text,
  p_signing_order text,
  p_remind_every_days integer,
  p_expire_after_days integer,
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
      remind_every_days = p_remind_every_days, expire_after_days = p_expire_after_days
  where id = p_envelope_id;
  if not found then
    raise exception 'Envelope not found or no longer a draft' using errcode = 'P0002';
  end if;

  -- Deleting recipients cascades to their fields
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

  insert into public.fields (id, envelope_id, recipient_id, page, type, x, y, w, h, required, label, font_size)
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
    coalesce((e ->> 'font_size')::real, 12)
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
                                remind_every_days, expire_after_days)
  values (v_template_id, btrim(p_name), env.original_filename, v_template_id::text || '/original.pdf', env.page_count,
          env.message, env.signing_order, env.remind_every_days, env.expire_after_days);

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

  return v_template_id;
end;
$$;
