import { emailConfig } from './config.ts'
import { sendEmail } from './mail.ts'
import { admin, audit } from './supabase.ts'
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
  let appUrl: string
  try {
    appUrl = emailConfig().appUrl
  } catch (err) {
    // Not configured: record every undelivered link so the sender can see and resend
    for (const link of links) {
      await audit(envelopeId, 'email_failed', { email: link.email, kind: 'signing_request', reason: (err as Error).message }, link.recipient_id)
    }
    throw err
  }
  const { data: envelope, error } = await admin
    .from('envelopes')
    .select('title, message, owner:profiles!envelopes_owner_id_fkey (full_name, email)')
    .eq('id', envelopeId)
    .single()
  if (error) throw error
  // deno-lint-ignore no-explicit-any
  const owner = envelope.owner as any
  const senderName = owner?.full_name || owner?.email || 'A DocSign user'

  const failed: string[] = []
  for (const link of links) {
    try {
      await sendEmail({
        to: link.email,
        ...signingRequestEmail({
          recipientName: link.name,
          senderName,
          title: envelope.title,
          message: envelope.message,
          link: `${appUrl}/sign/${link.token}`
        })
      })
    } catch (err) {
      console.error(err)
      failed.push(link.email)
      await audit(envelopeId, 'email_failed', { email: link.email, kind: 'signing_request' }, link.recipient_id)
    }
  }
  return { sent: links.length - failed.length, failed }
}
