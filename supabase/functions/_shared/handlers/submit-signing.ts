// POST { token | envelopeId, values: { [fieldId]: value }, consent: true } — sign.
import { PDFDocument } from 'pdf-lib'
import { json, readJson, clientIp, userAgent, runInBackground, HttpError } from '../http.ts'
import { rpc } from '../supabase.ts'
import { signerArgs } from '../signer.ts'
import { emailSigningLinks, type SigningLink } from '../notify.ts'
import { finalizeOrRecordFailure } from '../finalize.ts'

export async function submitSigning(req: Request): Promise<Response> {
  const body = await readJson(req)
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
    throw new HttpError(400, 'values must be an object')
  }
  // Types, required fields and ownership are enforced by the database. Here: booleans become
  // strings, and image values must really decode as PNGs (or the final PDF could not be built).
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body.values as Record<string, unknown>)) {
    values[key] = typeof value === 'boolean' ? String(value) : value
    if (typeof value === 'string' && value.startsWith('data:image/')) await assertPng(value)
  }

  const result = await rpc<{ envelope_id: string; complete: boolean; notify: SigningLink[] }>('svc_complete_signing', {
    ...(await signerArgs(req, body)),
    p_values: values,
    p_consent: body.consent === true,
    p_ip: clientIp(req),
    p_user_agent: userAgent(req)
  })

  // The signature is recorded; emails and the final PDF happen after responding
  runInBackground(result.complete
    ? finalizeOrRecordFailure(result.envelope_id)
    : emailSigningLinks(result.envelope_id, result.notify))
  return json({ complete: result.complete })
}

async function assertPng(dataUrl: string) {
  try {
    await (await PDFDocument.create()).embedPng(dataUrl)
  } catch {
    throw new HttpError(400, 'Your signature image could not be read. Please sign again.')
  }
}
