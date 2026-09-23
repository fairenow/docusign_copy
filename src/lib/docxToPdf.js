/**
 * Convert a DOCX file to PDF bytes in the browser so it can go through the same
 * viewing, field placement and export pipeline as a PDF.
 *
 * Layout is approximate (mammoth keeps structure, not exact Word formatting),
 * so users should review the converted pages before placing fields.
 */
export async function docxToPdf(file) {
  const [mammothModule, { jsPDF }] = await Promise.all([import('mammoth'), import('jspdf')])
  const mammoth = mammothModule.default ?? mammothModule

  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })

  // 816px = 8.5in at 96dpi, matching a US Letter page 612pt wide
  const container = document.createElement('div')
  container.className = 'docx-content'
  // html2canvas only captures what is laid out in the viewport, so render it in place behind the app
  container.style.cssText = 'position:absolute;left:0;top:0;z-index:-1;width:816px;padding:0 96px;min-height:0;min-width:0;'
  container.innerHTML = html
  // The converted document is only rendered, never interacted with
  container.querySelectorAll('a[href]').forEach(a => a.removeAttribute('href'))
  document.body.appendChild(container)

  try {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
    await new Promise((resolve, reject) => {
      pdf.html(container, {
        x: 0,
        y: 0,
        width: 612,
        windowWidth: 816,
        margin: [54, 0, 54, 0],
        autoPaging: 'text',
        html2canvas: { scrollX: 0, scrollY: 0, logging: false },
        callback: resolve
      }).catch?.(reject)
    })
    return new Uint8Array(pdf.output('arraybuffer'))
  } finally {
    container.remove()
  }
}
