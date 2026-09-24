// POST { token | envelopeId, values: { [fieldId]: value }, consent: true } — sign.
import { json, readJson, clientIp, userAgent, runInBackground, HttpError } from '../http.ts'
import { rpc } from '../supabase.ts'
import { signerArgs, envelopeIdForSigner } from '../signer.ts'
import { emailSigningLinks, type SigningLink } from '../notify.ts'
import { finalizeOrRecordFailure } from '../finalize.ts'

export async function submitSigning(req: Request): Promise<Response> {
  const body = await readJson(req)
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
    throw new HttpError(400, 'values must be an object')
  }
  // Values are normalized and validated in the database (types, required, ownership)
  const values = Object.fromEntries(
    Object.entries(body.values as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v])
  )

  const args = await signerArgs(req, body)
  const envelopeId = await envelopeIdForSigner(args)
  const result = await rpc<{ complete: boolean; notify: SigningLink[] }>('svc_complete_signing', {
    ...args,
    p_values: values,
    p_consent: body.consent === true,
    p_ip: clientIp(req),
    p_user_agent: userAgent(req)
  })

  // The signature is recorded; emails and the final PDF happen after responding
  if (envelopeId) {
    runInBackground(result.complete ? finalizeOrRecordFailure(envelopeId) : emailSigningLinks(envelopeId, result.notify))
  }
  return json({ complete: result.complete })
}
