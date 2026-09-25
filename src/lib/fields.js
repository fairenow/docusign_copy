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
  checkbox: { width: 14, height: 14 },
  prefill: { width: 180, height: 18 }
}

export const FIELD_TYPES = ['signature', 'initials', 'text', 'date', 'checkbox']

/** Fields a sender fills in before sending (envelopes only) */
export const SENDER_FIELD_TYPES = ['prefill']

export { FIELD_LABELS, DEFAULT_FONT_SIZE } from '../../supabase/functions/_shared/labels.js'
import { DEFAULT_FONT_SIZE } from '../../supabase/functions/_shared/labels.js'
export const FONT_SIZES = [8, 10, 11, 12, 14, 16, 18, 24]

// Minimum size (in PDF points) when resizing
export const MIN_SIZE = 8

export function newId() {
  return crypto.randomUUID()
}

function formatToday() {
  return new Date().toLocaleDateString()
}

/**
 * Geometry for a new field: { id, type, page, x, y, w, h } in page fractions.
 * @param {string} type
 * @param {{ page: number, pageSize: { width: number, height: number } }} placement
 *   pageSize is the displayed page size in PDF points
 * @param {{ x?, y?, w?, h?, aspect? }} props optional position/size (fractions) or image aspect ratio
 */
export function placeField(type, { page, pageSize }, props = {}) {
  if (!DEFAULT_SIZES[type]) throw new Error(`Unknown field type: ${type}`)
  const size = { ...DEFAULT_SIZES[type] }

  // Size image-based fields to the image's aspect ratio
  if (props.aspect && (type === 'signature' || type === 'initials')) {
    size.width = Math.min(size.height * props.aspect, type === 'signature' ? 220 : 90)
  }

  // Never wider or taller than the page (small pages, oversized form widgets)
  const w = Math.min(props.w ?? size.width / pageSize.width, 1)
  const h = Math.min(props.h ?? size.height / pageSize.height, 1)

  return {
    id: newId(),
    type,
    page,
    x: clamp(props.x ?? 0.5 - w / 2, 0, 1 - w),
    y: clamp(props.y ?? 0.3, 0, 1 - h),
    w,
    h
  }
}

/**
 * Create a fill-in element (Quick sign): geometry plus the value the user fills in.
 * @param {object} props geometry props (see placeField) plus text, data, checked, fontSize, color
 */
export function createElement(type, placement, props = {}) {
  const base = placeField(type, placement, props)
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
  }
}

/**
 * Map a detected form field (see utils/formFieldDetector) to an element.
 * Detected fields carry pixel coordinates plus the page size they were measured against.
 */
export function elementFromDetected(field, pageSize, { initials } = {}) {
  const type = { radio: 'checkbox', dropdown: 'text' }[field.type] ?? field.type
  const known = FIELD_TYPES.includes(type) ? type : 'text'

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

/**
 * The rectangle a field being placed takes with the pointer at (x, y), in page fractions.
 * Nothing snaps: the field goes exactly where the preview shows it. Its bottom-left corner is
 * at the pointer, so pointing at the start of a line puts the field on it; a checkbox is
 * centred on it. `props.aspect` sizes a signature image as placeField does.
 */
export function placementRect(type, pageSize, x, y, props = {}) {
  const { w, h } = placeField(type, { page: 1, pageSize }, { aspect: props.aspect })
  const [left, top] = type === 'checkbox' ? [x - w / 2, y - h / 2] : [x, y - h]
  return { x: clamp(left, 0, 1 - w), y: clamp(top, 0, 1 - h), w, h }
}

/**
 * Where a field added without a mouse goes: centred on `spot` (where you are looking, see
 * spotInView), kept on the page, and moved clear of the fields already there (`others`, on
 * the same page) so several added in a row do not hide each other.
 */
export function rectInView(type, pageSize, spot, others = [], props = {}) {
  const { w, h } = placeField(type, { page: spot.page, pageSize }, { aspect: props.aspect })
  const gap = 6 / pageSize.height
  const at = (y) => ({ x: clamp(spot.x - w / 2, 0, 1 - w), y: clamp(y, 0, 1 - h), w, h })
  const overlaps = (r) => others.some(o => r.x < o.x + o.w && o.x < r.x + r.w && r.y < o.y + o.h && o.y < r.y + r.h)
  const start = spot.y - h / 2
  // Try the spot itself, then just below, then just above, stepping outwards
  for (let step = 0; step < 12; step++) {
    const offset = Math.ceil(step / 2) * (h + gap) * (step % 2 ? 1 : -1)
    const rect = at(start + offset)
    if (!overlaps(rect)) return rect
  }
  return at(start)
}

/** A mouse or trackpad: fields can follow the pointer until clicked into place (touch has no hover). */
export const canHover = () => Boolean(window.matchMedia?.('(hover: hover) and (pointer: fine)').matches)

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
