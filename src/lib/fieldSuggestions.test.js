import { describe, it, expect } from 'vitest'
import { snapToLine, suggestFields, assignSuggestions, classifyLabel, companyFromEmail } from './fieldSuggestions'
import { mergeSegments } from './pageLayout'

const word = (text, x1, baseline, size = 11) => ({ text, x1, x2: x1 + text.length * size * 0.5, baseline, size })
const phrase = (text, x1, baseline, size = 11) => {
  let x = x1
  return text.split(' ').map(t => {
    const w = word(t, x, baseline, size)
    x = w.x2 + size * 0.3
    return w
  })
}

// Two signature blocks like the NDA: FLMLNK (partly filled in) on the left, the other party on the right
const nda = {
  width: 612,
  height: 792,
  words: [
    ...phrase('This Agreement is made with [COMPANY NAME] (the Recipient).', 72, 200),
    ...phrase('FLMLNK, INC.', 72, 540),
    word('By:', 72, 572), ...phrase('(Signature)', 160, 584, 8),
    ...phrase('DeVante Watkins', 120, 598), ...phrase('(Type or Print Name)', 150, 611, 8),
    word('Its:', 72, 628), word('Co-Founder', 110, 627),
    word('Date:', 72, 650),
    ...phrase('ACME CORP', 340, 540),
    word('By:', 340, 572), ...phrase('(Signature)', 430, 584, 8),
    ...phrase('(Type or Print Name)', 420, 611, 8),
    word('Its:', 336, 628),
    word('Date:', 340, 650)
  ],
  lines: [
    { x1: 95, x2: 290, y: 573 }, { x1: 95, x2: 290, y: 600 }, { x1: 92, x2: 290, y: 629 }, { x1: 100, x2: 290, y: 651 },
    { x1: 360, x2: 560, y: 573 }, { x1: 340, x2: 560, y: 600 }, { x1: 358, x2: 560, y: 629 }, { x1: 365, x2: 560, y: 651 }
  ]
}

const pt = (s) => ({ x: s.x * 612, y: s.y * 792, w: s.w * 612, bottom: (s.y + s.h) * 792 })

describe('suggesting fields', () => {
  const suggestions = suggestFields([nda], [], { company: 'flmlnk' })
  const summary = suggestions.map(s => [s.type, s.label, s.side, Math.round(pt(s).bottom)])

  it('finds the blank lines, what they are for and whose block they are in', () => {
    expect(summary).toEqual([
      // The capitalised placeholder in the text is for the sender to fill in
      ['prefill', 'Company name', null, expect.any(Number)],
      ['signature', '', 'sender', 572], ['signature', '', 'other', 572],
      ['text', 'Name', 'other', 599],
      ['text', 'Title', 'other', 628],
      ['date', '', 'sender', 650], ['date', '', 'other', 650]
    ])
  })

  it('sits each field on its line, starting where the line starts', () => {
    const leftSignature = suggestions[1]
    expect(pt(leftSignature).x).toBeCloseTo(97, 0)
    expect(pt(leftSignature).bottom).toBeCloseTo(572, 0)
    expect(pt(leftSignature).w).toBeLessThanOrEqual(191)
    const placeholder = suggestions[0]
    const [first] = nda.words.filter(w => w.text === '[COMPANY')
    expect(pt(placeholder).x).toBeCloseTo(first.x1 - 1, 0)
  })

  it('leaves lines that are already filled in alone', () => {
    const leftName = suggestions.find(s => s.side === 'sender' && s.type !== 'signature' && s.type !== 'date')
    expect(leftName).toBeUndefined()
  })

  it('skips places that already have a field', () => {
    const existing = [{ page: 1, ...suggestions[1] }]
    expect(suggestFields([nda], existing, { company: 'flmlnk' })).toHaveLength(suggestions.length - 1)
  })

  it('assigns blocks to the sender and to the other signer', () => {
    const me = { id: 'me', role: 'signer' }
    const carol = { id: 'carol', role: 'signer' }
    const assigned = assignSuggestions(suggestions, [me, carol], me)
    expect(assigned.map(s => s.recipientId)).toEqual([null, 'me', 'carol', 'carol', 'carol', 'me', 'carol'])

    // The sender is not signing: their block needs a decision; the other side is still clear
    expect(assignSuggestions(suggestions, [carol], me).map(s => s.recipientId)).toEqual([null, null, 'carol', 'carol', 'carol', null, 'carol'])
  })

  it('does not guess the party when no heading names the sender', () => {
    const unknown = suggestFields([nda], [], { company: 'someone-else' })
    expect(unknown.filter(s => s.type !== 'prefill').every(s => s.side === null)).toBe(true)
    const two = assignSuggestions(unknown, [{ id: 'a', role: 'signer' }, { id: 'b', role: 'signer' }], null)
    expect(two.filter(s => s.type !== 'prefill').every(s => s.recipientId === null)).toBe(true)
    const one = assignSuggestions(unknown, [{ id: 'a', role: 'signer' }], null)
    expect(one.filter(s => s.type !== 'prefill').every(s => s.recipientId === 'a')).toBe(true)
  })
})

describe('labels', () => {
  it('reads common signature block labels', () => {
    expect(classifyLabel('By:', '(Signature)')).toEqual({ type: 'signature', label: '' })
    expect(classifyLabel('', '(Type or Print Name)')).toEqual({ type: 'text', label: 'Name' })
    expect(classifyLabel('Its:', '')).toEqual({ type: 'text', label: 'Title' })
    expect(classifyLabel('Date:', '')).toEqual({ type: 'date', label: '' })
    expect(classifyLabel('Initials:', '')).toEqual({ type: 'initials', label: '' })
    expect(classifyLabel('Account number:', '')).toEqual({ type: 'text', label: 'Account number' })
    expect(classifyLabel('', '')).toBeNull()
  })

  it('knows the company from the email', () => {
    expect(companyFromEmail('alice@flmlnk.com')).toBe('flmlnk')
    expect(companyFromEmail(undefined)).toBe('')
  })
})

describe('snapping', () => {
  const line = { x1: 100, x2: 300, y: 651 }
  const layout = { width: 612, height: 792, lines: [line], words: [] }
  const field = (x, bottom, w = 110, h = 16) => ({ x: x / 612, y: (bottom - h) / 792, w: w / 612, h: h / 792 })

  it('puts a field dropped near a line onto it', () => {
    const patch = snapToLine(field(120, 640), layout) // 11pt above the line
    expect(patch.y * 792 + 16).toBeCloseTo(650, 5)
    expect(patch.x * 612).toBeCloseTo(120, 5)
  })

  it('keeps the field on the line and no wider than it', () => {
    const patch = snapToLine(field(150, 655, 300), layout)
    expect(patch.x * 612).toBeCloseTo(101, 5)
    expect(patch.w * 612).toBeCloseTo(198, 5)
  })

  it('leaves fields far from any line where they are', () => {
    expect(snapToLine(field(120, 600), layout)).toBeNull()
    expect(snapToLine(field(400, 650), layout)).toBeNull()
  })
})

describe('reading lines', () => {
  it('joins pieces of one line and drops short ones', () => {
    expect(mergeSegments([
      { x1: 100, x2: 150, y: 400 }, { x1: 150.5, x2: 220, y: 400.4 }, { x1: 10, x2: 20, y: 300 }
    ])).toEqual([{ x1: 100, x2: 220, y: 400 }])
  })
})
