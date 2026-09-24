import { describe, it, expect } from 'vitest'
import {
  draftFromEnvelope, fieldToRow, newField, fieldSummary, recipientToRow, newRecipient, moveRecipient,
  validateForSave, validateForSend, envelopeGroup, filterEnvelopes, currentSigners, RECIPIENT_COLORS
} from './envelopeModel'

const signer = (over = {}) => ({ id: 'r1', name: 'Bob', email: 'bob@flmlnk.com', role: 'signer', routingOrder: 1, color: '#2563eb', ...over })
const field = (over = {}) => ({ id: 'f1', type: 'signature', page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.05, recipientId: 'r1', required: true, label: '', fontSize: 12, ...over })

describe('row mapping', () => {
  it('round-trips an envelope row into editor state and back', () => {
    const envelope = {
      title: 'NDA', message: null, signing_order: 'sequential',
      recipients: [
        { id: 'r2', name: 'Zed', email: 'z@x.com', role: 'signer', routing_order: 2, color: '#db2777', status: 'pending' },
        { id: 'r1', name: 'Bob', email: 'bob@flmlnk.com', role: 'signer', routing_order: 1, color: null, status: 'pending' }
      ],
      fields: [{ id: 'f1', type: 'signature', page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.05, recipient_id: 'r1', required: true, label: null, font_size: 12 }]
    }
    const draft = draftFromEnvelope(envelope)
    expect(draft.message).toBe('')
    expect(draft.recipients.map(r => r.id)).toEqual(['r1', 'r2'])
    expect(draft.recipients[0].color).toBe(RECIPIENT_COLORS[0])
    expect(fieldToRow(draft.fields[0])).toEqual({ ...envelope.fields[0], label: null })
  })

  it('trims recipient input and blank labels', () => {
    expect(recipientToRow(signer({ name: '  Bob ', email: ' bob@flmlnk.com ' }))).toMatchObject({ name: 'Bob', email: 'bob@flmlnk.com', routing_order: 1 })
    expect(fieldToRow(field({ label: '   ' })).label).toBeNull()
  })
})

describe('recipients', () => {
  it('picks an unused color and the next routing order', () => {
    const r = newRecipient([signer(), signer({ id: 'r2', color: RECIPIENT_COLORS[1], routingOrder: 4 })])
    expect(r.color).toBe(RECIPIENT_COLORS[2])
    expect(r.routingOrder).toBe(5)
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('moves recipients and renumbers routing order', () => {
    const list = [signer(), signer({ id: 'r2', routingOrder: 2 }), signer({ id: 'r3', routingOrder: 3 })]
    const moved = moveRecipient(list, 'r3', -1)
    expect(moved.map(r => [r.id, r.routingOrder])).toEqual([['r1', 1], ['r3', 2], ['r2', 3]])
    expect(moveRecipient(list, 'r1', -1)).toBe(list)
  })
})

describe('validation', () => {
  const draft = (over = {}) => ({ title: 'NDA', recipients: [signer()], fields: [field()], ...over })

  it('accepts a complete draft', () => {
    expect(validateForSave(draft())).toEqual([])
    expect(validateForSend(draft())).toEqual([])
  })

  it('reports save problems the database would reject', () => {
    const problems = validateForSave(draft({
      title: ' ',
      recipients: [signer({ name: '' , email: 'nope' }), signer({ id: 'r2', email: 'BOB@flmlnk.com' }), signer({ id: 'r3', email: 'bob@flmlnk.com ' })],
      fields: [field({ recipientId: 'gone' })]
    }))
    expect(problems).toEqual([
      'Give the envelope a title.',
      'Recipient 1 needs a name.',
      'Recipient 1 needs a valid email address.',
      'Bob has the same email as Bob.',
      '1 field is not assigned to a recipient.'
    ])
  })

  it('requires a signature for every signer and no fields for CCs before sending', () => {
    const problems = validateForSend(draft({
      recipients: [signer(), signer({ id: 'r2', name: 'Cat', email: 'cat@x.com', role: 'cc' }), signer({ id: 'r3', name: 'Dan', email: 'dan@x.com' })],
      fields: [field(), field({ id: 'f2', recipientId: 'r2', type: 'text' })]
    }))
    expect(problems).toEqual(['Dan has no signature field.', 'Cat receives a copy only and cannot have fields.'])
    expect(validateForSend(draft({ recipients: [], fields: [] }))).toContain('Add at least one signer.')
  })
})

describe('dashboard grouping', () => {
  const me = { id: 'u1', email: 'Bob@flmlnk.com' }
  const env = (over = {}) => ({
    id: 'e1', status: 'sent', signing_order: 'sequential',
    recipients: [
      { email: 'amy@flmlnk.com', role: 'signer', routing_order: 1, status: 'sent' },
      { email: 'bob@flmlnk.com', role: 'signer', routing_order: 2, status: 'pending' }
    ],
    ...over
  })

  it('only puts sequential envelopes in action required on my turn', () => {
    expect(envelopeGroup(env(), me)).toBe('waiting')
    const myTurn = env({ recipients: [{ email: 'amy@flmlnk.com', role: 'signer', routing_order: 1, status: 'signed' }, { email: 'bob@flmlnk.com', role: 'signer', routing_order: 2, status: 'sent' }] })
    expect(envelopeGroup(myTurn, me)).toBe('action')
    expect(envelopeGroup(env({ signing_order: 'parallel' }), me)).toBe('action')
  })

  it('ignores CC recipients when finding whose turn it is', () => {
    const e = env({ recipients: [{ email: 'cc@x.com', role: 'cc', routing_order: 1, status: 'pending' }, { email: 'bob@flmlnk.com', role: 'signer', routing_order: 2, status: 'sent' }] })
    expect(currentSigners(e).map(r => r.email)).toEqual(['bob@flmlnk.com'])
  })

  it('groups by status and keeps declined/voided under All only', () => {
    const list = [env({ id: 'd', status: 'draft' }), env({ id: 'c', status: 'completed' }), env({ id: 'v', status: 'voided' })]
    expect(filterEnvelopes(list, 'draft', me).map(e => e.id)).toEqual(['d'])
    expect(filterEnvelopes(list, 'completed', me).map(e => e.id)).toEqual(['c'])
    expect(filterEnvelopes(list, 'all', me)).toHaveLength(3)
    expect(envelopeGroup(list[2], me)).toBe('closed')
  })
})

describe('newField', () => {
  it('creates a database-shaped field for a recipient', () => {
    const f = newField('checkbox', { page: 3, pageSize: { width: 612, height: 792 } }, 'r1')
    expect(Object.keys(f).sort()).toEqual(['fontSize', 'h', 'id', 'label', 'page', 'recipientId', 'required', 'type', 'w', 'x', 'y'])
    expect(f).toMatchObject({ page: 3, recipientId: 'r1', required: false, type: 'checkbox' })
    expect(newField('signature', { page: 1, pageSize: { width: 612, height: 792 } }, 'r1').required).toBe(true)
  })

  it('summarizes fields by type', () => {
    expect(fieldSummary([field(), field({ id: 'f2' }), field({ id: 'f3', type: 'date' })])).toBe('2 signature, 1 date signed')
  })
})
