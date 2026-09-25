-- The SELECT policy is also evaluated for INSERT ... RETURNING. A STABLE helper that
-- looks the envelope up by id cannot see the row being inserted, so check the row's own
-- columns directly and only use a helper for the recipient lookup.
create function private.is_envelope_recipient(envelope uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.recipients r
    where r.envelope_id = envelope
      and lower(r.email) = lower((select auth.jwt() ->> 'email'))
  );
$$;
revoke all on function private.is_envelope_recipient(uuid) from public;
grant execute on function private.is_envelope_recipient(uuid) to authenticated, service_role;

drop policy "View own, admin, or addressed envelopes" on public.envelopes;
create policy "View own, admin, or addressed envelopes" on public.envelopes
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select private.is_admin())
    or (status <> 'draft' and private.is_envelope_recipient(id))
  );
