/**
 * Form Field Detector Utility
 * Detects interactive form fields (AcroForms) and visual patterns in PDF documents
 */

// Base scale used for rendering - must match useDocument.js
const BASE_SCALE = 1.5

// Field type constants
export const FIELD_TYPES = {
  TEXT: 'text',
  CHECKBOX: 'checkbox',
  RADIO: 'radio',
  SIGNATURE: 'signature',
  DATE: 'date',
  INITIALS: 'initials',
  DROPDOWN: 'dropdown'
}

// Common patterns for detecting field types from labels/names
const SIGNATURE_PATTERNS = [
  /signature/i,
  /sign here/i,
  /^sign$/i,
  /signatory/i
]

const DATE_PATTERNS = [
  /^date:/i,
  /^date$/i,
  /dated:/i
]

const INITIAL_PATTERNS = [
  /initial/i,
  /initials/i,
  /^init$/i
]

// More strict checkbox patterns - only match actual checkbox indicators
const CHECKBOX_PATTERNS = [
  /^\s*\[\s*\]\s*/,      // [ ] at start
  /^\s*\(\s*\)\s*/,      // ( ) at start
  /^□/,                   // Empty box character
  /^☐/                    // Ballot box character
]

/**
 * Detect the field type based on field name and properties
 */
function detectFieldType(fieldName, fieldType, fieldFlags) {
  const name = fieldName?.toLowerCase() || ''

  // Check PDF field type first
  if (fieldType === 'Btn') {
    // Check if it's a radio button (has Radio flag) or checkbox
    if (fieldFlags && (fieldFlags & 32768)) { // Radio flag
      return FIELD_TYPES.RADIO
    }
    return FIELD_TYPES.CHECKBOX
  }

  if (fieldType === 'Ch') {
    return FIELD_TYPES.DROPDOWN
  }

  if (fieldType === 'Sig') {
    return FIELD_TYPES.SIGNATURE
  }

  // For text fields, check patterns to determine specific type
  if (SIGNATURE_PATTERNS.some(p => p.test(name))) {
    return FIELD_TYPES.SIGNATURE
  }

  if (DATE_PATTERNS.some(p => p.test(name))) {
    return FIELD_TYPES.DATE
  }

  if (INITIAL_PATTERNS.some(p => p.test(name))) {
    return FIELD_TYPES.INITIALS
  }

  return FIELD_TYPES.TEXT
}

/**
 * Get a user-friendly label for the field
 */
function getFieldLabel(fieldName, detectedType, index) {
  if (fieldName && fieldName.trim()) {
    // Clean up common PDF field naming conventions
    let label = fieldName
      .replace(/[_-]/g, ' ')
      .replace(/\d+$/, '')
      .trim()

    if (label) {
      return label.charAt(0).toUpperCase() + label.slice(1)
    }
  }

  // Generate default label based on type
  const typeLabels = {
    [FIELD_TYPES.TEXT]: 'Text Field',
    [FIELD_TYPES.CHECKBOX]: 'Checkbox',
    [FIELD_TYPES.RADIO]: 'Radio Button',
    [FIELD_TYPES.SIGNATURE]: 'Signature',
    [FIELD_TYPES.DATE]: 'Date Field',
    [FIELD_TYPES.INITIALS]: 'Initials',
    [FIELD_TYPES.DROPDOWN]: 'Dropdown'
  }

  return `${typeLabels[detectedType] || 'Field'} ${index + 1}`
}

/**
 * Extract AcroForm fields from a PDF document using PDF.js
 */
