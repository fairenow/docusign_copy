import {
  PDFDocument,
  StandardFonts,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  EncryptedPDFError
} from 'pdf-lib'

/**
 * Return the fields that still need input before the document can be exported.
 */
export function findIncompleteElements(elements) {
  return elements.filter(el =>
    (el.type === 'signature' || el.type === 'initials') && !el.data
  )
}

/**
 * Write the placed fields into the original PDF and return the new PDF bytes.
 * The original page content is preserved (text stays selectable and searchable).
 *
 * @param {Uint8Array} pdfBytes original document
 * @param {Array} elements fields with fractional x/y/w/h (see lib/fields.js)
 */
export async function buildSignedPdf(pdfBytes, elements) {
  let doc
  try {
    doc = await PDFDocument.load(pdfBytes)
  } catch (err) {
    if (err instanceof EncryptedPDFError) {
      throw new Error('This PDF is password-protected or encrypted and cannot be signed. Remove the protection and try again.')
    }
    throw err
  }

  const font = await doc.embedFont(StandardFonts.Helvetica)
  const images = new Map()
  const embedImage = async (dataUrl) => {
    if (!images.has(dataUrl)) images.set(dataUrl, await doc.embedPng(dataUrl))
    return images.get(dataUrl)
  }

  const pages = doc.getPages()

  for (const el of elements) {
    const page = pages[el.page - 1]
    if (!page) continue

    // Existing content can leave the graphics state transformed. Normalizing the page makes
    // pdf-lib wrap it in q/Q so our drawing starts from a clean state. Must happen before
    // anything is drawn on the page.
    page.node.normalize()

    const { matrix, width: dispW, height: dispH } = displaySpace(page)
    // Field rect in display space (points, origin bottom-left)
    const w = el.w * dispW
    const h = el.h * dispH
    const x = el.x * dispW
    const y = dispH - el.y * dispH - h

    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix))

    switch (el.type) {
      case 'signature':
      case 'initials': {
        if (!el.data) break
        const image = await embedImage(el.data)
        const scale = Math.min(w / image.width, h / image.height)
        const iw = image.width * scale
        const ih = image.height * scale
        page.drawImage(image, { x: x + (w - iw) / 2, y: y + (h - ih) / 2, width: iw, height: ih })
        break
      }
      case 'text':
      case 'date': {
        const text = encodable(font, el.text || '')
        if (!text) break
        const size = Number(el.fontSize) || 12
        page.drawText(text, {
          x: x + 2,
          y: y + (h - size * 0.7) / 2,
          size,
          font,
          color: hexToRgb(el.color)
        })
        break
      }
      case 'checkbox': {
        page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 1 })
        if (el.checked) {
          const thickness = Math.max(1, Math.min(w, h) / 8)
          const color = rgb(0.05, 0.05, 0.05)
          page.drawLine({ start: { x: x + w * 0.2, y: y + h * 0.5 }, end: { x: x + w * 0.42, y: y + h * 0.25 }, thickness, color })
          page.drawLine({ start: { x: x + w * 0.42, y: y + h * 0.25 }, end: { x: x + w * 0.8, y: y + h * 0.78 }, thickness, color })
        }
        break
      }
    }

    page.pushOperators(popGraphicsState())
  }

  doc.setModificationDate(new Date())
  return doc.save()
}

export function downloadPdf(bytes, fileName) {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = (fileName || 'document').replace(/\.[^/.]+$/, '') + '_signed.pdf'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Compute the transform from "display space" (the page as a viewer shows it, after /Rotate,
 * origin at the bottom-left of the crop box) to PDF user space.
 */
function displaySpace(page) {
  const { x, y, width: W, height: H } = page.getCropBox()
  const rotation = ((page.getRotation().angle % 360) + 360) % 360

  switch (rotation) {
    case 90:
      return { width: H, height: W, matrix: [0, 1, -1, 0, x + W, y] }
    case 180:
      return { width: W, height: H, matrix: [-1, 0, 0, -1, x + W, y + H] }
    case 270:
      return { width: H, height: W, matrix: [0, -1, 1, 0, x, y + H] }
    default:
      return { width: W, height: H, matrix: [1, 0, 0, 1, x, y] }
  }
}

// Standard PDF fonts only cover WinAnsi; drop characters they cannot encode
function encodable(font, text) {
  return [...text].filter(ch => {
    try {
      font.encodeText(ch)
      return true
    } catch {
      return false
    }
  }).join('')
}

function hexToRgb(hex) {
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '')
  if (!match) return rgb(0, 0, 0)
  return rgb(parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255)
}
