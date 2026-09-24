import { useState, useCallback, useEffect } from 'react'
import { fileToPdfBytes } from '../lib/documents'
import { detectFormFields } from '../utils/formFieldDetector'
import { usePdf } from './usePdf'

/**
 * Local (Quick sign) document state: an uploaded file, its PDF bytes and detected form fields.
 */
export function useDocument() {
  const [file, setFile] = useState(null)
  const [sourceType, setSourceType] = useState(null)
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

  // Detection only makes sense for real PDFs (a converted DOCX has no form fields)
  useEffect(() => {
    if (pdfDoc && sourceType === 'pdf') detectFields(pdfDoc)
    else setDetectedFields([])
  }, [pdfDoc, sourceType, detectFields])

  const loadFile = useCallback(async (uploadedFile) => {
    const { bytes, sourceType: type } = await fileToPdfBytes(uploadedFile)
    setFile(uploadedFile)
    setSourceType(type)
    setPdfBytes(bytes)
  }, [])

  const clearDetectedFields = useCallback(() => setDetectedFields([]), [])
  const redetectFields = useCallback(() => pdfDoc && detectFields(pdfDoc), [detectFields, pdfDoc])

  return {
    file,
    sourceType,
    pdfBytes,
    pdfDoc,
    pageSizes,
    totalPages: pageSizes.length,
    error,
    loadFile,
    detectedFields,
    isDetecting,
    clearDetectedFields,
    redetectFields
  }
}