export async function extractPDFFormFields(pdfDoc) {
  const fields = []

  try {
    // Iterate through all pages
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum)
      const annotations = await page.getAnnotations()

      // Get viewports at different scales for coordinate conversion
      const baseViewport = page.getViewport({ scale: 1 })
      const scaledViewport = page.getViewport({ scale: BASE_SCALE })

      // Filter for widget annotations (form fields)
      const formAnnotations = annotations.filter(annot =>
        annot.subtype === 'Widget' && annot.rect
      )

      for (const annot of formAnnotations) {
        // Convert PDF coordinates to canvas coordinates
        // PDF rect is [x1, y1, x2, y2] where y increases upward
        const [x1, y1, x2, y2] = annot.rect

        // Scale coordinates to match canvas rendering
        const canvasX = x1 * BASE_SCALE
        const canvasY = scaledViewport.height - (y2 * BASE_SCALE)
        const width = (x2 - x1) * BASE_SCALE
        const height = (y2 - y1) * BASE_SCALE

        const detectedType = detectFieldType(
          annot.fieldName || annot.alternativeText,
          annot.fieldType,
          annot.fieldFlags
        )

        fields.push({
          id: `pdf-field-${pageNum}-${fields.length}`,
          name: annot.fieldName || '',
          label: getFieldLabel(annot.fieldName, detectedType, fields.length),
          type: detectedType,
          page: pageNum,
          x: Math.round(canvasX),
          y: Math.round(canvasY),
          width: Math.round(width),
          height: Math.round(height),
          required: !!(annot.fieldFlags && (annot.fieldFlags & 2)),
          readOnly: !!(annot.fieldFlags && (annot.fieldFlags & 1)),
          value: annot.fieldValue || '',
          options: annot.options || [],
          source: 'acroform'
        })
      }
    }
  } catch (err) {
    console.warn('Error extracting PDF form fields:', err)
  }

  return fields
}

/**
 * Analyze text content to detect potential form field locations
 * This is useful for scanned documents or PDFs without AcroForms
 */
export async function detectFieldsFromContent(pdfDoc) {
  const detectedFields = []

  try {
    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const page = await pdfDoc.getPage(pageNum)
      const textContent = await page.getTextContent()
      const scaledViewport = page.getViewport({ scale: BASE_SCALE })

      let lastY = -1
      let lineText = ''
      let lineItems = []

      // Process text items to find form-related patterns
      for (const item of textContent.items) {
        if (!item.str) continue

        const transform = item.transform
        const x = transform[4] * BASE_SCALE
        const y = scaledViewport.height - (transform[5] * BASE_SCALE)
        const itemWidth = (item.width || 0) * BASE_SCALE
        const itemHeight = (item.height || 10) * BASE_SCALE

        // Check if this is a new line (Y changed significantly)
        if (Math.abs(y - lastY) > 15) {
          // Process previous line
          if (lineText.trim()) {
            const field = analyzeLineForFields(lineText, lineItems, pageNum, detectedFields.length)
            if (field) {
              detectedFields.push(field)
            }
          }

          lineText = item.str
          lineItems = [{ text: item.str, x, y, width: itemWidth, height: itemHeight }]
          lastY = y
        } else {
          lineText += ' ' + item.str
          lineItems.push({ text: item.str, x, y, width: itemWidth, height: itemHeight })
        }
      }

      // Process last line
      if (lineText.trim()) {
        const field = analyzeLineForFields(lineText, lineItems, pageNum, detectedFields.length)
        if (field) {
          detectedFields.push(field)
        }
      }
    }
  } catch (err) {
    console.warn('Error detecting fields from content:', err)
  }

  return detectedFields
}

/**
 * Analyze a line of text for potential form fields
 */
function analyzeLineForFields(lineText, lineItems, pageNum, index) {
  const text = lineText.toLowerCase().trim()

  // Skip very short lines
  if (text.length < 3) return null

  // Get first and last items for positioning
  const firstItem = lineItems[0]
  const lastItem = lineItems[lineItems.length - 1]
  if (!firstItem || !lastItem) return null

  // Look for signature line patterns (e.g., "Signature:", "Sign here", etc.)
  if (SIGNATURE_PATTERNS.some(p => p.test(text))) {
    return {
      id: `detected-field-${pageNum}-${index}`,
      name: '',
      label: extractLabel(lineText, 'Signature'),
      type: FIELD_TYPES.SIGNATURE,
      page: pageNum,
      x: Math.round(lastItem.x + (lastItem.width || 50) + 20),
      y: Math.round(lastItem.y - 10),
      width: 180,
      height: 40,
      required: false,
      source: 'content-analysis'
    }
  }

  // Look for date patterns (strict - only "Date:" style)
  if (DATE_PATTERNS.some(p => p.test(text))) {
    return {
      id: `detected-field-${pageNum}-${index}`,
      name: '',
      label: extractLabel(lineText, 'Date'),
      type: FIELD_TYPES.DATE,
      page: pageNum,
      x: Math.round(lastItem.x + (lastItem.width || 30) + 10),
      y: Math.round(lastItem.y - 5),
      width: 100,
      height: 25,
      required: false,
      source: 'content-analysis'
    }
  }

  // Look for initial patterns
  if (INITIAL_PATTERNS.some(p => p.test(text))) {
    return {
      id: `detected-field-${pageNum}-${index}`,
      name: '',
      label: extractLabel(lineText, 'Initials'),
      type: FIELD_TYPES.INITIALS,
      page: pageNum,
      x: Math.round(lastItem.x + (lastItem.width || 30) + 10),
      y: Math.round(lastItem.y - 5),
      width: 50,
      height: 25,
      required: false,
      source: 'content-analysis'
    }
  }

  // Look for checkbox patterns - only actual checkbox characters at start of line
  if (CHECKBOX_PATTERNS.some(p => p.test(lineText))) {
    return {
      id: `detected-field-${pageNum}-${index}`,
      name: '',
      label: extractLabel(lineText.replace(/^[\s\[\]\(\)□☐]+/, ''), 'Checkbox'),
      type: FIELD_TYPES.CHECKBOX,
      page: pageNum,
      x: Math.round(firstItem.x - 5),
      y: Math.round(firstItem.y),
      width: 18,
      height: 18,
      required: false,
      source: 'content-analysis'
    }
  }

  return null
}

