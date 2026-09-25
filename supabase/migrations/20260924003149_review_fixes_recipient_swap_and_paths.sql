-- Review fixes:
-- 1. Saving a draft where recipients swap emails failed: the per-envelope unique email
--    index is checked row by row during the upsert. Recipients of a draft have no
--    signing state yet, so replace them (keeping their ids) instead of upserting.
-- 2. Stored paths are derived from the envelope id; do not let clients point them elsewhere.
-- 3. The storage delete policy now matches the insert/update policies (original.pdf only).

create or replace function public.save_envelope_draft(
  p_envelope_id uuid,
  p_title text,
  p_message text,
  p_signing_order text,
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
  set title = p_title, message = p_message, signing_order = p_signing_order
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
    e ->> 'name',
    e ->> 'email',
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

alter table public.envelopes
  add constraint envelopes_original_path_check
    check (original_path is null or original_path = id::text || '/original.pdf'),
  add constraint envelopes_final_path_check
    check (final_path is null or final_path = id::text || '/signed.pdf');

alter table public.templates
  add constraint templates_file_path_check
    check (file_path is null or file_path = id::text || '/original.pdf');

drop policy "Delete original of own draft" on storage.objects;
create policy "Delete original of own draft" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and storage.filename(name) = 'original.pdf'
    and private.is_draft_owner(private.try_uuid((storage.foldername(name))[1]))
  );
