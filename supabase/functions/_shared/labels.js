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
  checkbox: 'Checkbox'
}

export const ACTION_LABELS = {
  envelope_created: 'Envelope created',
  envelope_sent: 'Sent for signature',
  recipient_notified: 'Signing request emailed',
  recipient_reminded: 'Signing link re-sent',
  recipient_viewed: 'Viewed',
  recipient_signed: 'Signed',
  recipient_declined: 'Declined',
  email_failed: 'Email could not be delivered',
  finalize_failed: 'Finishing the document failed',
  envelope_completed: 'Completed',
  envelope_declined: 'Declined',
  envelope_voided: 'Voided'
}
