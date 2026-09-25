import { useState, useCallback, useEffect } from 'react'
import { fileToPdfBytes } from '../lib/documents'
import { detectFormFields } from '../utils/formFieldDetector'
import { usePdf } from './usePdf'

/**
 * Local (Quick sign) document state: an uploaded file, its PDF bytes and detected form fields.
 */
export function useDocument() {
  const [file, setFile] = useState(null)
  const [pdfBytes, setPdfBytes] = useState(null)
  const [detectedFields, setDetectedFields] = useState([])
  const [isDetecting, setIsDetecting] = useState(false)
  const { doc: pdfDoc, pageSizes, error } = usePdf(pdfBytes)

  const detectFields = useCallback(async (doc) => {
    setIsDetecting(true)
    setDetectedFields([])
    try {
      const result = await detectFormFields(doc)
      setDetectedFields(result.allFields)
    } catch (err) {
      console.warn('Field detection error:', err)
    }
    setIsDetecting(false)
  }, [])

  // Converted documents are real PDFs with text too, so detection works for every upload
  useEffect(() => {
    if (pdfDoc) detectFields(pdfDoc)
    else setDetectedFields([])
  }, [pdfDoc, detectFields])

  const loadFile = useCallback(async (uploadedFile) => {
    const { bytes } = await fileToPdfBytes(uploadedFile)
    setFile(uploadedFile)
    setPdfBytes(bytes)
  }, [])

  const clearDetectedFields = useCallback(() => setDetectedFields([]), [])
  const redetectFields = useCallback(() => pdfDoc && detectFields(pdfDoc), [detectFields, pdfDoc])

  return {
    file,
    pdfBytes,
    pdfDoc,
    pageSizes,
    error,
    loadFile,
    detectedFields,
    isDetecting,
    clearDetectedFields,
    redetectFields
  }
}
