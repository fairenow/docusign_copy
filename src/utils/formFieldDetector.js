/**
 * Form Field Detector Utility
 * Detects interactive form fields (AcroForms) and visual patterns in PDF documents
 */

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
  /signed/i,
  /^sign$/i,
  /signatory/i,
  /autograph/i
]

const DATE_PATTERNS = [
  /date/i,
  /dated/i,
  /day of/i,
  /mm\/dd/i,
  /dd\/mm/i,
  /yyyy/i
]

const INITIAL_PATTERNS = [
  /initial/i,
  /initials/i,
  /^init$/i
]

const CHECKBOX_PATTERNS = [
  /agree/i,
  /accept/i,
  /confirm/i,
  /acknowledge/i,
  /consent/i,
  /check/i,
  /select/i,
  /yes\/no/i
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
      const viewport = page.getViewport({ scale: 1.5 })

      // Filter for widget annotations (form fields)
      const formAnnotations = annotations.filter(annot =>
        annot.subtype === 'Widget' && annot.rect
      )

      for (const annot of formAnnotations) {
        // Convert PDF coordinates to canvas coordinates
        const [x1, y1, x2, y2] = annot.rect

        // PDF coordinates start from bottom-left, convert to top-left
        const canvasX = x1 * (viewport.width / page.getViewport({ scale: 1 }).width)
        const canvasY = viewport.height - (y2 * (viewport.height / page.getViewport({ scale: 1 }).height))
        const width = (x2 - x1) * (viewport.width / page.getViewport({ scale: 1 }).width)
        const height = (y2 - y1) * (viewport.height / page.getViewport({ scale: 1 }).height)

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
      const viewport = page.getViewport({ scale: 1.5 })

      let lastY = -1
      let lineText = ''
      let lineItems = []

      // Process text items to find form-related patterns
      for (const item of textContent.items) {
        if (!item.str) continue

        const transform = item.transform
        const x = transform[4] * 1.5
        const y = viewport.height - (transform[5] * 1.5)

        // Check if this is a new line
        if (Math.abs(y - lastY) > 10) {
          // Process previous line
          if (lineText.trim()) {
            const field = analyzeLineForFields(lineText, lineItems, pageNum, detectedFields.length)
            if (field) {
              detectedFields.push(field)
            }
          }

          lineText = item.str
          lineItems = [{ text: item.str, x, y, width: item.width * 1.5, height: item.height * 1.5 }]
          lastY = y
        } else {
          lineText += ' ' + item.str
          lineItems.push({ text: item.str, x, y, width: item.width * 1.5, height: item.height * 1.5 })
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
  const text = lineText.toLowerCase()

  // Look for signature line patterns
  if (SIGNATURE_PATTERNS.some(p => p.test(text))) {
    const lastItem = lineItems[lineItems.length - 1]
    return {
      id: `detected-field-${pageNum}-${index}`,
      name: '',
      label: extractLabel(lineText, 'Signature'),
      type: FIELD_TYPES.SIGNATURE,
      page: pageNum,
      x: Math.round(lastItem.x + lastItem.width + 20),
      y: Math.round(lastItem.y - 5),
      width: 200,
      height: 50,
      required: false,
      source: 'content-analysis'
    }
  }

  // Look for date patterns
  if (DATE_PATTERNS.some(p => p.test(text))) {
    const lastItem = lineItems[lineItems.length - 1]
    return {
      id: `detected-field-${pageNum}-${index}`,
      name: '',
      label: extractLabel(lineText, 'Date'),
      type: FIELD_TYPES.DATE,
      page: pageNum,
      x: Math.round(lastItem.x + lastItem.width + 10),
      y: Math.round(lastItem.y - 2),
      width: 120,
      height: 25,
      required: false,
      source: 'content-analysis'
    }
  }

  // Look for initial patterns
  if (INITIAL_PATTERNS.some(p => p.test(text))) {
    const lastItem = lineItems[lineItems.length - 1]
    return {
      id: `detected-field-${pageNum}-${index}`,
      name: '',
      label: extractLabel(lineText, 'Initials'),
      type: FIELD_TYPES.INITIALS,
      page: pageNum,
      x: Math.round(lastItem.x + lastItem.width + 10),
      y: Math.round(lastItem.y - 2),
      width: 60,
      height: 30,
      required: false,
      source: 'content-analysis'
    }
  }

  // Look for checkbox patterns with empty boxes or brackets
  if (CHECKBOX_PATTERNS.some(p => p.test(text)) ||
      /\[\s*\]|\(\s*\)|□|☐/.test(lineText)) {
    const firstItem = lineItems[0]
    return {
      id: `detected-field-${pageNum}-${index}`,
      name: '',
      label: extractLabel(lineText, 'Checkbox'),
      type: FIELD_TYPES.CHECKBOX,
      page: pageNum,
      x: Math.round(firstItem.x - 25),
      y: Math.round(firstItem.y),
      width: 20,
      height: 20,
      required: false,
      source: 'content-analysis'
    }
  }

  // Look for underline patterns that indicate text fields
  // Common patterns: _________, ____________, Name: _______
  if (/_{3,}/.test(lineText) || /:\s*$/.test(lineText.trim())) {
    const colonMatch = lineText.match(/^([^:]+):\s*/)
    if (colonMatch) {
      const lastItem = lineItems[lineItems.length - 1]
      return {
        id: `detected-field-${pageNum}-${index}`,
        name: '',
        label: colonMatch[1].trim() || 'Text Field',
        type: FIELD_TYPES.TEXT,
        page: pageNum,
        x: Math.round(lastItem.x + lastItem.width + 10),
        y: Math.round(lastItem.y - 2),
        width: 150,
        height: 25,
        required: false,
        source: 'content-analysis'
      }
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
