import { emailConfig } from './config.ts'
import { sendEmail } from './mail.ts'
import { admin, audit, ownerOf, OWNER_SELECT } from './supabase.ts'
import { reminderEmail, signingRequestEmail } from './emails.js'

export interface SigningLink {
  recipient_id: string
  name: string
  email: string
  token: string
}

/**
 * Email signing links (a first request, or with `reminder` a reminder that mentions the
 * deadline). Failures are recorded in the audit trail; the owner can resend.
 */
export async function emailSigningLinks(envelopeId: string, links: SigningLink[], { reminder = false } = {}) {
  if (!links.length) return { sent: 0, failed: [] as string[] }
  const kind = reminder ? 'reminder' : 'signing_request'
  const failedEvents = (reason: string, failed: SigningLink[]) => failed.map(link => ({
    envelopeId, action: 'email_failed', recipientId: link.recipient_id,
    details: { email: link.email, kind, reason: reason.slice(0, 300) }
  }))

  let appUrl: string
  try {
    appUrl = emailConfig().appUrl
  } catch (err) {
    // Not configured: record every undelivered link so the sender can see and resend
    await audit(...failedEvents((err as Error).message, links))
    throw err
  }

  const { data: envelope, error } = await admin.from('envelopes').select(`title, message, expires_at, ${OWNER_SELECT}`).eq('id', envelopeId).single()
  if (error) throw error
  const sender = ownerOf(envelope)

  const content = (link: SigningLink) => {
    const details = { recipientName: link.name, senderName: sender.name, title: envelope.title, link: `${appUrl}/sign/${link.token}` }
    return reminder
      ? reminderEmail({ ...details, expiresAt: envelope.expires_at })
      : signingRequestEmail({ ...details, message: envelope.message })
  }
  const results = await Promise.allSettled(links.map(link => sendEmail({ to: link.email, ...content(link) })))
  const failed = links.filter((_, i) => results[i].status === 'rejected')
  results.forEach(r => { if (r.status === 'rejected') console.error(r.reason) })
  await audit(...failedEvents('delivery failed', failed))
  return { sent: links.length - failed.length, failed: failed.map(l => l.email) }
}
