import { jsPDF } from 'jspdf'

export async function generatePDF({
  elements,
  canvasRef,
  docxHtml,
  pdfDoc,
  fileType,
  totalPages,
  zoom,
  fileName
}) {
  // Helper to render PDF page to canvas
  const renderPDFPageToCanvas = async (doc, pageNum, targetCanvas) => {
    const page = await doc.getPage(pageNum)
    const viewport = page.getViewport({ scale: 1.5 * zoom })
    
    targetCanvas.width = viewport.width
    targetCanvas.height = viewport.height
    
    const ctx = targetCanvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
  }

  // Create composite canvas with document + overlays
  const createCompositeCanvas = async (pageNum) => {
    const sourceCanvas = canvasRef.current
    let sourceWidth = 612
    let sourceHeight = 792

    // Render PDF page if needed
    if (fileType === 'pdf' && pdfDoc) {
      await renderPDFPageToCanvas(pdfDoc, pageNum, sourceCanvas)
      sourceWidth = sourceCanvas.width
      sourceHeight = sourceCanvas.height
    }

    // Create composite canvas
    const compositeCanvas = document.createElement('canvas')
    compositeCanvas.width = sourceWidth
    compositeCanvas.height = sourceHeight
    const ctx = compositeCanvas.getContext('2d')

    // White background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, sourceWidth, sourceHeight)

    // Draw document
    if (fileType === 'pdf' && sourceCanvas) {
      ctx.drawImage(sourceCanvas, 0, 0)
    }

    // Draw overlay elements for this page
    const pageElements = elements.filter(el => el.page === pageNum)

    for (const el of pageElements) {
      if (el.type === 'signature') {
        const img = new Image()
        img.src = el.data
        await new Promise((resolve) => {
          img.onload = resolve
          img.onerror = resolve
          setTimeout(resolve, 1000)
        })
        const sigWidth = Math.min(img.width, 200)
        const sigHeight = (sigWidth / img.width) * img.height
        ctx.drawImage(img, el.x, el.y, sigWidth, sigHeight)
      } else if (el.type === 'text' || el.type === 'date') {
        ctx.font = `${el.fontSize || 14}px Arial, sans-serif`
        ctx.fillStyle = el.color || '#000000'
        ctx.fillText(el.text || '', el.x + 8, el.y + parseInt(el.fontSize || 14) + 4)
      } else if (el.type === 'initials') {
        ctx.font = 'italic 20px "Brush Script MT", cursive, Arial'
        ctx.fillStyle = '#000000'
        ctx.fillText(el.text, el.x + 8, el.y + 20)
      } else if (el.type === 'checkbox') {
        ctx.strokeStyle = '#3b82f6'
        ctx.lineWidth = 2
        ctx.strokeRect(el.x, el.y, 18, 18)
        if (el.checked) {
          ctx.fillStyle = '#3b82f6'
          ctx.font = 'bold 16px Arial'
          ctx.fillText('✓', el.x + 2, el.y + 15)
        }
      }
    }

    return compositeCanvas
  }

  // Generate first page to get dimensions
  const firstCanvas = await createCompositeCanvas(1)
  const pageWidth = firstCanvas.width
  const pageHeight = firstCanvas.height

  // Create PDF
  const pxToPt = 0.75
  const pdf = new jsPDF({
    orientation: pageWidth > pageHeight ? 'l' : 'p',
    unit: 'pt',
    format: [pageWidth * pxToPt, pageHeight * pxToPt]
  })

  // Process all pages
  const pagesToProcess = fileType === 'pdf' ? totalPages : 1

  for (let i = 1; i <= pagesToProcess; i++) {
    if (i > 1) {
      pdf.addPage([pageWidth * pxToPt, pageHeight * pxToPt])
    }

    const compositeCanvas = await createCompositeCanvas(i)
    const imgData = compositeCanvas.toDataURL('image/jpeg', 0.92)

    pdf.addImage(imgData, 'JPEG', 0, 0, pageWidth * pxToPt, pageHeight * pxToPt)
  }

  // Generate and download
  const pdfBlob = pdf.output('blob')
  const downloadFileName = (fileName || 'document').replace(/\.[^/.]+$/, '') + '_signed.pdf'

  const downloadUrl = URL.createObjectURL(pdfBlob)
  const link = document.createElement('a')
  link.href = downloadUrl
  link.download = downloadFileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  setTimeout(() => URL.revokeObjectURL(downloadUrl), 100)
}
