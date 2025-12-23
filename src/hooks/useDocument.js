import { useState, useRef, useCallback } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import * as mammoth from 'mammoth'

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`

export function useDocument() {
  const [file, setFile] = useState(null)
  const [fileType, setFileType] = useState(null)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [totalPages, setTotalPages] = useState(1)
  const [docxHtml, setDocxHtml] = useState('')
  const canvasRef = useRef(null)

  const loadFile = useCallback(async (uploadedFile) => {
    const ext = uploadedFile.name.split('.').pop().toLowerCase()
    
    if (!['pdf', 'docx'].includes(ext)) {
      throw new Error('Please upload a PDF or DOCX file')
    }

    setFile(uploadedFile)
    setFileType(ext)

    if (ext === 'pdf') {
      await loadPDF(uploadedFile)
    } else {
      await loadDOCX(uploadedFile)
    }
  }, [])

  const loadPDF = async (uploadedFile) => {
    const arrayBuffer = await uploadedFile.arrayBuffer()
    
    try {
      const doc = await pdfjsLib.getDocument({
        data: arrayBuffer,
        useWorkerFetch: false,
        isEvalSupported: false
      }).promise
      
      setPdfDoc(doc)
      setTotalPages(doc.numPages)
      setDocxHtml('')
      
      // Render first page
      await renderPageInternal(doc, 1, 1)
    } catch (err) {
      console.error('PDF load error:', err)
      // Fallback loading
      const doc = await pdfjsLib.getDocument(arrayBuffer).promise
      setPdfDoc(doc)
      setTotalPages(doc.numPages)
      await renderPageInternal(doc, 1, 1)
    }
  }

  const renderPageInternal = async (doc, pageNum, zoom) => {
    const page = await doc.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1.5 * zoom })
    
    const canvas = canvasRef.current
    if (!canvas) return
    
    canvas.width = viewport.width
    canvas.height = viewport.height
    
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
  }

  const renderPage = useCallback(async (pageNum, zoom = 1) => {
    if (!pdfDoc) return
    await renderPageInternal(pdfDoc, pageNum, zoom)
  }, [pdfDoc])

  const loadDOCX = async (uploadedFile) => {
    const arrayBuffer = await uploadedFile.arrayBuffer()
    const result = await mammoth.convertToHtml({ arrayBuffer })
    
    setDocxHtml(result.value)
    setPdfDoc(null)
    setTotalPages(1)
  }

  return {
    file,
    fileType,
    pdfDoc,
    totalPages,
    docxHtml,
    loadFile,
    renderPage,
    canvasRef
  }
}
