const MAX_FILE_SIZE = 50 * 1024 * 1024
// Converted on our server with LibreOffice, so the layout matches the original exactly
export const CONVERTIBLE_EXTENSIONS = ['docx', 'doc', 'odt', 'rtf']
const MAX_CONVERTIBLE_SIZE = 25 * 1024 * 1024
export const ACCEPTED_FILE_TYPES = ['.pdf', ...CONVERTIBLE_EXTENSIONS.map(ext => `.${ext}`)].join(',')

const extensionOf = (file) => file.name.split('.').pop().toLowerCase()
/** Word and similar files, which are converted to PDF on the server. */
export const isConvertible = (file) => CONVERTIBLE_EXTENSIONS.includes(extensionOf(file))

/**
 * Validate an uploaded file and return it as PDF bytes (Word and similar files are
 * converted on the server; PDFs are used as they are).
 * @returns {Promise<{ bytes: Uint8Array, sourceType: 'pdf' | 'converted' }>}
 */
export async function fileToPdfBytes(file) {
  if (extensionOf(file) === 'pdf') {
    if (file.size > MAX_FILE_SIZE) throw new Error('PDFs must be 50 MB or smaller.')
    return { bytes: new Uint8Array(await file.arrayBuffer()), sourceType: 'pdf' }
  }
  if (!isConvertible(file)) {
    throw new Error('Please upload a PDF or a Word document (.docx, .doc), .odt or .rtf file.')
  }
  if (file.size > MAX_CONVERTIBLE_SIZE) throw new Error('Word documents must be 25 MB or smaller.')
  // Loaded on demand: api.js imports this module
  const { convertDocumentToPdf } = await import('./api')
  return { bytes: await convertDocumentToPdf(file), sourceType: 'converted' }
}

/**
 * Start loading pdf.js and its worker. Pages call this while their document is still
 * downloading, so the two arrive together instead of one after the other.
 */
export function preloadPdfViewer() {
  import('./pdfjs').then(({ sharedWorker }) => sharedWorker()).catch(() => {})
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
