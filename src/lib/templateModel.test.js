import { describe, it, expect } from 'vitest'
import { defaultTemplateRoles, validateTemplateRoles, templateRolesToRows, initialPeople, validatePeople, peopleToRows, sortedRoles } from './templateModel'
import { fitWidthZoom } from './viewer'
import { draftFromEnvelope, reminderSummary } from './envelopeModel'

const recipients = [
  { id: 'r1', name: 'Me Myself', email: 'Me@flmlnk.com', role: 'signer', color: '#111111' },
  { id: 'r2', name: 'Client', email: 'client@example.com', role: 'signer', color: '#222222' },
  { id: 'r3', name: 'Lawyer', email: 'law@example.com', role: 'cc', color: '#333333' }
]

describe('saving a template', () => {
  it('names roles by kind and keeps the sender as a fixed person', () => {
    const roles = defaultTemplateRoles(recipients, 'me@flmlnk.com')
    expect(roles.map(r => [r.name, r.keepRecipient])).toEqual([['Sender', true], ['Signer 2', false], ['Copy 1', false]])
    expect(defaultTemplateRoles([{ ...recipients[1], name: '', email: '' }], 'me@flmlnk.com')[0]).toMatchObject({ canKeep: false, keepRecipient: false })
    expect(templateRolesToRows(roles.map(r => ({ ...r, name: ` ${r.name} ` })))).toEqual([
      { recipient_id: 'r1', name: 'Sender', keep_recipient: true },
      { recipient_id: 'r2', name: 'Signer 2', keep_recipient: false },
      { recipient_id: 'r3', name: 'Copy 1', keep_recipient: false }
    ])
  })

  it('requires a name, a signer and distinct role names', () => {
    const roles = defaultTemplateRoles(recipients, 'nobody@flmlnk.com')
    expect(validateTemplateRoles('NDA', roles)).toEqual([])
    expect(validateTemplateRoles(' ', roles)).toEqual(['Give the template a name.'])
    expect(validateTemplateRoles('NDA', [{ ...roles[0], name: 'client' }, { ...roles[1], name: 'Client ' }])[0]).toMatch(/Two roles are called "Client"/)
    expect(validateTemplateRoles('NDA', [{ ...roles[0], name: '' }])).toEqual(['Role 1 needs a name.'])
    expect(validateTemplateRoles('NDA', [roles[2]])).toEqual(['Add at least one signer before saving a template.'])
  })
})

describe('using a template', () => {
  const template = {
    template_roles: [
      { id: 'b', name: 'Company', routing_order: 2, default_name: 'Me', default_email: 'me@flmlnk.com' },
      { id: 'a', name: 'Client', routing_order: 1, default_name: null, default_email: null }
    ]
  }

  it('lists roles in signing order and fills in fixed people', () => {
    expect(sortedRoles(template).map(r => r.id)).toEqual(['a', 'b'])
    expect(initialPeople(template)).toEqual({ a: { name: '', email: '' }, b: { name: 'Me', email: 'me@flmlnk.com' } })
  })

  it('requires a name and a distinct valid email for every role', () => {
    const people = initialPeople(template)
    expect(validatePeople(template, people)).toEqual(['Enter a name for Client.', 'Enter a valid email for Client.'])
    const dup = { ...people, a: { name: 'Acme', email: 'ME@flmlnk.com ' } }
    expect(validatePeople(template, dup)).toEqual(['Company and Client have the same email. Each person needs a different email.'])
    const ok = { ...people, a: { name: ' Acme ', email: ' acme@example.com ' } }
    expect(validatePeople(template, ok)).toEqual([])
    expect(peopleToRows(ok).a).toEqual({ name: 'Acme', email: 'acme@example.com' })
  })
})

describe('reminders and expiration', () => {
  it('reads settings from the envelope, with defaults', () => {
    expect(draftFromEnvelope({ title: 'T', signing_order: 'parallel', remind_every_days: 3, expire_after_days: 14 }))
      .toMatchObject({ remindEveryDays: 3, expireAfterDays: 14 })
    expect(draftFromEnvelope({ title: 'T', signing_order: 'parallel' })).toMatchObject({ remindEveryDays: null, expireAfterDays: 30 })
  })

  it('describes the reminder interval', () => {
    expect([null, 1, 3, 7].map(reminderSummary)).toEqual(['No automatic reminders', 'Reminders every day', 'Reminders every 3 days', 'Reminders every week'])
  })
})

describe('fitWidthZoom', () => {
  const letter = [{ width: 612, height: 792 }]
  it('shrinks pages to fit a phone and never zooms past 100%', () => {
    expect(fitWidthZoom(letter, 375)).toBeCloseTo((375 - 16) / (612 * 1.5))
    expect(fitWidthZoom(letter, 1920)).toBe(1)
    expect(fitWidthZoom([], 375)).toBe(1)
  })
})
