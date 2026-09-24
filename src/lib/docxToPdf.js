/**
 * Convert a DOCX file to PDF bytes in the browser so it goes through the same viewing,
 * field placement and signing pipeline as a PDF.
 *
 * docx-preview lays the document out with Word's own formatting (fonts, alignment,
 * indents, tabs, numbering, tables, page size, margins, headers and footers) inside an
 * isolated frame, so the app's styles cannot change it. Each page is then painted by the
 * browser itself (SVG foreignObject), which reproduces that layout exactly, and the words
 * are added on top as invisible text so the PDF stays searchable and field detection still
 * finds "Signature" lines. html2canvas is only a fallback for browsers that refuse to
 * export such a painting (older Safari); it redraws text itself and is less exact.
 */
import { encodable } from '../../supabase/functions/_shared/pdfStamp.js'

const PX_TO_PT = 0.75 // CSS px are 1/96 in, PDF points 1/72 in
const RENDER_SCALE = 2 // capture at 192 dpi so text stays crisp when zoomed or printed
const LETTER_HEIGHT_PX = 1056

export async function docxToPdf(file) {
  const [{ renderAsync }, { PDFDocument, StandardFonts }] = await Promise.all([import('docx-preview'), import('pdf-lib')])
  const frame = await createLayoutFrame()
  const doc = frame.contentDocument

  try {
    await renderAsync(await file.arrayBuffer(), doc.body, doc.head, {
      className: 'docx',
      inWrapper: false,
      breakPages: true,
      // Word stores where it last broke pages; following it matches Word's pagination
      ignoreLastRenderedPageBreak: false,
      experimental: true,
      useBase64URL: true,
      renderComments: false,
      renderChanges: false
    })
    // The converted document is only rendered, never interacted with
    doc.querySelectorAll('a[href]').forEach(a => a.removeAttribute('href'))
    await doc.fonts?.ready

    const sections = paginate([...doc.querySelectorAll('section.docx')])
    if (!sections.length) throw new Error('This Word document has no pages to show.')
    const styles = [...doc.head.querySelectorAll('style')]

    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    for (const section of sections) {
      const box = section.getBoundingClientRect()
      const pageHeight = pageHeightOf(section) || LETTER_HEIGHT_PX
      const canvas = await paint(section, styles, box)
      const words = wordBoxes(section, box)

      // A block taller than a page (e.g. a long table) cannot be moved; slice it instead
      const slices = Math.max(1, Math.ceil(box.height / pageHeight - 0.01))
      for (let i = 0; i < slices; i++) {
        const top = i * pageHeight
        const height = Math.min(pageHeight, box.height - top)
        const image = await pdf.embedJpg(await sliceToJpeg(canvas, top * RENDER_SCALE, height * RENDER_SCALE))
        const page = pdf.addPage([box.width * PX_TO_PT, pageHeight * PX_TO_PT])
        page.drawImage(image, { x: 0, y: (pageHeight - height) * PX_TO_PT, width: box.width * PX_TO_PT, height: height * PX_TO_PT })
        drawHiddenText(page, font, words.filter(w => w.top >= top && w.top < top + pageHeight), top, pageHeight)
      }
    }
    pdf.setTitle(file.name.replace(/\.docx$/i, ''))
    return await pdf.save()
  } finally {
    frame.remove()
  }
}

/** An off-screen, style-free standards-mode document for laying out the Word file. */
async function createLayoutFrame() {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  // Off screen but laid out (display:none would skip layout); wide enough for any page
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:1800px;height:1200px;border:0;visibility:hidden;'
  const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }))
  frame.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0"></body></html>'
  document.body.appendChild(frame)
  await loaded
  return frame
}

