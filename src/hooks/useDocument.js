import { useState, useCallback } from 'react'
import { loadPdfDocument } from '../lib/pdfjs'
import { detectFormFields } from '../utils/formFieldDetector'

const MAX_FILE_SIZE = 50 * 1024 * 1024

export function useDocument() {
  const [file, setFile] = useState(null)
  const [sourceType, setSourceType] = useState(null)
  const [pdfBytes, setPdfBytes] = useState(null)
  const [pdfDoc, setPdfDoc] = useState(null)
  // Displayed (rotation-applied) size of each page in PDF points
  const [pageSizes, setPageSizes] = useState([])
  const [detectedFields, setDetectedFields] = useState([])
  const [isDetecting, setIsDetecting] = useState(false)

  const detectFields = useCallback(async (doc) => {
    if (!doc) return
    setIsDetecting(true)
    setDetectedFields([])
    try {
      const result = await detectFormFields(doc)
      setDetectedFields(result.allFields)
    } catch (err) {
      console.warn('Field detection error:', err)
      setDetectedFields([])
    }
    setIsDetecting(false)
  }, [])

  const loadFile = useCallback(async (uploadedFile) => {
    const ext = uploadedFile.name.split('.').pop().toLowerCase()
    if (!['pdf', 'docx'].includes(ext)) {
      throw new Error('Please upload a PDF or DOCX file')
    }
    if (uploadedFile.size > MAX_FILE_SIZE) {
      throw new Error('File is larger than 50 MB')
    }

    let bytes
    if (ext === 'pdf') {
      bytes = new Uint8Array(await uploadedFile.arrayBuffer())
    } else {
      const { docxToPdf } = await import('../lib/docxToPdf')
      bytes = await docxToPdf(uploadedFile)
    }

    const doc = await loadPdfDocument(bytes)
    const sizes = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const { width, height } = page.getViewport({ scale: 1 })
      sizes.push({ width, height })
    }

    pdfDoc?.destroy()
    setFile(uploadedFile)
    setSourceType(ext)
    setPdfBytes(bytes)
    setPdfDoc(doc)
    setPageSizes(sizes)

    // Field detection only makes sense for real PDFs (a converted DOCX has no form fields)
    if (ext === 'pdf') {
      detectFields(doc)
    } else {
      setDetectedFields([])
    }
  }, [pdfDoc, detectFields])

  const clearDetectedFields = useCallback(() => setDetectedFields([]), [])
  const redetectFields = useCallback(() => detectFields(pdfDoc), [detectFields, pdfDoc])

  return {
    file,
    sourceType,
    pdfBytes,
    pdfDoc,
    pageSizes,
    totalPages: pageSizes.length,
    loadFile,
    detectedFields,
    isDetecting,
    clearDetectedFields,
    redetectFields
  }
}
