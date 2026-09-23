import { useRef } from 'react'
import { X, GripVertical } from 'lucide-react'
import { clamp, MIN_SIZE } from '../lib/fields'

// Movement (in px) below which a pointer press counts as a click, not a drag
const CLICK_TOLERANCE = 3

const BORDER_COLORS = {
  signature: 'border-amber-400',
  initials: 'border-purple-500',
  text: 'border-blue-500',
  date: 'border-green-500',
  checkbox: 'border-blue-500'
}

export default function OverlayElement({
  element,
  scale,
  containerSize,
  pageSize,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onSign
}) {
  const gesture = useRef(null)

  // Start a move or resize gesture. Coordinates are converted from pixels to page fractions.
  const beginGesture = (e, mode) => {
    if (e.button !== undefined && e.button !== 0) return
    e.stopPropagation()
    onSelect()
    // Let inputs receive focus/caret placement; they are moved via the grip instead
    if (mode === 'move' && e.target.tagName === 'INPUT') return
    e.preventDefault()

    gesture.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: element.x, y: element.y, w: element.w, h: element.h },
      moved: false
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e) => {
    const g = gesture.current
    if (!g) return
    const dxPx = e.clientX - g.startX
    const dyPx = e.clientY - g.startY
    if (!g.moved && Math.hypot(dxPx, dyPx) < CLICK_TOLERANCE) return
    g.moved = true

    const dx = dxPx / containerSize.width
    const dy = dyPx / containerSize.height

    if (g.mode === 'move') {
      onUpdate({
        x: clamp(g.orig.x + dx, 0, 1 - g.orig.w),
        y: clamp(g.orig.y + dy, 0, 1 - g.orig.h)
      })
    } else {
      const minW = MIN_SIZE / pageSize.width
      const minH = MIN_SIZE / pageSize.height
      onUpdate({
        w: clamp(g.orig.w + dx, minW, 1 - g.orig.x),
        h: clamp(g.orig.h + dy, minH, 1 - g.orig.y)
      })
    }
  }

  const handlePointerUp = () => {
    const g = gesture.current
    gesture.current = null
    if (!g || g.moved || g.mode !== 'move') return
    // A click without movement
    if (element.type === 'checkbox') onUpdate({ checked: !element.checked })
    if ((element.type === 'signature' || element.type === 'initials') && !element.data) onSign()
  }

  const gestureHandlers = {
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerUp,
    onPointerCancel: () => { gesture.current = null }
  }

  const fontPx = (element.fontSize || 12) * scale

  const renderContent = () => {
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
            placeholder={element.type === 'text' ? 'Enter text…' : ''}
            className="overlay-text-input w-full h-full bg-white/80 px-0.5"
            style={{ fontSize: `${fontPx}px`, color: element.color || '#000' }}
          />
        )

      case 'checkbox':
        return (
          <div className={`w-full h-full bg-white flex items-center justify-center cursor-pointer ${element.checked ? 'bg-blue-50' : ''}`}>
            {element.checked && (
              <span className="text-gray-900 font-bold leading-none" style={{ fontSize: `${Math.min(containerSize.width * element.w, containerSize.height * element.h) * 0.85}px` }}>✓</span>
            )}
          </div>
        )

      default:
        return null
    }
  }

  const showBorder = element.type !== 'checkbox' || isSelected
  return (
    <div
      className={`overlay-element group touch-none ${isSelected ? 'selected' : ''}`}
      style={{
        left: `${element.x * 100}%`,
        top: `${element.y * 100}%`,
        width: `${element.w * 100}%`,
        height: `${element.h * 100}%`
      }}
      onPointerDown={(e) => beginGesture(e, 'move')}
      {...gestureHandlers}
    >
      <div className={`w-full h-full ${showBorder ? `border border-dashed ${BORDER_COLORS[element.type]}` : 'border-2 border-gray-800'}`}>
        {renderContent()}
      </div>

      {/* Move grip (needed for text inputs, handy for everything) */}
      <div
        className={`absolute -top-2.5 -left-5 w-4 h-5 bg-blue-600 rounded flex items-center justify-center text-white cursor-move touch-none ${
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        onPointerDown={(e) => beginGesture(e, 'move')}
        title="Drag to move"
      >
        <GripVertical size={12} />
      </div>

      {/* Delete */}
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className={`absolute -top-2.5 -right-2.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white transition-opacity ${
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        title="Remove field"
      >
        <X size={12} />
      </button>

      {/* Resize */}
      <div
        className={`absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-blue-600 rounded-sm cursor-nwse-resize touch-none ${
          isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
        onPointerDown={(e) => beginGesture(e, 'resize')}
        title="Drag to resize"
      />
    </div>
  )
}
