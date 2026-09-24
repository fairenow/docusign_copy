// POST (hourly, from pg_cron) — expire overdue envelopes and email reminders.
// The job sends a secret that only the database knows; svc_run_reminders checks it.
import { json, HttpError } from '../http.ts'
import { admin, audit, ownerOf, rpc, OWNER_SELECT } from '../supabase.ts'
import { emailConfig } from '../config.ts'
import { sendEmail } from '../mail.ts'
import { emailSigningLinks, type SigningLink } from '../notify.ts'
import { expiredEmail } from '../emails.js'

interface Run {
  expired: { envelope_id: string }[]
  reminders: (SigningLink & { envelope_id: string })[]
}

export async function runReminders(req: Request): Promise<Response> {
  const secret = req.headers.get('x-reminders-secret')
  if (!secret) throw new HttpError(403, 'Not allowed')
  const run = await rpc<Run>('svc_run_reminders', { p_secret: secret })

  // One batch per envelope, so each loads the envelope once
  const byEnvelope = Map.groupBy(run.reminders, (r) => r.envelope_id)
  const results = await Promise.allSettled([
    ...[...byEnvelope].map(([envelopeId, links]) => emailSigningLinks(envelopeId, links, { reminder: true })),
    ...run.expired.map(({ envelope_id }) => notifyOwnerOfExpiry(envelope_id))
  ])
  results.forEach(r => { if (r.status === 'rejected') console.error(r.reason) })
  return json({ reminded: run.reminders.length, expired: run.expired.length })
}

async function notifyOwnerOfExpiry(envelopeId: string) {
  const { data, error } = await admin.from('envelopes').select(`title, ${OWNER_SELECT}`).eq('id', envelopeId).single()
  if (error) throw error
  const owner = ownerOf(data)
  try {
    await sendEmail({
      to: owner.email,
      ...expiredEmail({ ownerName: owner.name, title: data.title, link: `${emailConfig().appUrl}/envelopes/${envelopeId}` })
    })
  } catch (err) {
    await audit({ envelopeId, action: 'email_failed', details: { email: owner.email, kind: 'expired' } })
    throw err
  }
}
