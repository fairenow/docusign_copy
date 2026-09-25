-- Templates: a prepared document whose fields belong to roles ("Client", "Company") instead
-- of people. Saving an envelope as a template copies its settings, roles and fields; using
-- a template creates a draft envelope with each role filled in by a real person.
--
-- Both functions are SECURITY INVOKER, so row level security and column grants apply:
-- only your own envelopes can be saved, and only visible (shared or own) templates used.
-- The document itself is copied by the app (templates/<id>/original.pdf <-> documents/...).

alter table public.templates
  add column message text check (char_length(message) <= 5000),
  add column signing_order text not null default 'sequential' check (signing_order in ('sequential', 'parallel')),
  add column remind_every_days integer check (remind_every_days between 1 and 30),
  add column expire_after_days integer not null default 30 check (expire_after_days between 1 and 365);

alter table public.template_roles
  add column role text not null default 'signer' check (role in ('signer', 'cc')),
  -- A role can always go to the same person (e.g. the sender who countersigns)
  add column default_name text check (char_length(default_name) between 1 and 200),
  add column default_email text check (default_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(default_email) <= 320),
  add constraint template_roles_default_person_check check ((default_name is null) = (default_email is null)),
  add constraint template_roles_template_name_key unique (template_id, name);

-- Templates are written by the functions below; afterwards only the name can change
revoke insert, update on public.templates, public.template_roles, public.template_fields from authenticated;
grant insert (id, name, description, original_filename, file_path, page_count, shared, message, signing_order,
              remind_every_days, expire_after_days)
  on public.templates to authenticated;
grant update (name, description, shared) on public.templates to authenticated;
grant insert (id, template_id, name, role, routing_order, color, default_name, default_email)
  on public.template_roles to authenticated;
grant insert (template_id, role_id, page, type, x, y, w, h, required, label, font_size)
  on public.template_fields to authenticated;

-- p_roles: [{ recipient_id, name, keep_recipient }], one per recipient of the envelope.
-- keep_recipient: the role always goes to this recipient's name and email.
create function public.create_template_from_envelope(p_envelope_id uuid, p_name text, p_roles jsonb)
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

    insert into public.template_roles (template_id, name, role, routing_order, color, default_name, default_email)
    values (
      v_template_id, btrim(role_spec ->> 'name'), r.role, r.routing_order, r.color,
      case when (role_spec ->> 'keep_recipient')::boolean then r.name end,
      case when (role_spec ->> 'keep_recipient')::boolean then r.email end
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

-- p_people: { [role_id]: { name, email } }. Roles with a fixed person may be left out.
create function public.create_envelope_from_template(p_template_id uuid, p_title text, p_people jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
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
                                remind_every_days, expire_after_days)
  values (coalesce(nullif(btrim(p_title), ''), t.name), t.message, t.signing_order, t.original_filename, t.page_count,
          t.remind_every_days, t.expire_after_days)
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

  return v_envelope_id;
end;
$$;

revoke all on function public.create_template_from_envelope(uuid, text, jsonb) from public, anon;
revoke all on function public.create_envelope_from_template(uuid, text, jsonb) from public, anon;
grant execute on function public.create_template_from_envelope(uuid, text, jsonb) to authenticated;
grant execute on function public.create_envelope_from_template(uuid, text, jsonb) to authenticated;
