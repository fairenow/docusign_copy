/**
 * Pure template logic: default roles when saving an envelope as a template, and the
 * people filled in when using one. Covered by unit tests; no Supabase access here.
 */
import { EMAIL_PATTERN, recipientByEmail } from './envelopeModel'

/**
 * Roles for "Save as template", one per recipient in signing order: "Signer 1", "Signer 2",
 * "Copy 1"… The sender's own entry is named "Sender" and keeps them as the person.
 */
export function defaultTemplateRoles(recipients, myEmail) {
  const me = recipientByEmail(recipients, myEmail)
  const counts = { signer: 0, cc: 0 }
  return recipients.map(r => {
    counts[r.role] += 1
    const isMe = r === me
    // Only someone already filled in can stay the fixed person on the template
    const canKeep = Boolean(r.name.trim() && r.email.trim())
    return {
      recipientId: r.id,
      person: r.name,
      canKeep,
      role: r.role,
      color: r.color,
      name: isMe ? 'Sender' : `${r.role === 'cc' ? 'Copy' : 'Signer'} ${counts[r.role]}`,
      keepRecipient: isMe && canKeep
    }
  })
}

/** Problems with a template name and its role names; empty means it can be saved. */
export function validateTemplateRoles(name, roles) {
  const problems = []
  if (!name.trim()) problems.push('Give the template a name.')
  if (!roles.some(r => r.role === 'signer')) problems.push('Add at least one signer before saving a template.')
  const seen = new Set()
  roles.forEach((r, i) => {
    const key = r.name.trim().toLowerCase()
    if (!key) problems.push(`Role ${i + 1} needs a name.`)
    else if (seen.has(key)) problems.push(`Two roles are called "${r.name.trim()}". Give each role a different name.`)
    seen.add(key)
  })
  return problems
}

/** Arguments for create_template_from_envelope. */
export const templateRolesToRows = (roles) =>
  roles.map(r => ({ recipient_id: r.recipientId, name: r.name.trim(), keep_recipient: r.keepRecipient }))

/** The template's roles in signing order. */
export const sortedRoles = (template) =>
  [...(template.template_roles ?? [])].sort((a, b) => a.routing_order - b.routing_order || a.name.localeCompare(b.name))

/** Starting values for "Use template": fixed people are filled in, everyone else is blank. */
export function initialPeople(template) {
  return Object.fromEntries(sortedRoles(template).map(r => [r.id, { name: r.default_name ?? '', email: r.default_email ?? '' }]))
}

/** Problems with the people entered for each role; empty means the envelope can be created. */
export function validatePeople(template, people) {
  const problems = []
  const emails = new Map()
  for (const role of sortedRoles(template)) {
    const { name = '', email = '' } = people[role.id] ?? {}
    if (!name.trim()) problems.push(`Enter a name for ${role.name}.`)
    if (!EMAIL_PATTERN.test(email.trim())) problems.push(`Enter a valid email for ${role.name}.`)
    const key = email.trim().toLowerCase()
    if (key && emails.has(key)) problems.push(`${role.name} and ${emails.get(key)} have the same email. Each person needs a different email.`)
    else if (key) emails.set(key, role.name)
  }
  return problems
}

/** Arguments for create_envelope_from_template: { [roleId]: { name, email } }, trimmed. */
export const peopleToRows = (people) =>
  Object.fromEntries(Object.entries(people).map(([id, p]) => [id, { name: p.name.trim(), email: p.email.trim() }]))