/**
 * Extract a clean label from the line text
 */
function extractLabel(lineText, defaultLabel) {
  // Try to extract a meaningful label
  const colonMatch = lineText.match(/^([^:]+):/)
  if (colonMatch) {
    const label = colonMatch[1].trim()
    if (label.length > 0 && label.length < 50) {
      return label.charAt(0).toUpperCase() + label.slice(1)
    }
  }

  // Look for common patterns
  const patterns = [
    /signature\s*(?:of\s*)?([a-z\s]+)?/i,
    /date\s*(?:of\s*)?([a-z\s]+)?/i,
    /initial(?:s)?\s*(?:of\s*)?([a-z\s]+)?/i
  ]

  for (const pattern of patterns) {
    const match = lineText.match(pattern)
    if (match) {
      const extracted = match[0].trim()
      if (extracted.length > 0 && extracted.length < 50) {
        return extracted.charAt(0).toUpperCase() + extracted.slice(1)
      }
    }
  }

  return defaultLabel
}

/**
 * Main detection function - combines all detection methods
 */
export async function detectFormFields(pdfDoc) {
  if (!pdfDoc) {
    return { acroformFields: [], contentFields: [], allFields: [] }
  }

  // Extract AcroForm fields (interactive PDF forms)
  const acroformFields = await extractPDFFormFields(pdfDoc)

  // Detect fields from content analysis (for scanned docs)
  const contentFields = await detectFieldsFromContent(pdfDoc)

  // Filter out content fields that overlap with AcroForm fields
  const filteredContentFields = contentFields.filter(cf => {
    return !acroformFields.some(af =>
      af.page === cf.page &&
      Math.abs(af.x - cf.x) < 50 &&
      Math.abs(af.y - cf.y) < 30
    )
  })

  // Combine and sort by page and position
  const allFields = [...acroformFields, ...filteredContentFields].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page
    if (Math.abs(a.y - b.y) > 20) return a.y - b.y
    return a.x - b.x
  })

  return {
    acroformFields,
    contentFields: filteredContentFields,
    allFields
  }
}

/**
 * Get statistics about detected fields
 */
export function getFieldStats(fields) {
  const stats = {
    total: fields.length,
    byType: {},
    byPage: {},
    required: 0
  }

  for (const field of fields) {
    // Count by type
    stats.byType[field.type] = (stats.byType[field.type] || 0) + 1

    // Count by page
    stats.byPage[field.page] = (stats.byPage[field.page] || 0) + 1

    // Count required
    if (field.required) stats.required++
  }

  return stats
}

/**
 * Group fields by type for easier processing
 */
export function groupFieldsByType(fields) {
  return fields.reduce((acc, field) => {
    if (!acc[field.type]) {
      acc[field.type] = []
    }
    acc[field.type].push(field)
    return acc
  }, {})
}

/**
 * Group fields by page
 */
export function groupFieldsByPage(fields) {
  return fields.reduce((acc, field) => {
    if (!acc[field.page]) {
      acc[field.page] = []
    }
    acc[field.page].push(field)
    return acc
  }, {})
}
