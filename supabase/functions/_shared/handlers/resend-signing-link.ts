// POST { envelopeId, recipientId } — the owner emails a waiting signer a fresh link.
import { json, readJson, requireUuid, HttpError } from '../http.ts'
import { requireUser, rpc } from '../supabase.ts'
import { emailConfig } from '../config.ts'
import { emailSigningLinks, type SigningLink } from '../notify.ts'

export async function resendSigningLink(req: Request): Promise<Response> {
  const user = await requireUser(req)
  const body = await readJson(req)
  const envelopeId = requireUuid(body.envelopeId, 'envelopeId')
  const recipientId = requireUuid(body.recipientId, 'recipientId')
  emailConfig()

  const links = await rpc<SigningLink[]>('svc_reissue_signing_link', {
    p_envelope_id: envelopeId,
    p_owner_id: user.id,
    p_recipient_id: recipientId
  })
  const result = await emailSigningLinks(envelopeId, links)
  if (result.failed.length) throw new HttpError(502, `Could not email ${result.failed.join(', ')}`)
  return json({ resent: true })
}
