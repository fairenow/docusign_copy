/**
 * Certificate of completion, appended as the last page(s) of a signed envelope.
 * Records who signed what, when, from where, and the document fingerprints.
 */
import { StandardFonts, rgb } from 'pdf-lib'
import { encodable } from './pdfStamp.js'
import { ACTION_LABELS } from './labels.js'

const PAGE = { width: 612, height: 792 }
const MARGIN = 54
const CONTENT_WIDTH = PAGE.width - MARGIN * 2
const INK = rgb(0.1, 0.12, 0.16)
const MUTED = rgb(0.42, 0.45, 0.5)
const RULE = rgb(0.85, 0.86, 0.88)

export function formatTimestamp(value) {
  if (!value) return '—'
  const d = new Date(value)
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 19)} UTC`
}

/**
 * @param {import('pdf-lib').PDFDocument} doc
 * @param {{
 *   envelope: { id, title, original_sha256, sent_at, completed_at, page_count },
 *   sender: { name, email },
 *   recipients: Array<{ name, email, role, status, viewed_at, signed_at, consented_at, signer_ip, signer_user_agent, signature?: string }>,
 *   events: Array<{ created_at, action, who, ip }>
 * }} data
 */
export async function appendCertificate(doc, { envelope, sender, recipients, events }) {
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const writer = new PageWriter(doc, regular, bold)

  writer.heading('Certificate of Completion')
  writer.keyValues([
    ['Envelope', envelope.title],
    ['Envelope ID', envelope.id],
    ['Sent by', `${sender.name} <${sender.email}>`],
    ['Sent', formatTimestamp(envelope.sent_at)],
    ['Completed', formatTimestamp(envelope.completed_at)],
    ['Document pages', String(envelope.page_count ?? '—')],
    ['Original document SHA-256', envelope.original_sha256 ?? '—']
  ])
  writer.note('The SHA-256 fingerprint identifies the document exactly as it was sent. The fingerprint of this signed copy is recorded in the envelope\'s audit trail.')

  writer.subheading('Recipients')
  for (const r of recipients) {
    const embedded = r.signature ? await doc.embedPng(r.signature) : null
    writer.recipient(r, embedded)
  }

  writer.subheading('Activity')
  writer.eventsTable(events.map(e => [formatTimestamp(e.created_at), ACTION_LABELS[e.action] ?? e.action, e.who ?? '', e.ip ?? '']))

  writer.note('All parties agreed to do business electronically and to use electronic signatures, which have the same effect as handwritten signatures.')
}

class PageWriter {
  constructor(doc, regular, bold) {
    this.doc = doc
    this.regular = regular
    this.bold = bold
    this.newPage()
  }

  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height])
    this.y = PAGE.height - MARGIN
  }

  ensure(height) {
    if (this.y - height < MARGIN) this.newPage()
  }

  lines(value, { size = 10, font = this.regular, maxWidth = CONTENT_WIDTH } = {}) {
    return wrap(encodable(font, String(value ?? '')), font, size, maxWidth)
  }

  /** Height text() will use, so multi-column blocks can be kept on one page. */
  height(value, options = {}) {
    return this.lines(value, options).length * ((options.size ?? 10) + 4)
  }

  text(value, { x = MARGIN, size = 10, font = this.regular, color = INK, maxWidth = CONTENT_WIDTH } = {}) {
    for (const line of this.lines(value, { size, font, maxWidth })) {
      this.ensure(size + 4)
      this.page.drawText(line, { x, y: this.y - size, size, font, color })
      this.y -= size + 4
    }
  }

  heading(value) {
    this.text(value, { size: 20, font: this.bold })
    this.y -= 8
  }

  subheading(value) {
    this.y -= 14
    this.ensure(40)
    this.text(value, { size: 13, font: this.bold })
    this.rule()
  }

  rule() {
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE.width - MARGIN, y: this.y }, thickness: 0.75, color: RULE })
    this.y -= 8
  }

  note(value) {
    this.y -= 6
    this.text(value, { size: 8, color: MUTED })
  }

  keyValues(rows) {
    for (const [key, value] of rows) {
      this.ensure(Math.max(
        this.height(key, { size: 9, font: this.bold, maxWidth: 150 }),
        this.height(value, { size: 9, maxWidth: CONTENT_WIDTH - 160 })
      ) + 2)
      const top = this.y
      this.text(key, { size: 9, font: this.bold, color: MUTED, maxWidth: 150 })
      const afterKey = this.y
      this.y = top
      this.text(value, { x: MARGIN + 160, size: 9, maxWidth: CONTENT_WIDTH - 160 })
      this.y = Math.min(this.y, afterKey) - 2
    }
  }

  recipient(r, signatureImage) {
    const name = `${r.name} <${r.email}>`
    const status = r.role === 'cc' ? 'Received a copy' : r.status === 'signed' ? 'Signed' : r.status
    const details = [
      ['Status', status],
      ['Viewed', formatTimestamp(r.viewed_at)],
      ['Signed', formatTimestamp(r.signed_at)],
      ['Consented to e-sign', formatTimestamp(r.consented_at)],
      ['IP address', r.signer_ip ?? '—'],
      ['Browser', r.signer_user_agent ?? '—']
    ]
    const lines = (r.role === 'cc' ? details.slice(0, 1) : details).map(([key, value]) => `${key}: ${value}`)
    const detailOptions = { size: 8, color: MUTED, maxWidth: CONTENT_WIDTH - 170 }
    // Keep the whole block (and the signature drawn beside it at `top`) on one page
    const blockHeight = this.height(name, { size: 10, font: this.bold, maxWidth: CONTENT_WIDTH - 170 }) +
      lines.reduce((sum, line) => sum + this.height(line, detailOptions), 0)
    this.ensure(Math.max(blockHeight, signatureImage ? 60 : 0) + 20)
    const top = this.y
    this.text(name, { size: 10, font: this.bold, maxWidth: CONTENT_WIDTH - 170 })
    for (const line of lines) this.text(line, detailOptions)

    if (signatureImage) {
      const boxW = 150
      const boxH = 50
      const scale = Math.min(boxW / signatureImage.width, boxH / signatureImage.height)
      const w = signatureImage.width * scale
      const h = signatureImage.height * scale
      const boxX = PAGE.width - MARGIN - boxW
      this.page.drawRectangle({ x: boxX, y: top - boxH - 4, width: boxW, height: boxH + 4, borderColor: RULE, borderWidth: 0.75 })
      this.page.drawImage(signatureImage, { x: boxX + (boxW - w) / 2, y: top - boxH - 2 + (boxH - h) / 2, width: w, height: h })
      this.y = Math.min(this.y, top - boxH - 10)
    }
    this.y -= 6
    this.rule()
  }

  eventsTable(rows) {
    const cols = [
      { width: 120 },
      { width: 130 },
      { width: CONTENT_WIDTH - 120 - 130 - 90 },
      { width: 90 }
    ]
    const header = ['Time', 'Event', 'By', 'IP address']
    const drawRow = (cells, font, color) => {
      // Reserve the tallest cell so every cell of the row lands on the same page
      this.ensure(Math.max(...cells.map((cell, i) => this.height(cell, { size: 8, font, maxWidth: cols[i].width - 6 }))) + 2)
      const top = this.y
      let x = MARGIN
      let bottom = top
      cells.forEach((cell, i) => {
        this.y = top
        this.text(cell, { x, size: 8, font, color, maxWidth: cols[i].width - 6 })
        bottom = Math.min(bottom, this.y)
        x += cols[i].width
      })
      this.y = bottom - 2
    }
    drawRow(header, this.bold, MUTED)
    for (const row of rows) drawRow(row, this.regular, INK)
  }
}

/** Greedy word wrap; long unbroken strings (hashes, user agents) are split by character. */
export function wrap(text, font, size, maxWidth) {
  const width = (s) => font.widthOfTextAtSize(s, size)
  const lines = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word
      if (width(candidate) <= maxWidth) {
        line = candidate
        continue
      }
      if (line) lines.push(line)
      // Split a word that is too long on its own
      let rest = word
      while (width(rest) > maxWidth) {
        let cut = rest.length - 1
        while (cut > 1 && width(rest.slice(0, cut)) > maxWidth) cut--
        lines.push(rest.slice(0, cut))
        rest = rest.slice(cut)
      }
      line = rest
    }
    lines.push(line)
  }
  return lines
}
