import { PDFDocument, StandardFonts, degrees } from 'pdf-lib'

/** A small two-page PDF (page 2 rotated) generated on the fly. */
export async function makePdf({ rotateSecondPage = true } = {}) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const p1 = doc.addPage([612, 792])
  p1.drawText('Mutual NDA', { x: 72, y: 720, size: 20, font })
  p1.drawText('Signature: ____________________', { x: 72, y: 200, size: 12, font })
  const p2 = doc.addPage([612, 792])
  if (rotateSecondPage) p2.setRotation(degrees(90))
  p2.drawText('Page two', { x: 72, y: 700, size: 14, font })
  return Buffer.from(await doc.save())
}

export const pdfFile = async (name = 'Mutual NDA.pdf') => ({ name, mimeType: 'application/pdf', buffer: await makePdf() })

/**
 * A look-alike NDA signature page: FLMLNK's block (partly filled in) on the left, the other
 * party's on the right, drawn lines and a line of underscores, and a "[COMPANY NAME]"
 * placeholder in the text. Line positions (display points from the top) are exported.
 */
export const SIGNATURE_PAGE_LINES = { by: 573, name: 600, its: 629, date: 651 }

export async function makeSignaturePagePdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold)
  const page = doc.addPage([612, 792])
  const top = (y) => 792 - y
  const text = (s, x, y, size = 11, f = font) => page.drawText(s, { x, y: top(y), size, font: f })
  const line = (x1, x2, y) => page.drawLine({ start: { x: x1, y: top(y) }, end: { x: x2, y: top(y) }, thickness: 0.6 })
  const { by, name, its, date } = SIGNATURE_PAGE_LINES

  text('This Mutual Non-Disclosure Agreement is made with [COMPANY NAME] (the "Recipient").', 72, 200)
  text('IN WITNESS WHEREOF, the parties have signed this Agreement.', 72, 500)

  // FLMLNK, with the name and title already typed in
  text('FLMLNK, INC.', 72, 540, 11, bold)
  text('By:', 72, by - 1); line(95, 290, by); text('(Signature)', 165, by + 11, 8)
  line(95, 290, name); text('DeVante Watkins', 125, name - 2); text('(Type or Print Name)', 150, name + 11, 8)
  text('Its:', 72, its - 1); line(92, 290, its); text('Co-Founder', 110, its - 2)
  text('Date:', 72, date - 1); line(100, 290, date)

  // The other party, all blank; its date line is typed underscores
  text('RECIPIENT', 340, 540, 11, bold)
  text('By:', 340, by - 1); line(362, 560, by); text('(Signature)', 435, by + 11, 8)
  line(340, 560, name); text('(Type or Print Name)', 420, name + 11, 8)
  text('Its:', 336, its - 1); line(358, 560, its)
  text('Date: ________________________________', 340, date - 1)
  return Buffer.from(await doc.save())
}
