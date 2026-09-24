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
  // strings, text is trimmed (as the database does), and image values must really decode as
  // PNGs (or the final PDF could not be built).
  const values: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body.values as Record<string, unknown>)) {
    const clean = typeof value === 'string' ? value.trim() : typeof value === 'boolean' ? String(value) : value
    values[key] = clean
    if (typeof clean === 'string' && /^data:/i.test(clean)) await assertPng(clean)
  }

  const result = await rpc<{ envelope_id: string; complete: boolean; notify: SigningLink[] }>('svc_complete_signing', {
    ...(await signerArgs(req, body)),
    p_values: values,
    // Moved/resized fields; the database checks they are the signer's own and on the page
    p_positions: positions(body.positions),
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

/** Keep only { x, y, w, h } numbers per field id. */
function positions(input: unknown): Record<string, { x: number; y: number; w: number; h: number }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Record<string, { x: number; y: number; w: number; h: number }> = {}
  for (const [id, p] of Object.entries(input as Record<string, Record<string, unknown>>)) {
    const n = (key: string) => (typeof p?.[key] === 'number' && Number.isFinite(p[key]) ? p[key] as number : NaN)
    const box = { x: n('x'), y: n('y'), w: n('w'), h: n('h') }
    if (Object.values(box).some(Number.isNaN)) throw new HttpError(400, 'Invalid field position.')
    out[id] = box
  }
  return out
}

async function assertPng(dataUrl: string) {
  try {
    await (await PDFDocument.create()).embedPng(dataUrl)
  } catch {
    throw new HttpError(400, 'Your signature image could not be read. Please sign again.')
  }
}
