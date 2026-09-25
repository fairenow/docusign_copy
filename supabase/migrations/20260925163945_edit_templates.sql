-- Editing a template: start_template_edit opens a private working copy (a draft envelope
-- marked with the template), the normal editor changes it, and finish_template_edit writes
-- it back to the template. Recipients of the copy are the template's roles (same ids): the
-- name is the role, an email makes it a fixed person. Working copies can never be sent.

alter table public.envelopes add column editing_template_id uuid references public.templates (id) on delete cascade;
alter table public.envelopes add constraint envelopes_template_copy_is_draft check (editing_template_id is null or status = 'draft');
create index envelopes_editing_template_id_idx on public.envelopes (editing_template_id) where editing_template_id is not null;
comment on column public.envelopes.editing_template_id is 'Set on the working copy used to edit a template; such drafts are never sent.';

grant insert (editing_template_id) on public.envelopes to authenticated;
grant update (message, signing_order, remind_every_days, expire_after_days, allow_signer_adjustments) on public.templates to authenticated;

-- Returns { envelope_id, resumed }: an unfinished copy of yours is reopened rather than duplicated
create function public.start_template_edit(p_template_id uuid)
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
  if exists (select 1 from public.recipients where id in (select id from public.template_roles where template_id = t.id)) then
    raise exception 'Someone else is editing this template right now. Try again when they have finished.' using errcode = '55000';
  end if;

  insert into public.envelopes (title, message, signing_order, original_filename, page_count,
                                remind_every_days, expire_after_days, allow_signer_adjustments, editing_template_id)
  values (t.name, t.message, t.signing_order, t.original_filename, t.page_count,
          t.remind_every_days, t.expire_after_days, t.allow_signer_adjustments, t.id)
  returning id into v_envelope_id;

  insert into public.recipients (id, envelope_id, name, email, role, routing_order, color)
  select tr.id, v_envelope_id, tr.name, tr.default_email, tr.role, tr.routing_order, tr.color
  from public.template_roles tr where tr.template_id = t.id;

  insert into public.fields (envelope_id, recipient_id, page, type, x, y, w, h, required, label, font_size, prefill)
  select v_envelope_id, f.role_id, f.page, f.type, f.x, f.y, f.w, f.h, f.required, f.label, f.font_size, f.prefill
  from public.template_fields f where f.template_id = t.id;

  return jsonb_build_object('envelope_id', v_envelope_id, 'resumed', false);
end;
$$;

create function public.finish_template_edit(p_envelope_id uuid)
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
  v_old jsonb;
  v_duplicate text;
begin
  select * into env from public.envelopes
  where id = p_envelope_id and owner_id = (select auth.uid()) and status = 'draft' and editing_template_id is not null;
  if not found then
    raise exception 'Template copy not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.recipients where envelope_id = env.id and role = 'signer') then
    raise exception 'Add at least one signer before saving a template.' using errcode = '22023';
  end if;
  select btrim(name) into v_duplicate from public.recipients
  where envelope_id = env.id and btrim(name) <> ''
  group by btrim(name), lower(btrim(name)) having count(*) > 1 limit 1;
  if v_duplicate is not null then
    raise exception 'Two roles are called "%". Give each role a different name.', v_duplicate using errcode = '22023';
  end if;

  update public.templates
  set name = coalesce(nullif(btrim(env.title), ''), name), message = env.message, signing_order = env.signing_order,
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

  for r in select * from public.recipients where envelope_id = env.id order by routing_order, id loop
    v_index := v_index + 1;
    v_name := coalesce(nullif(btrim(r.name), ''), format('%s %s', case when r.role = 'cc' then 'Copy' else 'Signer' end, v_index));
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

revoke all on function public.start_template_edit(uuid) from public, anon;
revoke all on function public.finish_template_edit(uuid) from public, anon;
grant execute on function public.start_template_edit(uuid) to authenticated;
grant execute on function public.finish_template_edit(uuid) to authenticated;
