// POST { commentId } — after posting a comment, email the teammates it mentions (and, for a
// reply, the author of the comment it answers). Only the comment's author can ask, only once,
// and only teammates who can see the envelope are emailed (svc_comment_notifications decides).
import { json, readJson, requireUuid } from '../http.ts'
import { requireUser, rpc } from '../supabase.ts'
import { emailConfig } from '../config.ts'
import { sendEmail } from '../mail.ts'
import { commentEmail } from '../emails.js'

interface Notice {
  envelope_id?: string
  comment_id?: string
  title?: string
  body?: string
  author?: string
  notify: { email: string; name: string; mentioned: boolean }[]
}

export async function notifyComment(req: Request): Promise<Response> {
  const user = await requireUser(req)
  const commentId = requireUuid((await readJson(req)).commentId, 'commentId')
  const notice = await rpc<Notice>('svc_comment_notifications', { p_comment_id: commentId, p_author_id: user.id })
  if (!notice.notify.length) return json({ notified: 0 })

  const { appUrl, logoUrl } = emailConfig()
  const link = `${appUrl}/envelopes/${notice.envelope_id}?comment=${notice.comment_id}`
  const results = await Promise.allSettled(notice.notify.map(person => sendEmail({
    to: person.email,
    ...commentEmail({ recipientName: person.name, authorName: notice.author!, title: notice.title!, body: notice.body!, mentioned: person.mentioned, link, logoUrl })
  })))
  const failed = notice.notify.filter((_, i) => results[i].status === 'rejected')
  // Logged only: comments stay out of the audit trail, which ends up in the certificate
  results.forEach(r => { if (r.status === 'rejected') console.error(r.reason) })
  return json({ notified: notice.notify.length - failed.length, failed: failed.map(p => p.email) })
}
