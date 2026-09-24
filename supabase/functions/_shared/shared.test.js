import { describe, it, expect } from 'vitest'
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'
import { escapeHtml, signingRequestEmail, completedEmail, declinedEmail } from './emails.js'
import { validateSigningValues, isFieldComplete } from './signing.js'
import { loadPdf, stampFields, elementsFromFieldRows } from './pdfStamp.js'
import { appendCertificate, wrap, formatTimestamp } from './certificate.js'

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

async function samplePdf() {
  const doc = await PDFDocument.create()
  doc.addPage([612, 792])
  doc.addPage([612, 792]).setRotation(degrees(90))
  return doc.save()
}

describe('emails', () => {
  it('escapes user-supplied values', () => {
    expect(escapeHtml(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;')
    const email = signingRequestEmail({
      recipientName: 'Bob <b>',
      senderName: 'Eve"',
      title: '<script>alert(1)</script>',
      message: '<img src=x onerror=alert(1)>\nsecond line',
      link: 'https://app.example.com/sign/abc"onmouseover="x'
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<img')
    expect(email.html).toContain('&lt;script&gt;')
    expect(email.html).toContain('href="https://app.example.com/sign/abc&quot;onmouseover=&quot;x"')
    expect(email.subject).toBe('Please sign: <script>alert(1)</script>') // subjects are plain text
    expect(email.text).toContain('https://app.example.com/sign/abc')
  })

  it('omits optional parts', () => {
    expect(signingRequestEmail({ recipientName: 'A', senderName: 'B', title: 'T', link: 'https://x' }).html).not.toContain('border-left')
    expect(completedEmail({ recipientName: 'A', title: 'T' }).html).not.toContain('Open in DocSign')
    expect(declinedEmail({ ownerName: 'O', recipientName: 'R', title: 'T', reason: 'Too <b>low</b>', link: 'https://x' }).html).toContain('Too &lt;b&gt;low')
  })
})

describe('validateSigningValues', () => {
  const fields = [
    { id: 's', type: 'signature', required: true },
    { id: 't', type: 'text', required: true, label: 'Company' },
    { id: 'o', type: 'text', required: false },
    { id: 'c', type: 'checkbox', required: true, label: 'I agree' },
    { id: 'd', type: 'date', required: true }
  ]

  it('accepts a complete submission and normalizes values', () => {
    const { values, problems } = validateSigningValues(fields, { s: PNG, t: '  ACME  ', c: true })
    expect(problems).toEqual([])
    expect(values).toEqual({ s: PNG, t: 'ACME', c: 'true' })
  })

  it('reports missing, invalid and foreign values', () => {
    const { problems } = validateSigningValues(fields, { s: 'javascript:alert(1)', t: ' ', c: false, zzz: 'x', o: 5 })
    expect(problems).toEqual([
      'The submission contains a field that is not yours.',
      'Signature must be a signature image.',
      'Please complete: Company.',
      'Text has an invalid value.',
      'Please complete: I agree.'
    ])
    expect(validateSigningValues(fields, null).problems).toEqual(['Invalid submission.'])
  })

  it('treats date fields as always complete and optional fields as complete', () => {
    expect(isFieldComplete({ type: 'date', required: true }, undefined)).toBe(true)
    expect(isFieldComplete({ type: 'text', required: false }, '')).toBe(true)
    expect(isFieldComplete({ type: 'checkbox', required: false }, false)).toBe(true)
  })
})

describe('pdf stamping and certificate', () => {
  it('stamps stored field values, including on rotated pages', async () => {
    const doc = await loadPdf(await samplePdf())
    const rows = [
      { type: 'signature', page: 1, x: 0.1, y: 0.8, w: 0.3, h: 0.05, value: PNG, font_size: 12 },
      { type: 'text', page: 2, x: 0.1, y: 0.1, w: 0.3, h: 0.03, value: 'Jane Doe – 日本', font_size: 12 },
      { type: 'checkbox', page: 1, x: 0.1, y: 0.5, w: 0.02, h: 0.02, value: 'true', font_size: 12 },
      { type: 'date', page: 1, x: 0.5, y: 0.8, w: 0.2, h: 0.03, value: '09/24/2026', font_size: 12 }
    ]
    const elements = elementsFromFieldRows(rows)
    expect(elements.map(e => [e.type, e.data ?? e.text ?? e.checked])).toEqual([
      ['signature', PNG], ['text', 'Jane Doe – 日本'], ['checkbox', true], ['date', '09/24/2026']
    ])
    await stampFields(doc, elements) // unencodable characters are dropped, not fatal
    const reloaded = await PDFDocument.load(await doc.save())
    expect(reloaded.getPageCount()).toBe(2)
  })

  it('appends a certificate that paginates long activity logs', async () => {
    const doc = await loadPdf(await samplePdf())
    await appendCertificate(doc, {
      envelope: { id: 'e1', title: 'Offer letter', original_sha256: 'a'.repeat(64), sent_at: '2026-09-24T00:00:00Z', completed_at: '2026-09-24T01:00:00Z', page_count: 2 },
      sender: { name: 'Alice', email: 'alice@flmlnk.com' },
      recipients: [
        { name: 'Bob', email: 'bob@flmlnk.com', role: 'signer', status: 'signed', signed_at: '2026-09-24T00:30:00Z', signer_ip: '203.0.113.9', signer_user_agent: 'Mozilla/5.0 '.repeat(30), signature: PNG },
        { name: 'Dan', email: 'dan@example.com', role: 'cc', status: 'pending' }
      ],
      events: Array.from({ length: 120 }, (_, i) => ({ created_at: '2026-09-24T00:00:00Z', action: i % 2 ? 'recipient_viewed' : 'recipient_signed', who: 'Bob', ip: '203.0.113.9' }))
    })
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(4) // 2 document pages + certificate pages
  })

  it('wraps long unbroken strings', async () => {
    const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
    const lines = wrap('hash ' + 'f'.repeat(200), font, 9, 100)
    expect(lines.length).toBeGreaterThan(3)
    for (const line of lines) expect(font.widthOfTextAtSize(line, 9)).toBeLessThanOrEqual(100)
    expect(formatTimestamp('2026-09-24T01:02:03.456Z')).toBe('2026-09-24 01:02:03 UTC')
    expect(formatTimestamp(null)).toBe('—')
  })
})
