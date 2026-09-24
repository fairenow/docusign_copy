/**
 * Pure envelope logic shared by the dashboard and the editor:
 * row <-> editor-state mapping, draft validation and dashboard grouping.
 * No Supabase or DOM access here, so it is covered by unit tests.
 */
import { FIELD_LABELS, createElement, newId } from './fields'

export const RECIPIENT_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4d7c0f']

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// ---------------------------------------------------------------------------
// Mapping between database rows and editor state
// ---------------------------------------------------------------------------

export function recipientFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    routingOrder: row.routing_order,
    color: row.color || RECIPIENT_COLORS[0],
    status: row.status,
    signedAt: row.signed_at ?? null
  }
}

export function recipientToRow(recipient) {
  return {
    id: recipient.id,
    name: recipient.name.trim(),
    email: recipient.email.trim(),
    role: recipient.role,
    routing_order: recipient.routingOrder,
    color: recipient.color
  }
}

export function fieldFromRow(row) {
  return {
    id: row.id,
    type: row.type,
    page: row.page,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    recipientId: row.recipient_id,
    required: row.required,
    label: row.label ?? '',
    fontSize: row.font_size
  }
}

export function fieldToRow(field) {
  return {
    id: field.id,
    recipient_id: field.recipientId,
    page: field.page,
    type: field.type,
    x: field.x,
    y: field.y,
    w: field.w,
    h: field.h,
    required: field.required,
    label: field.label?.trim() || null,
    font_size: field.fontSize
  }
}

/** Editor state for a freshly loaded envelope row (with nested recipients and fields). */
export function draftFromEnvelope(envelope) {
  const recipients = (envelope.recipients ?? [])
    .map(recipientFromRow)
    .sort((a, b) => a.routingOrder - b.routingOrder || a.name.localeCompare(b.name))
  return {
    title: envelope.title,
    message: envelope.message ?? '',
    signingOrder: envelope.signing_order,
    recipients,
    fields: (envelope.fields ?? []).map(fieldFromRow)
  }
}

/**
 * A new placeholder field assigned to a recipient, placed on `page`.
 * Only the properties stored in the database are kept.
 */
export function newField(type, { page, pageSize }, recipientId, props = {}) {
  const el = createElement(type, { page, pageSize }, props)
  return {
    id: el.id,
    type,
    page,
    x: el.x,
    y: el.y,
    w: el.w,
    h: el.h,
    recipientId,
    // A checkbox is an optional choice by default; everything else must be filled in
    required: type !== 'checkbox',
    label: '',
    fontSize: el.fontSize ?? 12
  }
}

// ---------------------------------------------------------------------------
// Recipients
// ---------------------------------------------------------------------------

export function newRecipient(existing) {
  const used = new Set(existing.map(r => r.color))
  const color = RECIPIENT_COLORS.find(c => !used.has(c)) ?? RECIPIENT_COLORS[existing.length % RECIPIENT_COLORS.length]
  const maxOrder = existing.reduce((max, r) => Math.max(max, r.routingOrder), 0)
  return { id: newId(), name: '', email: '', role: 'signer', routingOrder: maxOrder + 1, color, status: 'pending' }
}

/** Renumber routing orders 1..n in the given array order. */
export function renumberRecipients(recipients) {
  return recipients.map((r, i) => ({ ...r, routingOrder: i + 1 }))
}

export function moveRecipient(recipients, id, delta) {
  const index = recipients.findIndex(r => r.id === id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= recipients.length) return recipients
  const next = [...recipients]
  ;[next[index], next[target]] = [next[target], next[index]]
  return renumberRecipients(next)
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Problems that prevent the draft from being saved (the database would reject it).
 * Returns an array of human-readable messages; empty means savable.
 */
export function validateForSave({ title, recipients, fields }) {
  const problems = []
  if (!title.trim()) problems.push('Give the envelope a title.')
  if (title.trim().length > 200) problems.push('The title must be 200 characters or fewer.')

  const emails = new Map()
  recipients.forEach((r, i) => {
    const who = r.name.trim() || `Recipient ${i + 1}`
    if (!r.name.trim()) problems.push(`Recipient ${i + 1} needs a name.`)
    if (!EMAIL_PATTERN.test(r.email.trim())) problems.push(`${who} needs a valid email address.`)
    const key = r.email.trim().toLowerCase()
    if (key) {
      if (emails.has(key)) problems.push(`${who} has the same email as ${emails.get(key)}.`)
      else emails.set(key, who)
    }
  })

  const ids = new Set(recipients.map(r => r.id))
  const orphans = fields.filter(f => !ids.has(f.recipientId)).length
  if (orphans) problems.push(`${orphans} field${orphans > 1 ? 's are' : ' is'} not assigned to a recipient.`)
  return problems
}

/**
 * Additional problems that prevent sending. Includes every save problem.
 */
export function validateForSend(draft) {
  const problems = validateForSave(draft)
  const signers = draft.recipients.filter(r => r.role === 'signer')
  if (!signers.length) problems.push('Add at least one signer.')

  for (const signer of signers) {
    const theirs = draft.fields.filter(f => f.recipientId === signer.id)
    if (!theirs.some(f => f.type === 'signature')) {
      problems.push(`${signer.name.trim() || 'A signer'} has no signature field.`)
    }
  }
  for (const cc of draft.recipients.filter(r => r.role === 'cc')) {
    if (draft.fields.some(f => f.recipientId === cc.id)) {
      problems.push(`${cc.name.trim() || 'A CC recipient'} receives a copy only and cannot have fields.`)
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const ENVELOPE_GROUPS = [
  { id: 'action', label: 'Action required' },
  { id: 'waiting', label: 'Waiting for others' },
  { id: 'draft', label: 'Drafts' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'All' }
]

/** Signers whose turn it is (all unsigned signers for parallel envelopes). */
export function currentSigners(envelope) {
  const pending = (envelope.recipients ?? []).filter(r => r.role === 'signer' && r.status !== 'signed')
  if (envelope.signing_order === 'parallel' || !pending.length) return pending
  const turn = Math.min(...pending.map(r => r.routing_order))
  return pending.filter(r => r.routing_order === turn)
}

/** Which dashboard group an envelope belongs to for the given user. */
export function envelopeGroup(envelope, user) {
  switch (envelope.status) {
    case 'draft':
      return 'draft'
    case 'completed':
      return 'completed'
    case 'sent': {
      const email = user.email?.toLowerCase()
      const myTurn = currentSigners(envelope).some(r => r.email.toLowerCase() === email && r.status !== 'declined')
      return myTurn ? 'action' : 'waiting'
    }
    default:
      return 'closed' // declined / voided: only under "All"
  }
}

export function filterEnvelopes(envelopes, groupId, user) {
  if (groupId === 'all') return envelopes
  return envelopes.filter(e => envelopeGroup(e, user) === groupId)
}

export const STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Out for signature',
  completed: 'Completed',
  declined: 'Declined',
  voided: 'Voided'
}

/** e.g. "2 signature, 1 date signed" */
export function fieldSummary(fields) {
  const counts = {}
  for (const f of fields) counts[f.type] = (counts[f.type] ?? 0) + 1
  return Object.entries(counts).map(([type, n]) => `${n} ${FIELD_LABELS[type].toLowerCase()}`).join(', ')
}
