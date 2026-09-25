import { DEFAULT_FONT_SIZE } from '../lib/fields'

const BORDER_COLORS = {
  signature: 'border-amber-400',
  initials: 'border-purple-500',
  text: 'border-blue-500',
  date: 'border-green-500',
  checkbox: 'border-blue-500',
  prefill: 'border-transparent'
}

// Text starts 2 pt in from the field's left edge, as in the signed PDF (pdfStamp.js)
const TEXT_INSET_PT = 2
const textStyle = (element, scale) => ({
  fontSize: `${(element.fontSize || DEFAULT_FONT_SIZE) * scale}px`,
  paddingLeft: `${TEXT_INSET_PT * scale}px`,
  paddingRight: 0
})

/** A field as filled in on the page (Quick sign): signature image, text input, checkbox. */
export default function FillField({ element, isSelected, scale, containerSize, onUpdate }) {
  const bordered = element.type !== 'checkbox' || isSelected
  return (
    <div className={`w-full h-full ${bordered ? `border border-dashed ${BORDER_COLORS[element.type]}` : 'border-2 border-gray-200'}`}>
      <FillContent element={element} scale={scale} containerSize={containerSize} onUpdate={onUpdate} />
    </div>
  )
}

function FillContent({ element, scale, containerSize, onUpdate }) {
  switch (element.type) {
    case 'signature':
    case 'initials':
      return element.data ? (
        <img src={element.data} alt={element.type} className="w-full h-full object-contain pointer-events-none" draggable={false} />
      ) : (
        <div className="w-full h-full bg-amber-50/90 flex items-center justify-center gap-1 text-amber-700 text-xs font-medium cursor-pointer overflow-hidden whitespace-nowrap">
          {element.type === 'signature' ? '✍️ Click to sign' : 'Initials'}
        </div>
      )

    case 'text':
    case 'date':
      return (
        <input
          type="text"
          value={element.text}
          onChange={(e) => onUpdate({ text: e.target.value })}
          readOnly={element.locked}
          placeholder={element.type === 'text' ? 'Enter text…' : ''}
          className="overlay-text-input pdf-text w-full h-full bg-white/80"
          style={{ ...textStyle(element, scale), color: element.color || '#000' }}
        />
      )

    // Filled in by the sender; printed on white, exactly as in the signed document
    case 'prefill':
      return (
        <div
          className="pdf-text w-full h-full bg-white flex items-center whitespace-nowrap overflow-hidden text-gray-900 cursor-default"
          style={textStyle(element, scale)}
        >
          {element.text}
        </div>
      )

    case 'checkbox': {
      const glyphPx = Math.min(containerSize.width * element.w, containerSize.height * element.h) * 0.85
      return (
        <div className={`w-full h-full bg-white flex items-center justify-center cursor-pointer ${element.checked ? 'bg-blue-50' : ''}`}>
          {element.checked && <span className="text-gray-900 font-bold leading-none" style={{ fontSize: `${glyphPx}px` }}>✓</span>}
        </div>
      )
    }

    default:
      return null
  }
}
