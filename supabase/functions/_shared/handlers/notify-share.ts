// POST { envelopeId, userId } — after sharing an envelope, email the teammate it was shared
// with. Only whoever shared it can ask, and only once (svc_share_notification checks both).
import { json, readJson, requireUuid } from '../http.ts'
import { requireUser, rpc } from '../supabase.ts'
import { emailConfig } from '../config.ts'
import { sendEmail } from '../mail.ts'
import { sharedEmail } from '../emails.js'

interface Notice {
  envelope_id: string
  title: string
  email: string
  name: string
  sharer: string
}

export async function notifyShare(req: Request): Promise<Response> {
  const user = await requireUser(req)
  const body = await readJson(req)
  const envelopeId = requireUuid(body.envelopeId, 'envelopeId')
  const userId = requireUuid(body.userId, 'userId')
  const notice = await rpc<Notice | null>('svc_share_notification', { p_envelope_id: envelopeId, p_user_id: userId, p_actor_id: user.id })
  if (!notice) return json({ notified: false })

  const { appUrl, logoUrl } = emailConfig()
  await sendEmail({
    to: notice.email,
    ...sharedEmail({ recipientName: notice.name, sharerName: notice.sharer, title: notice.title, link: `${appUrl}/envelopes/${notice.envelope_id}`, logoUrl })
  })
  return json({ notified: true })
}
