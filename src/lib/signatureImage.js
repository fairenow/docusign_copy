import '@fontsource/dancing-script/600.css'

export const SIGNATURE_FONT = '"Dancing Script", cursive'

/**
 * Render text in the signature font to a tightly-cropped transparent PNG.
 * Returns { data: dataURL, aspect: width / height }.
 */
export async function renderTypedSignature(text, { fontSize = 64, color = '#0f172a' } = {}) {
  const font = `600 ${fontSize}px ${SIGNATURE_FONT}`
  // Make sure the web font is ready before drawing to canvas
  try {
    await document.fonts.load(font, text)
  } catch {
    // Fall back to whatever cursive font is available
  }

  const measure = document.createElement('canvas').getContext('2d')
  measure.font = font
  const width = Math.ceil(measure.measureText(text).width + fontSize * 0.6)
  const height = Math.ceil(fontSize * 1.6)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.font = font
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, fontSize * 0.3, height / 2)

  return trimCanvas(canvas)
}

/**
 * Crop a canvas to the bounding box of its non-transparent pixels.
 * Returns null if the canvas is empty.
 */
export function trimCanvas(canvas, padding = 4) {
  const ctx = canvas.getContext('2d')
  const { width, height } = canvas
  const { data } = ctx.getImageData(0, 0, width, height)

  let top = height, left = width, right = -1, bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  if (right < 0) return null

  left = Math.max(0, left - padding)
  top = Math.max(0, top - padding)
  right = Math.min(width - 1, right + padding)
  bottom = Math.min(height - 1, bottom + padding)

  const w = right - left + 1
  const h = bottom - top + 1
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  out.getContext('2d').drawImage(canvas, left, top, w, h, 0, 0, w, h)
  return { data: out.toDataURL('image/png'), aspect: w / h }
}

/** A saved signature image as { data, aspect } (width / height), like the signature pad returns. */
export async function signatureFromImage(dataUrl) {
  const image = new Image()
  image.src = dataUrl
  await image.decode()
  return { data: dataUrl, aspect: image.naturalWidth / image.naturalHeight || 3 }
}
