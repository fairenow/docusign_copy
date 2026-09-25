// Signing API: one Edge Function, routed by the last path segment.
//
//   POST /signing-api/send      { envelopeId, signNow? }                signed-in owner
//   POST /signing-api/resend    { envelopeId, recipientId }             signed-in owner
//   POST /signing-api/finalize  { envelopeId }                          signed-in owner/admin (retry)
//   POST /signing-api/session   { token } | { envelopeId }              signer (link or team member)
//   POST /signing-api/submit    { token | envelopeId, values, consent } signer
//   POST /signing-api/decline   { token | envelopeId, reason }          signer
//   POST /signing-api/mention   { commentId }                           comment author (emails mentions)
//   POST /signing-api/share     { envelopeId, userId }                  whoever shared (emails the teammate)
//   POST /signing-api/reminders (x-reminders-secret header)             hourly pg_cron job
//
// JWT verification is done in code (getUser), because signers with a link have no session.
import { serve, HttpError } from '../_shared/http.ts'
import { sendEnvelope } from '../_shared/handlers/send-envelope.ts'
import { resendSigningLink } from '../_shared/handlers/resend-signing-link.ts'
import { finalizeEnvelopeHandler } from '../_shared/handlers/finalize-envelope.ts'
import { signingSession } from '../_shared/handlers/signing-session.ts'
import { submitSigning } from '../_shared/handlers/submit-signing.ts'
import { declineSigning } from '../_shared/handlers/decline-signing.ts'
import { runReminders } from '../_shared/handlers/run-reminders.ts'
import { notifyComment } from '../_shared/handlers/notify-comment.ts'
import { notifyShare } from '../_shared/handlers/notify-share.ts'

const routes: Record<string, (req: Request) => Promise<Response>> = {
  send: sendEnvelope,
  resend: resendSigningLink,
  finalize: finalizeEnvelopeHandler,
  session: signingSession,
  submit: submitSigning,
  decline: declineSigning,
  reminders: runReminders,
  mention: notifyComment,
  share: notifyShare
}

serve((req) => {
  const route = routes[new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '']
  if (!route) throw new HttpError(404, 'Not found')
  return route(req)
})
