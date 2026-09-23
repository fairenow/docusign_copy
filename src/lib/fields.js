/**
 * Field model shared by the editor and the PDF exporter.
 *
 * Positions and sizes are stored as fractions (0–1) of the page as displayed
 * (i.e. after the page's /Rotate is applied), so they are independent of zoom,
 * screen density and page size. Font sizes are in PDF points.
 */

// Default field sizes in PDF points
export const DEFAULT_SIZES = {
  signature: { width: 150, height: 40 },
  initials: { width: 60, height: 30 },
  text: { width: 160, height: 22 },
  date: { width: 110, height: 22 },
  checkbox: { width: 14, height: 14 }
}

export const DEFAULT_FONT_SIZE = 12

// Minimum size (in PDF points) when resizing
export const MIN_SIZE = 8

export function newId() {
  return crypto.randomUUID()
}

export function formatToday() {
  return new Date().toLocaleDateString()
}

/**
 * Create a field element.
 * @param {string} type
 * @param {{ page: number, pageSize: { width: number, height: number } }} placement
 *   pageSize is the displayed page size in PDF points
 * @param {object} props additional props (x, y, w, h fractions; text; data; ...)
 */
export function createElement(type, { page, pageSize }, props = {}) {
  const size = { ...DEFAULT_SIZES[type] }

  // Size image-based fields to the image's aspect ratio
  if (props.aspect && (type === 'signature' || type === 'initials')) {
    size.width = Math.min(size.height * props.aspect, type === 'signature' ? 220 : 90)
  }

  const w = props.w ?? size.width / pageSize.width
  const h = props.h ?? size.height / pageSize.height

  const base = {
    id: newId(),
    type,
    page,
    x: clamp(props.x ?? 0.5 - w / 2, 0, 1 - w),
    y: clamp(props.y ?? 0.3, 0, 1 - h),
    w,
    h
  }

  switch (type) {
    case 'text':
      return { ...base, text: props.text ?? '', fontSize: props.fontSize ?? DEFAULT_FONT_SIZE, color: props.color ?? '#000000' }
    case 'date':
      return { ...base, text: props.text ?? formatToday(), fontSize: props.fontSize ?? DEFAULT_FONT_SIZE, color: '#000000' }
    case 'checkbox':
      return { ...base, checked: props.checked ?? false }
    case 'signature':
    case 'initials':
      return { ...base, data: props.data ?? null, text: props.text ?? '' }
    default:
      throw new Error(`Unknown field type: ${type}`)
  }
}

/**
 * Map a detected form field (see utils/formFieldDetector) to an element.
 * Detected fields carry pixel coordinates plus the page size they were measured against.
 */
export function elementFromDetected(field, pageSize, { initials } = {}) {
  const type = { radio: 'checkbox', dropdown: 'text' }[field.type] ?? field.type
  const known = ['signature', 'initials', 'text', 'date', 'checkbox'].includes(type) ? type : 'text'

  const props = {
    x: field.x / field.pageWidth,
    y: field.y / field.pageHeight
  }
  // AcroForm widgets have a real size; content-analysis guesses do not, so use defaults there
  if (field.source === 'acroform' && field.width > 0 && field.height > 0) {
    props.w = field.width / field.pageWidth
    props.h = field.height / field.pageHeight
  } else {
    // Content analysis reports the text baseline; lift the field so it sits on the line
    const pageHeightPt = pageSize.height
    props.y -= (DEFAULT_SIZES[known].height * 0.75) / pageHeightPt
  }
  if (known === 'text') props.text = field.value || ''
  if (known === 'checkbox') props.checked = false
  if (known === 'initials' && initials) {
    props.data = initials.data
    props.text = initials.text
  }

  return createElement(known, { page: field.page, pageSize }, props)
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
