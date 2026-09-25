/**
 * Signer input rules for the signing page. The database enforces the same rules
 * (svc_complete_signing); these give fast, friendly feedback before submitting.
 */
import { FIELD_LABELS } from './labels.js'

// Matches the database limit for signature/initials values (a PNG data URL)
const MAX_IMAGE_VALUE_LENGTH = 300000
const MAX_TEXT_VALUE_LENGTH = 2000
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/

/**
 * "Date signed" as the server records it: MM/DD/YYYY in the signer's time zone (the browser's
 * own zone by default; UTC if the zone is unknown).
 */
export function signingDate(date = new Date(), timeZone = localTimeZone()) {
  let parts
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  }
  const part = (type) => parts.find(p => p.type === type).value
  return `${part('month')}/${part('day')}/${part('year')}`
}

/** The browser's IANA time zone, e.g. "America/Detroit" (undefined where unavailable). */
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

/** "Jane Q. Doe" -> "JQD" */
export function initialsOf(name) {
  return (name || '').split(/\s+/).filter(Boolean).map(part => part[0].toUpperCase()).join('').slice(0, 4)
}

export function fieldLabel(field) {
  return field.label?.trim() || FIELD_LABELS[field.type]
}

/** Whether a field has what it needs. "Date signed" is filled in by the server. */
export function isFieldComplete(field, value) {
  if (field.type === 'date') return true
  if (field.type === 'checkbox') return !field.required || value === true || value === 'true'
  if (!field.required) return true
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Validate and normalize the values a signer submits for their own fields.
 * @returns {{ values: Record<string, string>, problems: string[] }}
 */
export function validateSigningValues(fields, input) {
  const problems = []
  const values = {}
  const byId = new Map(fields.map(f => [f.id, f]))

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { values, problems: ['Invalid submission.'] }
  }
  for (const key of Object.keys(input)) {
    if (!byId.has(key)) problems.push('The submission contains a field that is not yours.')
  }

  for (const field of fields) {
    const raw = input[field.id]
    if (field.type === 'date') continue
    if (field.type === 'checkbox') {
      values[field.id] = raw === true || raw === 'true' ? 'true' : 'false'
    } else if (typeof raw === 'string' && raw.trim() !== '') {
      const value = raw.trim()
      if (field.type === 'signature' || field.type === 'initials') {
        if (!PNG_DATA_URL.test(value) || value.length > MAX_IMAGE_VALUE_LENGTH) {
          problems.push(`${fieldLabel(field)} must be a signature image.`)
          continue
        }
      } else if (value.length > MAX_TEXT_VALUE_LENGTH) {
        problems.push(`${fieldLabel(field)} is too long.`)
        continue
      }
      values[field.id] = value
    } else if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      problems.push(`${fieldLabel(field)} has an invalid value.`)
      continue
    }
    if (!isFieldComplete(field, values[field.id])) problems.push(`Please complete: ${fieldLabel(field)}.`)
  }
  return { values, problems: [...new Set(problems)] }
}

/**
 * How far signers may adjust their own fields while signing: a short move and between half and
 * twice the size the sender chose. svc_complete_signing enforces the same limits (and also
 * refuses covering another signer's field), so a signer cannot restyle the document.
 */
export const ADJUSTMENT_LIMITS = { moveX: 0.15, moveY: 0.10, minScale: 0.5, maxScale: 2 }

/** Whether a signer may move a field: only when the sender allowed it, and never "Date signed". */
export const signerCanMove = (field, allowed) => allowed === true && field.type !== 'date'

/** Keep a move/resize (page fractions) within ADJUSTMENT_LIMITS and on the page. */
export function limitAdjustment(original, next) {
  const { moveX, moveY, minScale, maxScale } = ADJUSTMENT_LIMITS
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value))
  // The size is capped so the field can still sit within its allowed moving range
  const w = clamp(next.w, original.w * minScale, Math.min(original.w * maxScale, 1 - Math.max(0, original.x - moveX)))
  const h = clamp(next.h, original.h * minScale, Math.min(original.h * maxScale, 1 - Math.max(0, original.y - moveY)))
  return {
    x: clamp(next.x, Math.max(0, original.x - moveX), Math.min(1 - w, original.x + moveX)),
    y: clamp(next.y, Math.max(0, original.y - moveY), Math.min(1 - h, original.y + moveY)),
    w,
    h
  }
}
