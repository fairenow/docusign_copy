-- Keep SECURITY DEFINER functions out of the exposed API schema (Supabase guidance).
-- The public functions are thin SECURITY INVOKER wrappers; the private implementations
-- check authorization themselves (owner/admin for void, admin for role changes).
alter function public.void_envelope(uuid, text) set schema private;
alter function public.set_user_role(uuid, text) set schema private;

create function public.void_envelope(envelope_id uuid, reason text default null)
returns public.envelopes language sql security invoker set search_path = ''
as $$ select private.void_envelope(envelope_id, reason) $$;

create function public.set_user_role(user_id uuid, new_role text)
returns public.profiles language sql security invoker set search_path = ''
as $$ select private.set_user_role(user_id, new_role) $$;

revoke all on function public.void_envelope(uuid, text), public.set_user_role(uuid, text) from public, anon;
grant execute on function public.void_envelope(uuid, text), public.set_user_role(uuid, text) to authenticated;
revoke all on function private.void_envelope(uuid, text), private.set_user_role(uuid, text) from public, anon;
grant execute on function private.void_envelope(uuid, text), private.set_user_role(uuid, text) to authenticated;
