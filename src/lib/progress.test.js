import { describe, it, expect } from 'vitest'
import { envelopeProgress, remindTargets } from './envelopeModel'
import { timeAgo, daysUntil } from './format'

const NOW = Date.parse('2026-09-25T12:00:00Z')
const ago = (ms) => new Date(NOW - ms).toISOString()
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const me = { id: 'u1', email: 'sara.s@flmlnk.com' }
const signer = (name, over = {}) => ({ id: name, name, email: `${name.toLowerCase()}@example.com`, role: 'signer', routing_order: 1, status: 'sent', sent_at: ago(3 * DAY), ...over })
const sent = (recipients, over = {}) => ({ status: 'sent', signing_order: 'sequential', sent_at: ago(3 * DAY), expires_at: ago(-20 * DAY), recipients, ...over })

describe('relative times', () => {
  it('reads naturally', () => {
    expect(timeAgo(ago(10_000), NOW)).toBe('just now')
    expect(timeAgo(ago(5 * MIN), NOW)).toBe('5 min ago')
    expect(timeAgo(ago(HOUR), NOW)).toBe('1 hour ago')
    expect(timeAgo(ago(5 * HOUR), NOW)).toBe('5 hours ago')
    expect(timeAgo(ago(DAY + HOUR), NOW)).toBe('yesterday')
    expect(timeAgo(ago(4 * DAY), NOW)).toBe('4 days ago')
    expect(timeAgo(ago(10 * DAY), NOW)).toMatch(/^on /)
    expect(daysUntil(ago(-1.5 * DAY), NOW)).toBe(2)
    expect(daysUntil(ago(HOUR), NOW)).toBeNull()
  })
})

describe('envelope progress', () => {
  it('says who it is waiting on, since when, and whether they opened it', () => {
    expect(envelopeProgress(sent([signer('Carol')]), me, NOW))
      .toEqual({ text: 'Waiting on Carol · sent 3 days ago · not opened yet', tone: 'waiting' })
    expect(envelopeProgress(sent([signer('Carol', { status: 'viewed', viewed_at: ago(DAY + HOUR) })]), me, NOW).text)
      .toBe('Waiting on Carol · sent 3 days ago · opened yesterday')
  })

  it('counts signatures and names the signer whose turn it is', () => {
    const e = sent([
      signer('Carol', { status: 'signed', signed_at: ago(DAY) }),
      signer('Dave', { routing_order: 2, sent_at: ago(DAY) }),
      signer('Erin', { routing_order: 3, status: 'pending', sent_at: null })
    ])
    expect(envelopeProgress(e, me, NOW).text).toBe('1 of 3 signed · Waiting on Dave · sent yesterday · not opened yet')
    expect(envelopeProgress({ ...e, signing_order: 'parallel', recipients: e.recipients.map(r => ({ ...r, sent_at: ago(DAY) })) }, me, NOW).text)
      .toBe('1 of 3 signed · Waiting on Dave and Erin · sent yesterday · not opened yet')
  })

  it('puts you first when it is your turn, and mentions reminders and a close deadline', () => {
    const e = sent([signer('Sara', { email: me.email })], { expires_at: ago(-1.5 * DAY) })
    expect(envelopeProgress(e, me, NOW)).toEqual({ text: 'Waiting on you · sent 3 days ago · expires in 2 days', tone: 'warning' })
    const reminded = sent([signer('Carol', { last_reminded_at: ago(2 * HOUR) })])
    expect(envelopeProgress(reminded, me, NOW).text).toBe('Waiting on Carol · sent 3 days ago · not opened yet · reminded 2 hours ago')
  })

  it('summarises finished and closed envelopes', () => {
    expect(envelopeProgress({ status: 'draft', updated_at: ago(2 * HOUR), recipients: [] }, me, NOW)).toEqual({ text: 'Draft · edited 2 hours ago', tone: 'draft' })
    expect(envelopeProgress({ status: 'completed', completed_at: ago(4 * DAY), recipients: [] }, me, NOW)).toEqual({ text: 'Completed 4 days ago', tone: 'done' })
    expect(envelopeProgress({ status: 'declined', recipients: [signer('Carol', { status: 'declined', declined_at: ago(HOUR) })] }, me, NOW))
      .toEqual({ text: 'Declined by Carol 1 hour ago', tone: 'problem' })
  })
})

describe('reminding', () => {
  it('reminds the signers whose turn it is, never yourself, at most every 10 minutes', () => {
    const e = sent([signer('Carol'), signer('Sara', { email: me.email }), signer('Dave', { routing_order: 2, status: 'pending' })], { signing_order: 'sequential' })
    expect(remindTargets(e, me, NOW)).toEqual({ recipients: [e.recipients[0]], availableAt: null })
    const recent = sent([signer('Carol', { last_reminded_at: ago(4 * MIN) })])
    expect(remindTargets(recent, me, NOW).availableAt).toBe(NOW + 6 * MIN)
    expect(remindTargets({ ...recent, status: 'completed' }, me, NOW).recipients).toEqual([])
  })
})
