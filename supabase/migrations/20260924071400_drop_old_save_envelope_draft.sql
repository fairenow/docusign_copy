-- The app now saves reminder and expiration settings with each draft; remove the
-- six-argument save_envelope_draft that the previous version of the app called.
drop function public.save_envelope_draft(uuid, text, text, text, jsonb, jsonb);
