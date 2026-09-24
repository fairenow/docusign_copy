-- Replace the FOR ALL policies (which also applied to SELECT) with per-action write policies
drop policy "Manage roles of own templates" on public.template_roles;
create policy "Add roles to own templates" on public.template_roles
  for insert to authenticated with check (private.can_edit_template(template_id));
create policy "Edit roles of own templates" on public.template_roles
  for update to authenticated
  using (private.can_edit_template(template_id))
  with check (private.can_edit_template(template_id));
create policy "Remove roles from own templates" on public.template_roles
  for delete to authenticated using (private.can_edit_template(template_id));

drop policy "Manage fields of own templates" on public.template_fields;
create policy "Add fields to own templates" on public.template_fields
  for insert to authenticated with check (private.can_edit_template(template_id));
create policy "Edit fields of own templates" on public.template_fields
  for update to authenticated
  using (private.can_edit_template(template_id))
  with check (private.can_edit_template(template_id));
create policy "Remove fields from own templates" on public.template_fields
  for delete to authenticated using (private.can_edit_template(template_id));
