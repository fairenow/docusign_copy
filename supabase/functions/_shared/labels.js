/**
 * Labels shared by the app, the certificate and emails. No dependencies, so the
 * browser can import it without pulling in pdf-lib.
 */

export const DEFAULT_FONT_SIZE = 12

export const FIELD_LABELS = {
  signature: 'Signature',
  initials: 'Initials',
  text: 'Text',
  date: 'Date signed',
  checkbox: 'Checkbox',
  // Text the sender types before sending; printed into the document
  prefill: 'Fill in now'
}

export const ACTION_LABELS = {
  envelope_created: 'Envelope created',
  envelope_sent: 'Sent for signature',
  recipient_notified: 'Signing request emailed',
  recipient_signing_in_app: 'Signing in the app (no email)',
  recipient_reminded: 'Signing link re-sent',
  recipient_auto_reminded: 'Reminder emailed',
  recipient_viewed: 'Viewed',
  fields_adjusted: 'Adjusted field positions',
  recipient_signed: 'Signed',
  recipient_declined: 'Declined',
  email_failed: 'Email could not be delivered',
  finalize_failed: 'Finishing the document failed',
  envelope_completed: 'Completed',
  envelope_declined: 'Declined',
  envelope_voided: 'Voided',
  envelope_expired: 'Expired'
}
