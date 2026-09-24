import { emailConfig } from './config.ts'
import { sendEmail } from './mail.ts'
import { admin, audit, ownerOf, OWNER_SELECT } from './supabase.ts'
import { signingRequestEmail } from './emails.js'

export interface SigningLink {
  recipient_id: string
  name: string
  email: string
  token: string
}

/** Email signing links. Failures are recorded in the audit trail; the owner can resend. */
export async function emailSigningLinks(envelopeId: string, links: SigningLink[]) {
  if (!links.length) return { sent: 0, failed: [] as string[] }
  const failedEvents = (reason: string, failed: SigningLink[]) => failed.map(link => ({
    envelopeId, action: 'email_failed', recipientId: link.recipient_id,
    details: { email: link.email, kind: 'signing_request', reason: reason.slice(0, 300) }
  }))

  let appUrl: string
  try {
    appUrl = emailConfig().appUrl
  } catch (err) {
    // Not configured: record every undelivered link so the sender can see and resend
    await audit(...failedEvents((err as Error).message, links))
    throw err
  }

  const { data: envelope, error } = await admin.from('envelopes').select(`title, message, ${OWNER_SELECT}`).eq('id', envelopeId).single()
  if (error) throw error
  const sender = ownerOf(envelope)

  const results = await Promise.allSettled(links.map(link => sendEmail({
    to: link.email,
    ...signingRequestEmail({
      recipientName: link.name,
      senderName: sender.name,
      title: envelope.title,
      message: envelope.message,
      link: `${appUrl}/sign/${link.token}`
    })
  })))
  const failed = links.filter((_, i) => results[i].status === 'rejected')
  results.forEach(r => { if (r.status === 'rejected') console.error(r.reason) })
  await audit(...failedEvents('delivery failed', failed))
  return { sent: links.length - failed.length, failed: failed.map(l => l.email) }
}
