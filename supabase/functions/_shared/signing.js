/**
 * Signer input rules shared by the signing page and the Edge Functions.
 * The database re-checks everything; these give fast, friendly feedback.
 */

// Matches the database limit for signature/initials values (a PNG data URL)
export const MAX_IMAGE_VALUE_LENGTH = 300000
export const MAX_TEXT_VALUE_LENGTH = 2000
const PNG_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/

/** "Date signed" as the server records it: the UTC date as MM/DD/YYYY. */
export function signingDate(date = new Date()) {
  const iso = date.toISOString()
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`
}

/** "Jane Q. Doe" -> "JQD" */
export function initialsOf(name) {
  return (name || '').split(/\s+/).filter(Boolean).map(part => part[0].toUpperCase()).join('').slice(0, 4)
}

export function fieldLabel(field) {
  return field.label?.trim() || { signature: 'Signature', initials: 'Initials', text: 'Text', date: 'Date signed', checkbox: 'Checkbox' }[field.type]
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
