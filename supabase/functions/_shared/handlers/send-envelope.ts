// POST { envelopeId, signNow? } — the owner sends a draft for signature (signed-in users only).
// signNow: the owner is about to sign in the app, so they are not emailed a link themselves
// (the database leaves them out and records "signing in the app" instead of "emailed").
import { json, readJson, requireUuid, HttpError } from '../http.ts'
import { admin, requireUser, rpc } from '../supabase.ts'
import { emailConfig } from '../config.ts'
import { sha256Hex } from '../crypto.ts'
import { emailSigningLinks, type SigningLink } from '../notify.ts'

export async function sendEnvelope(req: Request): Promise<Response> {
  const user = await requireUser(req)
  const body = await readJson(req)
  const envelopeId = requireUuid(body.envelopeId, 'envelopeId')
  // Fail before anything changes if emails cannot be sent
  emailConfig()

  const { data: envelope, error } = await admin
    .from('envelopes')
    .select('id, owner_id, status, original_path')
    .eq('id', envelopeId)
    .maybeSingle()
  if (error) throw error
  if (!envelope || envelope.owner_id !== user.id) throw new HttpError(404, 'Envelope not found')
  if (envelope.status !== 'draft') throw new HttpError(409, 'This envelope has already been sent')
  if (!envelope.original_path) throw new HttpError(400, 'Upload a document first.')

  // Fingerprint the document exactly as it is being sent
  const { data: file, error: downloadError } = await admin.storage.from('documents').download(envelope.original_path)
  if (downloadError) throw downloadError
  const originalSha = await sha256Hex(new Uint8Array(await file.arrayBuffer()))

  const { notify } = await rpc<{ notify: SigningLink[] }>('svc_send_envelope', {
    p_envelope_id: envelopeId,
    p_owner_id: user.id,
    p_original_sha256: originalSha,
    p_sign_now: body.signNow === true
  })
  const result = await emailSigningLinks(envelopeId, notify)
  return json({ notified: result.sent, failed: result.failed })
}
