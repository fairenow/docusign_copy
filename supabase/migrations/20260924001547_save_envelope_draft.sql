-- Save a draft envelope's settings, recipients and fields in one transaction.
--
-- SECURITY INVOKER: runs as the caller, so RLS and column grants still apply.
-- Recipients are upserted by id (missing ones are deleted); fields are replaced.
-- Clients generate the ids so the editor never has to map temporary ids.
grant insert (id) on public.recipients to authenticated;
grant insert (id) on public.fields to authenticated;

create function public.save_envelope_draft(
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

  delete from public.fields where envelope_id = p_envelope_id;

  delete from public.recipients r
  where r.envelope_id = p_envelope_id
    and r.id not in (select (e ->> 'id')::uuid from jsonb_array_elements(p_recipients) e);

  insert into public.recipients as r (id, envelope_id, name, email, role, routing_order, color)
  select
    (e ->> 'id')::uuid,
    p_envelope_id,
    e ->> 'name',
    e ->> 'email',
    coalesce(e ->> 'role', 'signer'),
    coalesce((e ->> 'routing_order')::integer, 1),
    e ->> 'color'
  from jsonb_array_elements(p_recipients) e
  on conflict (id) do update
    set name = excluded.name,
        email = excluded.email,
        role = excluded.role,
        routing_order = excluded.routing_order,
        color = excluded.color
    where r.envelope_id = p_envelope_id;

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

revoke all on function public.save_envelope_draft(uuid, text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.save_envelope_draft(uuid, text, text, text, jsonb, jsonb) to authenticated;
