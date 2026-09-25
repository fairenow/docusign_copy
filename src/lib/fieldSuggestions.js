/**
 * Suggest fields for the blank lines and placeholders of a document, from its page layouts
 * (see pageLayout.js).
 *
 * Layout units are display points (origin top-left); fields use page fractions.
 * Pure functions, covered by unit tests.
 */

// Gap between a field and the line it sits on
const GAP = 1

const overlap = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1)

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

// Field size (points) per suggested type; width is capped by the line's length
const SUGGESTED_SIZE = {
  signature: { w: 220, h: 26 },
  initials: { w: 60, h: 20 },
  date: { w: 110, h: 16 },
  text: { w: Infinity, h: 16 }
}

// Words a placeholder like "COMPANY NAME" is made of
const PLACEHOLDER_WORDS = new Set(['COMPANY', 'CLIENT', 'PARTY', 'RECIPIENT', 'CUSTOMER', 'VENDOR', 'NAME', 'FULL', 'LEGAL', 'ADDRESS', 'TITLE', 'ENTITY', 'EMAIL', 'PHONE'])
const PLACEHOLDER_KEYS = ['NAME', 'ADDRESS', 'EMAIL', 'PHONE']

const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()

/**
 * What a blank line is for, from the words beside and under it.
 * Returns { type, label } or null when there is no telling.
 */
