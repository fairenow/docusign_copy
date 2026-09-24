import { emailConfig } from './config.ts'

export interface Email {
  to: string
  subject: string
  html: string
  text: string
  attachments?: { filename: string; content: string }[] // content is base64
}

export async function sendEmail(email: Email): Promise<void> {
  const { from, apiKey } = emailConfig()
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [email.to], subject: email.subject, html: email.html, text: email.text, attachments: email.attachments })
  })
  if (!res.ok) throw new Error(`Email to ${email.to} failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
}
