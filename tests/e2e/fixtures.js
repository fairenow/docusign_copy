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
