export const MAX_FILE_SIZE = 50 * 1024 * 1024
export const ACCEPTED_FILE_TYPES = '.pdf,.docx'

/**
 * Validate an uploaded file and return it as PDF bytes (DOCX is converted).
 * @returns {Promise<{ bytes: Uint8Array, sourceType: 'pdf' | 'docx' }>}
 */
export async function fileToPdfBytes(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext !== 'pdf' && ext !== 'docx') {
    throw new Error('Please upload a PDF or DOCX file')
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File is larger than 50 MB')
  }

  if (ext === 'pdf') {
    return { bytes: new Uint8Array(await file.arrayBuffer()), sourceType: 'pdf' }
  }
  const { docxToPdf } = await import('./docxToPdf')
  return { bytes: await docxToPdf(file), sourceType: 'docx' }
}

/**
 * Open PDF bytes with pdf.js and measure every page.
 * Page sizes are the displayed (rotation-applied) sizes in PDF points.
 */
export async function openPdf(bytes) {
  // Loaded on demand so pages that never show a PDF (e.g. /login) do not download pdf.js
  const { loadPdfDocument } = await import('./pdfjs')
  const doc = await loadPdfDocument(bytes)
  const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)))
  const pageSizes = pages.map(page => {
    const { width, height } = page.getViewport({ scale: 1 })
    return { width, height }
  })
  return { doc, pageSizes }
}

export function stripExtension(fileName) {
  return fileName.replace(/\.[^/.]+$/, '')
}
