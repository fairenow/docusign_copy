import { loadPdf, stampFields } from '../../supabase/functions/_shared/pdfStamp.js'
import { stripExtension } from './documents'

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
  const doc = await loadPdf(pdfBytes)
  await stampFields(doc, elements)
  doc.setModificationDate(new Date())
  return doc.save()
}

export function downloadPdf(bytes, fileName, suffix = '_signed') {
  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = stripExtension(fileName || 'document') + suffix + '.pdf'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
