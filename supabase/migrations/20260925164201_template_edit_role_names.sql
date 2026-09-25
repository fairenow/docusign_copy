-- Role names: at most 100 characters (the role limit), compared case-insensitively, and a
-- generated "Signer N" never takes a name another role already has
create or replace function public.finish_template_edit(p_envelope_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  env public.envelopes;
  t public.templates;
  r record;
  v_name text;
  v_index integer := 0;
  v_suffix integer;
  v_old jsonb;
  v_duplicate text;
  v_used text[] := '{}';
begin
  select * into env from public.envelopes
  where id = p_envelope_id and owner_id = (select auth.uid()) and status = 'draft' and editing_template_id is not null;
  if not found then
    raise exception 'Template copy not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.recipients where envelope_id = env.id and role = 'signer') then
    raise exception 'Add at least one signer before saving a template.' using errcode = '22023';
  end if;
  select min(left(btrim(name), 100)) into v_duplicate from public.recipients
  where envelope_id = env.id and btrim(name) <> ''
  group by lower(left(btrim(name), 100)) having count(*) > 1 limit 1;
  if v_duplicate is not null then
    raise exception 'Two roles are called "%". Give each role a different name.', v_duplicate using errcode = '22023';
  end if;

  update public.templates
  set name = coalesce(nullif(left(btrim(env.title), 200), ''), name), message = env.message, signing_order = env.signing_order,
      remind_every_days = env.remind_every_days, expire_after_days = env.expire_after_days,
      allow_signer_adjustments = env.allow_signer_adjustments
  where id = env.editing_template_id
  returning * into t;
  if not found then
    raise exception 'Template not found, or you cannot edit it' using errcode = 'P0002';
  end if;

  -- Keep each role's fixed person name when its email stays the same
  select jsonb_object_agg(id, jsonb_build_object('name', default_name, 'email', lower(default_email))) into v_old
  from public.template_roles where template_id = t.id;
  delete from public.template_roles where template_id = t.id;  -- cascades to their fields
  delete from public.template_fields where template_id = t.id; -- "Fill in now" fields

  select coalesce(array_agg(lower(left(btrim(name), 100))), '{}') into v_used
  from public.recipients where envelope_id = env.id and btrim(name) <> '';

  for r in select * from public.recipients where envelope_id = env.id order by routing_order, id loop
    v_index := v_index + 1;
    v_name := nullif(left(btrim(r.name), 100), '');
    if v_name is null then
      v_suffix := v_index;
      loop
        v_name := format('%s %s', case when r.role = 'cc' then 'Copy' else 'Signer' end, v_suffix);
        exit when not lower(v_name) = any (v_used);
        v_suffix := v_suffix + 1;
      end loop;
      v_used := v_used || lower(v_name);
    end if;
    insert into public.template_roles (id, template_id, name, role, routing_order, color, default_name, default_email)
    values (
      r.id, t.id, v_name, r.role, r.routing_order, r.color,
      case when r.email is not null then coalesce(
        case when v_old -> r.id::text ->> 'email' = lower(r.email) then v_old -> r.id::text ->> 'name' end, v_name) end,
      r.email
    );
  end loop;

  insert into public.template_fields (template_id, role_id, page, type, x, y, w, h, required, label, font_size, prefill)
  select t.id, f.recipient_id, f.page, f.type, f.x, f.y, f.w, f.h, f.required, f.label, f.font_size, f.prefill
  from public.fields f where f.envelope_id = env.id;

  return t.id;
end;
$$;
