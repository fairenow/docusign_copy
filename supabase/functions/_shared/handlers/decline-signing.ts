// POST { token | envelopeId, reason } — decline to sign; the sender is told why.
import { json, readJson, clientIp, userAgent, runInBackground } from '../http.ts'
import { admin, ownerOf, rpc, OWNER_SELECT } from '../supabase.ts'
import { signerArgs } from '../signer.ts'
import { emailSender } from '../notify.ts'
import { declinedEmail } from '../emails.js'

export async function declineSigning(req: Request): Promise<Response> {
  const body = await readJson(req)
  const reason = typeof body.reason === 'string' ? body.reason.slice(0, 1000) : null
  const { envelope_id: envelopeId, recipient_id: recipientId } = await rpc<{ envelope_id: string; recipient_id: string }>('svc_decline_signing', {
    ...(await signerArgs(req, body)),
    p_reason: reason,
    p_ip: clientIp(req),
    p_user_agent: userAgent(req)
  })
  runInBackground(notifyOwner(envelopeId, recipientId, reason))
  return json({ declined: true })
}

async function notifyOwner(envelopeId: string, recipientId: string, reason: string | null) {
  const { data, error } = await admin
    .from('envelopes')
    .select(`title, ${OWNER_SELECT}, recipients (id, name)`)
    .eq('id', envelopeId)
    .single()
  if (error) throw error
  const owner = ownerOf(data)
  // deno-lint-ignore no-explicit-any
  const recipient = data.recipients.find((r: any) => r.id === recipientId)
  await emailSender(envelopeId, owner, 'declined', (links) =>
    declinedEmail({ ownerName: owner.name, recipientName: recipient?.name ?? 'A recipient', title: data.title, reason, ...links }))
}