export function classifyLabel(left, below) {
  const words = `${left} ${below}`.toLowerCase().replace(/[():*_]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!words) return null
  if (/\binitials?\b/.test(words)) return { type: 'initials', label: '' }
  if (/\bsignature\b|\bsigned\b|\bsign here\b/.test(words)) return { type: 'signature', label: '' }
  if (/\b(name|print)\b/.test(words)) return { type: 'text', label: 'Name' }
  if (/^by\b/.test(words)) return { type: 'signature', label: '' }
  if (/\bdated?\b/.test(words)) return { type: 'date', label: '' }
  if (/\btitle\b|^its\b/.test(words)) return { type: 'text', label: 'Title' }
  if (/\b(company|entity|organi[sz]ation|business)\b/.test(words)) return { type: 'text', label: 'Company' }
  if (/\be-?mail\b/.test(words)) return { type: 'text', label: 'Email' }
  if (/\baddress\b/.test(words)) return { type: 'text', label: 'Address' }
  if (/\bphone\b/.test(words)) return { type: 'text', label: 'Phone' }
  const named = left.trim().match(/^([A-Za-z][A-Za-z .'/-]{1,38}):$/)
  return named ? { type: 'text', label: sentence(named[1].trim()) } : null
}

/** Words on the same row as a line, to its left, up to the previous line on that row. */
function leftLabel(line, layout) {
  const boundary = Math.max(-Infinity, ...layout.lines
    .filter(l => l !== line && Math.abs(l.y - line.y) <= 3 && l.x2 <= line.x1 + 1)
    .map(l => l.x2))
  const row = layout.words
    .filter(w => Math.abs(w.baseline - line.y) <= 6 && w.x2 <= line.x1 + 3 && w.x1 > boundary - 1 && w.x2 >= line.x1 - 160)
    .sort((a, b) => a.x1 - b.x1)
  // Keep only the words right before the line (a tab may separate them from it), not the
  // sentence text further left
  let start = row.length
  if (start && line.x1 - row[start - 1].x2 <= 60) {
    start--
    while (start > 0 && row[start].x1 - row[start - 1].x2 <= 12) start--
  }
  return row.slice(start).map(w => w.text).join(' ')
}

/** Words sitting on a line's row (its label or what is written on it) */
const onRowOf = (w, line) => Math.abs(w.baseline - line.y) <= 6

/** Small print just under a line, e.g. "(Signature)" or "(Type or Print Name)". */
function isCaptionOf(w, line) {
  const top = w.baseline - w.size * 0.75
  const center = (w.x1 + w.x2) / 2
  return top >= line.y + 0.5 && top <= line.y + 14 && center >= line.x1 - 10 && center <= line.x2 + 10
}

function belowLabel(line, layout) {
  return layout.words
    .filter(w => isCaptionOf(w, line) && !layout.lines.some(l => l !== line && onRowOf(w, l)))
    .sort((a, b) => a.baseline - b.baseline || a.x1 - b.x1)
    .map(w => w.text)
    .join(' ')
}

/** Something is already written on the line (e.g. a typed name), not just the caption of the line above. */
function isFilled(line, layout) {
  return layout.words.some(w =>
    w.baseline >= line.y - 16 && w.baseline <= line.y + 1.5 && overlap(w.x1, w.x2, line.x1 + 2, line.x2 - 2) >= 4 &&
    !layout.lines.some(l => l !== line && l.y < line.y && isCaptionOf(w, l)))
}

/** A blank in running text ("made with ________ and"): words continue right after it. */
function isInline(line, layout) {
  return layout.words.some(w => Math.abs(w.baseline - line.y) <= 6 && w.x1 >= line.x2 - 2 && w.x1 <= line.x2 + 20)
}

/** Placeholders written in capitals, like "[COMPANY NAME]" or "CLIENT NAME". */
function placeholders(layout) {
  const found = []
  const rows = new Map()
  for (const w of layout.words) {
    const key = Math.round(w.baseline)
    rows.set(key, [...(rows.get(key) ?? []), w])
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.x1 - b.x1)
    let run = []
    const flush = () => {
      const names = run.map(w => w.text.replace(/^[[{<(]+|[\]}>),.;:]+$/g, ''))
      if (run.length >= 2 && names.some(n => PLACEHOLDER_KEYS.includes(n))) {
        found.push({ words: run, label: sentence(names.join(' ')) })
      }
      run = []
    }
    for (const w of row) {
      const bare = w.text.replace(/^[[{<(]+|[\]}>),.;:]+$/g, '')
      const adjacent = !run.length || w.x1 - run[run.length - 1].x2 <= w.size
      if (PLACEHOLDER_WORDS.has(bare) && adjacent) run.push(w)
      else {
        flush()
        if (PLACEHOLDER_WORDS.has(bare)) run.push(w)
      }
    }
    flush()
  }
  return found
}

/**
 * Suggested fields for one page. Each: { page, type, label, x, y, w, h (fractions), side, block }
 * where side is 'sender' | 'other' | null (unknown) and block groups a signature block.
 * `company` is the sender's company as written in documents (e.g. "flmlnk").
 */
function suggestPageFields(layout, page, { company = '' } = {}) {
  const W = layout.width
  const H = layout.height
  const token = company.trim().toLowerCase()
  const candidates = []

  for (const line of layout.lines) {
    if (isFilled(line, layout)) continue
    const kind = classifyLabel(leftLabel(line, layout), belowLabel(line, layout)) ??
      (isInline(line, layout) ? { type: 'text', label: '' } : null)
    if (!kind) continue
    const size = SUGGESTED_SIZE[kind.type]
    const w = Math.min(size.w, line.x2 - line.x1 - 4)
    const y = line.y - GAP - size.h
    if (w < 20 || y < 0) continue
    candidates.push({ line, ...kind, rect: { x: line.x1 + 2, y, w, h: size.h } })
  }

  // Signature blocks: lines in the same column, close together, including a signature
  const columnOf = (line) => ((line.x1 + line.x2) / 2 < W / 2 ? 'left' : 'right')
  const blocks = []
  for (const column of ['left', 'right']) {
    const lines = layout.lines.filter(l => columnOf(l) === column).sort((a, b) => a.y - b.y)
    let current = null
    for (const line of lines) {
      if (current && line.y - current.bottom <= 45) {
        current.lines.push(line)
        current.bottom = line.y
      } else {
        current = { column, lines: [line], top: line.y, bottom: line.y }
        blocks.push(current)
      }
    }
  }
  const signatureBlocks = blocks.filter(b => candidates.some(c => c.type === 'signature' && b.lines.includes(c.line)))

  // Whose block it is: the heading right above it names the party
  for (const block of signatureBlocks) {
    const x1 = Math.min(...block.lines.map(l => l.x1)) - 40
    const x2 = Math.max(...block.lines.map(l => l.x2)) + 40
    const above = layout.words.filter(w => w.baseline < block.top - 2 && w.baseline >= block.top - 70 && overlap(w.x1, w.x2, x1, x2) > 0)
    const nearest = Math.max(-Infinity, ...above.map(w => w.baseline))
    block.heading = above.filter(w => w.baseline >= nearest - 3).map(w => w.text).join(' ')
    block.sender = Boolean(token) && block.heading.toLowerCase().includes(token)
  }
  const anySender = signatureBlocks.some(b => b.sender)

  const suggestions = candidates.map(c => {
    const block = signatureBlocks.find(b => b.lines.includes(c.line))
    const side = block ? (block.sender ? 'sender' : anySender ? 'other' : null) : null
    // Blanks outside signature blocks (e.g. in the text) are for the sender to fill in now;
    // so are name/title lines in the sender's own block
    const type = c.type === 'text' && (!block || side === 'sender') ? 'prefill' : c.type
    return {
      page, type, label: c.label, side, block: block ? signatureBlocks.indexOf(block) : null,
      x: c.rect.x / W, y: c.rect.y / H, w: c.rect.w / W, h: c.rect.h / H
    }
  })

  for (const p of placeholders(layout)) {
    const first = p.words[0]
    const last = p.words[p.words.length - 1]
    const size = Math.max(...p.words.map(w => w.size))
    const top = first.baseline - size * 0.95
    suggestions.push({
      page, type: 'prefill', label: p.label, side: null, block: null, fontSize: Math.round(size),
      x: (first.x1 - 1) / W, y: Math.max(0, top) / H, w: (last.x2 - first.x1 + 2) / W, h: (size * 1.3) / H
    })
  }
  return suggestions
}

/** Suggestions for every page, without ones that would land on a field already placed. */
export function suggestFields(layouts, existing, options) {
  const all = layouts.flatMap((layout, i) => (layout ? suggestPageFields(layout, i + 1, options) : []))
  const clash = (s) => existing.some(f => f.page === s.page &&
    overlap(f.x, f.x + f.w, s.x, s.x + s.w) > 0 && overlap(f.y, f.y + f.h, s.y, s.y + s.h) > 0)
  // Reading order: page, then row (fields whose bottoms are within a few points), then left to right
  const row = (s) => Math.round(((s.y + s.h) * layouts[s.page - 1].height) / 4)
  return all
    .filter(s => !clash(s))
    .sort((a, b) => a.page - b.page || row(a) - row(b) || a.x - b.x)
    .map((s, i) => ({ ...s, id: `suggestion-${i}` }))
}

/**
 * Who fills in each suggestion: the sender's blocks go to the sender (when they sign), the
 * other party's blocks to the other signer(s). Unclear ones get recipientId null.
 */
export function assignSuggestions(suggestions, recipients, me) {
  const signers = recipients.filter(r => r.role === 'signer')
  const self = signers.find(r => r.id === me?.id)
  const others = signers.filter(r => r !== self)
  const otherBlocks = [...new Set(suggestions.filter(s => s.side === 'other').map(s => `${s.page}:${s.block}`))]

  return suggestions.map(s => {
    if (s.type === 'prefill') return { ...s, recipientId: null }
    let recipient = null
    if (s.side === 'sender') recipient = self ?? null
    else if (s.side === 'other') {
      if (others.length === 1) recipient = others[0]
      else if (others.length === otherBlocks.length) recipient = others[otherBlocks.indexOf(`${s.page}:${s.block}`)]
    } else if (signers.length === 1) {
      recipient = signers[0]
    }
    return { ...s, recipientId: recipient?.id ?? null }
  })
}

/** The sender's company as it appears in documents, from their email (alice@flmlnk.com → "flmlnk"). */
export function companyFromEmail(email) {
  const domain = email?.split('@')[1] ?? ''
  return domain.split('.')[0] ?? ''
}
