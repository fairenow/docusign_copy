import { emailConfig } from './config.ts'
import { sendEmail } from './mail.ts'
import { admin, audit, ownerOf, OWNER_SELECT } from './supabase.ts'
import { reminderEmail, signedEmail, signingRequestEmail } from './emails.js'

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

  let appUrl: string, logoUrl: string
  try {
    ({ appUrl, logoUrl } = emailConfig())
  } catch (err) {
    // Not configured: record every undelivered link so the sender can see and resend
    await audit(...failedEvents((err as Error).message, links))
    throw err
  }

  const { data: envelope, error } = await admin.from('envelopes').select(`title, message, expires_at, ${OWNER_SELECT}`).eq('id', envelopeId).single()
  if (error) throw error
  const sender = ownerOf(envelope)

  const content = (link: SigningLink) => {
    const details = { recipientName: link.name, senderName: sender.name, title: envelope.title, link: `${appUrl}/sign/${link.token}`, logoUrl }
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

/**
 * Tell the sender that someone signed and who is still to sign (unless the sender signed it
 * themselves). Best effort: a failure is recorded in the audit trail.
 */
export async function emailSenderSigned(envelopeId: string, recipientId: string) {
  const { data: envelope, error } = await admin
    .from('envelopes')
    .select(`title, ${OWNER_SELECT}, recipients (id, name, email, role, status)`)
    .eq('id', envelopeId)
    .single()
  if (error) throw error
  const owner = ownerOf(envelope)
  // deno-lint-ignore no-explicit-any
  const recipients = envelope.recipients as any[]
  const signer = recipients.find(r => r.id === recipientId)
  if (!signer || !owner.email || signer.email?.toLowerCase() === owner.email.toLowerCase()) return
  const waitingOn = recipients.filter(r => r.role === 'signer' && r.status !== 'signed').map(r => r.name)
  await emailSender(envelopeId, owner, 'signed_notice', (links) =>
    signedEmail({ ownerName: owner.name, recipientName: signer.name, title: envelope.title, waitingOn, ...links }))
}

type EmailContent = { subject: string; html: string; text: string }

/**
 * Email the sender about their envelope. `build` gets the envelope's link and the logo.
 * Best effort: a failure is logged and recorded in the audit trail as `kind`.
 */
export async function emailSender(
  envelopeId: string,
  owner: { email: string },
  kind: string,
  build: (links: { link: string; logoUrl: string }) => EmailContent
) {
  try {
    const { appUrl, logoUrl } = emailConfig()
    await sendEmail({ to: owner.email, ...build({ link: `${appUrl}/envelopes/${envelopeId}`, logoUrl }) })
  } catch (err) {
    console.error(err)
    await audit({ envelopeId, action: 'email_failed', details: { email: owner.email, kind } })
  }
}
