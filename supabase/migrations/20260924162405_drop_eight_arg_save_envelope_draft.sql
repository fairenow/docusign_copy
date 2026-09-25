-- The app now saves the signer-adjustment setting with every draft
drop function public.save_envelope_draft(uuid, text, text, text, integer, integer, jsonb, jsonb);
