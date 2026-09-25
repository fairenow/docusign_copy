-- Another person's working copy is hidden by RLS, so detect it by the role ids it already uses
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

  insert into public.envelopes (title, message, signing_order, original_filename, page_count,
                                remind_every_days, expire_after_days, allow_signer_adjustments, editing_template_id)
  values (t.name, t.message, t.signing_order, t.original_filename, t.page_count,
          t.remind_every_days, t.expire_after_days, t.allow_signer_adjustments, t.id)
  returning id into v_envelope_id;

  begin
    insert into public.recipients (id, envelope_id, name, email, role, routing_order, color)
    select tr.id, v_envelope_id, tr.name, tr.default_email, tr.role, tr.routing_order, tr.color
    from public.template_roles tr where tr.template_id = t.id;
  exception when unique_violation then
    raise exception 'Someone else is editing this template right now. Try again when they have finished.' using errcode = '55000';
  end;

  insert into public.fields (envelope_id, recipient_id, page, type, x, y, w, h, required, label, font_size, prefill)
  select v_envelope_id, f.role_id, f.page, f.type, f.x, f.y, f.w, f.h, f.required, f.label, f.font_size, f.prefill
  from public.template_fields f where f.template_id = t.id;

  return jsonb_build_object('envelope_id', v_envelope_id, 'resumed', false);
end;
$$;
