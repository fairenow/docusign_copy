/**
 * Pure envelope logic shared by the dashboard and the editor:
 * row <-> editor-state mapping, draft validation and dashboard grouping.
 * No Supabase or DOM access here, so it is covered by unit tests.
 */
import { DEFAULT_FONT_SIZE, newId, placeField } from './fields'
import { daysUntil, timeAgo } from './format'

export const RECIPIENT_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4d7c0f']

export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// ---------------------------------------------------------------------------
// Mapping between database rows and editor state
// ---------------------------------------------------------------------------

function recipientFromRow(row) {
  return {
    id: row.id,
    name: row.name ?? '',
    email: row.email ?? '',
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

function fieldFromRow(row) {
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
    fontSize: row.font_size,
    ...(row.type === 'prefill' && { text: row.prefill ?? '' }),
    // What the signer filled in (once signed)
    ...(row.value != null && { value: row.value })
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
    font_size: field.fontSize,
    prefill: field.type === 'prefill' ? field.text?.trim() || null : null
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
    remindEveryDays: envelope.remind_every_days ?? null,
    expireAfterDays: envelope.expire_after_days ?? DEFAULT_EXPIRE_DAYS,
    allowSignerAdjustments: envelope.allow_signer_adjustments ?? false,
    recipients,
    fields: (envelope.fields ?? []).map(fieldFromRow)
  }
}

/**
 * A new placeholder field assigned to a recipient, placed on `page`.
 * Only the properties stored in the database are kept.
 */
export function newField(type, placement, recipientId, props = {}) {
  const prefill = type === 'prefill'
  return {
    ...placeField(type, placement, props),
    // "Fill in now" fields belong to no recipient: the sender types their text
    recipientId: prefill ? null : recipientId,
    // A checkbox is an optional choice by default; everything else must be filled in
    required: type !== 'checkbox',
    label: props.label ?? '',
    fontSize: DEFAULT_FONT_SIZE,
    ...(prefill && { text: props.text ?? '' })
  }
}

/** Name of a "Fill in now" field in messages: its label, or a generic one. */
const prefillName = (field) => field.label?.trim() || 'Fill in now'

// ---------------------------------------------------------------------------
// Reminders and expiration
// ---------------------------------------------------------------------------

const DEFAULT_EXPIRE_DAYS = 30

/** Reminder choices in days; null turns reminders off. */
export const REMINDER_OPTIONS = [
  { value: null, label: 'Off' },
  { value: 1, label: 'Every day' },
  { value: 2, label: 'Every 2 days' },
  { value: 3, label: 'Every 3 days' },
  { value: 5, label: 'Every 5 days' },
  { value: 7, label: 'Every week' }
]

export const EXPIRY_OPTIONS = [7, 14, 30, 60, 90, 120].map(days => ({ value: days, label: `${days} days` }))

/** Plain-language summary, e.g. "Reminders every 3 days" or "No reminders". */
export function reminderSummary(days) {
  if (!days) return 'No automatic reminders'
  return days === 1 ? 'Reminders every day' : days === 7 ? 'Reminders every week' : `Reminders every ${days} days`
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

/** Whether two email addresses are the same person (ignoring case and spaces); false if either is missing. */
export function sameEmail(a, b) {
  const x = a?.trim().toLowerCase()
  return Boolean(x) && x === b?.trim().toLowerCase()
}

/** The recipient with this email (case-insensitive), if any. */
export function recipientByEmail(recipients, email) {
  return recipients.find(r => sameEmail(r.email, email))
}

/** A signer nobody has been named for yet (e.g. created by placing a field first). */
const isBlankSigner = (r) => r.role === 'signer' && !r.name.trim() && !r.email.trim()

/**
 * "I need to sign this document": add the sender as the first signer (they can reorder).
 * If they are already a recipient, they become a signer instead of being added twice; if
 * fields were placed for a signer not named yet, the sender becomes that signer.
 */
export function addSelfAsSigner(recipients, { name, email }) {
  const existing = recipientByEmail(recipients, email)
  if (existing) return recipients.map(r => (r === existing ? { ...r, role: 'signer' } : r))
  const blank = recipients.find(isBlankSigner)
  if (blank) return recipients.map(r => (r === blank ? { ...r, name, email } : r))
  const me = { ...newRecipient(recipients), name, email }
  return renumberRecipients([me, ...recipients])
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
 * A recipient may be left blank while drafting (for example when preparing a template);
 * an email that is filled in must be valid. Returns human-readable messages; empty means savable.
 */
export function validateForSave({ title, recipients, fields }) {
  const problems = []
  if (!title.trim()) problems.push('Give the envelope a title.')
  if (title.trim().length > 200) problems.push('The title must be 200 characters or fewer.')

  const emails = new Map()
  recipients.forEach((r, i) => {
    const who = r.name.trim() || `Recipient ${i + 1}`
    const email = r.email.trim()
    if (email && !EMAIL_PATTERN.test(email)) {
      problems.push(`${who}: "${email}" is not an email address.`)
    }
    const key = email.toLowerCase()
    if (key) {
      if (emails.has(key)) problems.push(`${who} has the same email as ${emails.get(key)}.`)
      else emails.set(key, who)
    }
  })

  for (const f of fields) {
    if (f.type === 'prefill' && (f.text ?? '').trim().length > 500) problems.push(`"${prefillName(f)}" must be 500 characters or fewer.`)
  }

  const ids = new Set(recipients.map(r => r.id))
  const orphans = fields.filter(f => f.type !== 'prefill' && !ids.has(f.recipientId)).length
  if (orphans) problems.push(`${orphans} field${orphans > 1 ? 's are' : ' is'} not assigned to a recipient.`)
  return problems
}

/**
 * Additional problems that prevent sending. Includes every save problem.
 */
export function validateForSend(draft) {
  const problems = validateForSave(draft)
  draft.recipients.forEach((r, i) => {
    const who = r.name.trim() || `Recipient ${i + 1}`
    if (!r.name.trim()) problems.push(`Recipient ${i + 1} needs a name.`)
    if (!r.email.trim()) problems.push(`${who} needs an email address.`)
  })
  for (const f of draft.fields) {
    if (f.type === 'prefill' && !(f.text ?? '').trim()) problems.push(`Fill in "${prefillName(f)}" before sending.`)
  }
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
      const myTurn = currentSigners(envelope).some(r => sameEmail(r.email, user.email) && r.status !== 'declined')
      return myTurn ? 'action' : 'waiting'
    }
    default:
      return 'closed' // declined / voided / expired: only under "All"
  }
}

// An envelope this close to expiring says so
const EXPIRY_WARNING_DAYS = 3
// Signing links can be resent by hand this often (the database enforces it too)
const REMIND_INTERVAL_MS = 10 * 60_000

const latest = (dates) => dates.filter(Boolean).sort().at(-1) ?? null
const namesOf = (people) => (people.length > 2
  ? `${people.slice(0, 2).map(r => r.name).join(', ')} and ${people.length - 2} more`
  : people.map(r => r.name).join(' and '))

/**
 * One line on where an envelope stands, for the dashboard:
 * { text: 'Waiting on Carol · sent 3 days ago · not opened yet', tone: 'waiting' | 'warning' | 'done' | 'problem' | 'draft' }
 */
export function envelopeProgress(envelope, user, now = Date.now()) {
  const recipients = envelope.recipients ?? []
  const signers = recipients.filter(r => r.role === 'signer')
  switch (envelope.status) {
    case 'draft':
      return { text: `Draft · edited ${timeAgo(envelope.updated_at, now)}`, tone: 'draft' }
    case 'completed':
      return { text: `Completed ${timeAgo(envelope.completed_at ?? envelope.updated_at, now)}`, tone: 'done' }
    case 'declined': {
      const who = recipients.find(r => r.status === 'declined')
      return { text: `Declined by ${who?.name ?? 'a signer'} ${timeAgo(who?.declined_at ?? envelope.updated_at, now)}`, tone: 'problem' }
    }
    case 'voided':
      return { text: `Voided ${timeAgo(envelope.voided_at ?? envelope.updated_at, now)}`, tone: 'problem' }
    case 'expired':
      return { text: `Expired ${timeAgo(envelope.expires_at ?? envelope.updated_at, now)}`, tone: 'problem' }
    case 'sent': {
      const waiting = currentSigners(envelope).filter(r => r.status !== 'declined')
      const mine = waiting.some(r => sameEmail(r.email, user?.email))
      const others = waiting.filter(r => !sameEmail(r.email, user?.email))
      const parts = []
      const signed = signers.filter(r => r.status === 'signed').length
      if (signers.length > 1) parts.push(`${signed} of ${signers.length} signed`)
      parts.push(mine
        ? (others.length ? `Waiting on you and ${namesOf(others)}` : 'Waiting on you')
        : `Waiting on ${namesOf(waiting) || 'the signers'}`)
      const sentAt = latest(waiting.map(r => r.sent_at)) ?? envelope.sent_at
      if (sentAt) parts.push(`sent ${timeAgo(sentAt, now)}`)
      if (!mine && waiting.length) {
        const viewed = latest(waiting.map(r => r.viewed_at))
        parts.push(viewed ? `opened ${timeAgo(viewed, now)}` : 'not opened yet')
      }
      const reminded = latest(waiting.map(r => r.last_reminded_at))
      if (reminded && (!sentAt || reminded > sentAt)) parts.push(`reminded ${timeAgo(reminded, now)}`)
      const days = envelope.expires_at ? daysUntil(envelope.expires_at, now) : null
      const expiring = days !== null && days <= EXPIRY_WARNING_DAYS
      if (expiring) parts.push(`expires ${days === 1 ? 'within a day' : `in ${days} days`}`)
      return { text: parts.join(' · '), tone: expiring ? 'warning' : 'waiting' }
    }
    default:
      return { text: '', tone: 'draft' }
  }
}

/**
 * Who a Remind would email now (the signers whose turn it is), and when it can next be sent:
 * { recipients, availableAt } (availableAt is null when it can be sent now).
 */
export function remindTargets(envelope, user, now = Date.now()) {
  if (envelope.status !== 'sent') return { recipients: [], availableAt: null }
  const recipients = currentSigners(envelope)
    .filter(r => (r.status === 'sent' || r.status === 'viewed') && !sameEmail(r.email, user?.email))
  const last = latest(recipients.map(r => r.last_reminded_at))
  const next = last ? new Date(last).getTime() + REMIND_INTERVAL_MS : 0
  return { recipients, availableAt: next > now ? next : null }
}

/**
 * Envelopes bucketed by dashboard group in one pass: { all, action, waiting, draft, completed, closed }.
 */
export function groupEnvelopes(envelopes, user) {
  const groups = { all: envelopes, action: [], waiting: [], draft: [], completed: [], closed: [] }
  for (const e of envelopes) groups[envelopeGroup(e, user)].push(e)
  return groups
}

// ---------------------------------------------------------------------------
// Permissions (the database enforces these; the UI uses them to show actions)
// ---------------------------------------------------------------------------

// Only the sender edits and sends a draft. Admins (a fixed list in the database) may also
// delete any draft and void, resend or finish any sent envelope, but never act as the sender.
/** You are the only signer: the envelope can be signed right away, without emailing yourself. */
export const signsAlone = (draft, user) => {
  const signers = draft.recipients.filter(r => r.role === 'signer')
  return signers.length > 0 && signers.every(r => sameEmail(r.email, user?.email))
}

/** Whether `user` created this envelope (or template). */
export const isOwner = (envelope, user) => Boolean(user && envelope) && envelope.owner_id === user.id

export const canEdit = (envelope, user) => isOwner(envelope, user) && envelope.status === 'draft'
export const canDelete = (envelope, user, isAdmin = false) => (isOwner(envelope, user) || isAdmin) && envelope.status === 'draft'
export const canVoid = (envelope, user, isAdmin = false) => (isOwner(envelope, user) || isAdmin) && envelope.status === 'sent'
/** Templates are edited and deleted by whoever made them, or an admin. */
export const canManageTemplate = (template, user, isAdmin = false) => isOwner(template, user) || isAdmin

/** Sent by the user, or sent to them. What a member sees; an admin's "Mine" view. */
/** Shared with this user by its owner or an admin: they can view it and comment. */
export const isSharedWith = (envelope, user) => Boolean(user) && (envelope?.envelope_shares ?? []).some(s => s.user_id === user.id)

export const isMine = (envelope, user) => isOwner(envelope, user) || isSharedWith(envelope, user) ||
  (envelope.status !== 'draft' && (envelope.recipients ?? []).some(r => sameEmail(r.email, user?.email)))

export const senderName = (envelope) => envelope.owner?.full_name || envelope.owner?.email || 'A teammate'

/** Case-insensitive search over title, sender and recipients. */
export function matchesSearch(envelope, query) {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [envelope.title, envelope.owner?.full_name, envelope.owner?.email, ...(envelope.recipients ?? []).flatMap(r => [r.name, r.email])]
    .some(text => text?.toLowerCase().includes(q))
}

export const STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Out for signature',
  completed: 'Completed',
  declined: 'Declined',
  voided: 'Voided',
  expired: 'Expired'
}