/** Paint one page at RENDER_SCALE exactly as the browser laid it out. */
async function paint(section, styles, box) {
  const width = Math.ceil(box.width)
  const height = Math.ceil(box.height)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width * RENDER_SCALE)
  canvas.height = Math.ceil(height * RENDER_SCALE)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  try {
    const serializer = new XMLSerializer()
    // The page is drawn at the image's top-left corner, as measured, without its on-screen margin or shadow
    const markup = styles.map(s => serializer.serializeToString(s)).join('') +
      '<style>section.docx{margin:0 !important;box-shadow:none !important}</style>' +
      serializer.serializeToString(section)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="margin:0">${markup}</div></foreignObject></svg>`
    // A data: URL (not blob:) keeps the canvas exportable in Chrome
    const image = new Image()
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await image.decode()
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    ctx.getImageData(0, 0, 1, 1) // throws if the browser marked the painting as not exportable
    return canvas
  } catch (err) {
    console.warn('Falling back to html2canvas for this page:', err)
    const { default: html2canvas } = await import('html2canvas')
    return html2canvas(section, { scale: RENDER_SCALE, backgroundColor: '#ffffff', logging: false, windowWidth: 1800 })
  }
}

// docx-preview sizes pages in pt; the computed style gives px
const styleOf = (el) => el.ownerDocument.defaultView.getComputedStyle(el)

function pageHeightOf(section) {
  const style = styleOf(section)
  return parseFloat(style.minHeight) || parseFloat(style.height) || 0
}

/**
 * docx-preview only starts new pages at explicit breaks and sections, so long content makes
 * one tall page. Move blocks that run past the bottom margin onto a copy of the page (same
 * size, margins, header and footer) until every page fits.
 */
export function paginate(sections) {
  const pages = []
  for (let section of sections) {
    while (section) {
      pages.push(section)
      section = splitOverflow(section)
    }
  }
  return pages
}

function splitOverflow(section) {
  const pageHeight = pageHeightOf(section)
  if (!pageHeight || section.getBoundingClientRect().height <= pageHeight + 1) return null
  const article = section.querySelector(':scope > article')
  if (!article) return null

  const bottom = section.getBoundingClientRect().top + pageHeight - parseFloat(styleOf(section).paddingBottom || '0')
  const blocks = [...article.children]
  const first = blocks.findIndex(block => block.getBoundingClientRect().bottom > bottom + 0.5)
  // Nothing to move, or the first block alone is taller than the page (sliced later)
  if (first <= 0) return null

  const next = section.cloneNode(false)
  for (const child of section.children) {
    next.appendChild(child === article ? article.cloneNode(false) : child.cloneNode(true))
  }
  const nextArticle = next.querySelector(':scope > article')
  for (const block of blocks.slice(first)) nextArticle.appendChild(block)
  // Numbered lists continue on the next page instead of restarting
  carryCounters(blocks[first - 1], nextArticle)
  section.after(next)
  return next
}

/** Keep automatic numbering (CSS counters) running across a moved page break. */
function carryCounters(lastKept, nextArticle) {
  const counters = styleOf(lastKept).counterIncrement
  if (!counters || counters === 'none') return
  const names = counters.split(/\s+/).filter(token => /^[A-Za-z_-][\w-]*$/.test(token))
  if (!names.length) return
  // Count occurrences before the split point by scanning earlier numbered blocks
  const values = Object.fromEntries(names.map(n => [n, 0]))
  let node = lastKept
  while (node) {
    const inc = styleOf(node).counterIncrement
    for (const name of names) if (inc.split(/\s+/).includes(name)) values[name]++
    node = node.previousElementSibling
  }
  nextArticle.style.counterReset = names.map(n => `${n} ${values[n]}`).join(' ')
}

/** Every word's box relative to the page, for the invisible text layer. */
function wordBoxes(section, box) {
  const words = []
  const doc = section.ownerDocument
  const walker = doc.createTreeWalker(section, NodeFilter.SHOW_TEXT)
  const range = doc.createRange()
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent
    for (const match of text.matchAll(/\S+/g)) {
      range.setStart(node, match.index)
      range.setEnd(node, match.index + match[0].length)
      const r = range.getBoundingClientRect()
      if (r.width < 0.5 || r.height < 0.5) continue
      words.push({ text: match[0], left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height })
    }
  }
  return words
}

function drawHiddenText(page, font, words, sliceTop, pageHeight) {
  for (const word of words) {
    const text = encodable(font, word.text)
    if (!text) continue
    const unitWidth = font.widthOfTextAtSize(text, 1)
    if (!unitWidth) continue
    // Size the text to cover the word's width, so selection and search line up
    const size = Math.min((word.width * PX_TO_PT) / unitWidth, word.height * PX_TO_PT)
    const baseline = pageHeight - (word.top - sliceTop) - word.height * 0.8
    page.drawText(text, { x: word.left * PX_TO_PT, y: baseline * PX_TO_PT, size, font, opacity: 0 })
  }
}

function sliceToJpeg(canvas, top, height) {
  const slice = document.createElement('canvas')
  slice.width = canvas.width
  slice.height = Math.max(1, Math.round(height))
  const ctx = slice.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, slice.width, slice.height)
  ctx.drawImage(canvas, 0, -Math.round(top))
  return new Promise((resolve, reject) => slice.toBlob(
    blob => blob ? blob.arrayBuffer().then(resolve, reject) : reject(new Error('Could not render the document page')),
    'image/jpeg',
    0.92
  ))
}
