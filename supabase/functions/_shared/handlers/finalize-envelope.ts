// POST { envelopeId } — owner/admin retry of finalization for a fully signed envelope.
import { json, readJson, requireUuid, HttpError } from '../http.ts'
import { admin, requireUser } from '../supabase.ts'
import { finalizeOrRecordFailure } from '../finalize.ts'

export async function finalizeEnvelopeHandler(req: Request): Promise<Response> {
  const user = await requireUser(req)
  const envelopeId = requireUuid((await readJson(req)).envelopeId, 'envelopeId')

  const [{ data: envelope }, { data: profile }] = await Promise.all([
    admin.from('envelopes').select('owner_id, status, recipients (role, status)').eq('id', envelopeId).maybeSingle(),
    admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  ])
  if (!envelope || (envelope.owner_id !== user.id && profile?.role !== 'admin')) throw new HttpError(404, 'Envelope not found')
  // deno-lint-ignore no-explicit-any
  const allSigned = envelope.recipients.every((r: any) => r.role !== 'signer' || r.status === 'signed')
  if (envelope.status !== 'sent' || !allSigned) throw new HttpError(409, 'This envelope is not waiting to be finalized')

  return json(await finalizeOrRecordFailure(envelopeId))
}