export const RECIPIENT_STATUS = {
  pending: { label: 'Not sent', icon: '·' },
  sent: { label: 'Sent', icon: '✉' },
  viewed: { label: 'Viewed', icon: '👁' },
  signed: { label: 'Signed', icon: '✓' },
  declined: { label: 'Declined', icon: '✕' }
}

// ---------------------------------------------------------------------------
// Collaboration: who can see an envelope, and comments
// ---------------------------------------------------------------------------

export const displayName = (person) => person?.full_name || person?.email || 'A teammate'

/**
 * Ids of the teammates who can see an envelope, as the database decides: its owner, admins,
 * teammates it is shared with and, once sent, teammates who are its recipients.
 */
export function peopleWithAccess(envelope, team) {
  const ids = new Set([envelope.owner_id, ...(envelope.envelope_shares ?? []).map(s => s.user_id)])
  for (const person of team) {
    if (person.role === 'admin') ids.add(person.id)
    if (envelope.status !== 'draft' && (envelope.recipients ?? []).some(r => sameEmail(r.email, person.email))) ids.add(person.id)
  }
  return ids
}

/** Top-level comments, oldest first, each with its replies (oldest first). */
export function commentThreads(comments) {
  const byTime = [...comments].sort((a, b) => a.created_at.localeCompare(b.created_at))
  return byTime.filter(c => !c.parent_id).map(c => ({ ...c, replies: byTime.filter(r => r.parent_id === c.id) }))
}

/** The people whose "@Name" is still in the text (a mention can be typed and then deleted). */
export function mentionsIn(body, people) {
  return people.filter(p => body.includes(`@${displayName(p)}`)).map(p => p.id)
}
