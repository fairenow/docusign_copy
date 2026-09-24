import { useRef } from 'react'
import { X, GripVertical } from 'lucide-react'
import { clamp, MIN_SIZE } from '../lib/fields'

// Movement (in px) below which a pointer press counts as a click, not a drag
const CLICK_TOLERANCE = 3

/**
 * Frame around one field on the page: selection, move, resize and (when onDelete is given) delete.
 * What the field looks like is up to `children`; what a click does is up to `onActivate`.
 */
export default function OverlayElement({
  element,
  readOnly = false,
  containerSize,
  pageSize,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onActivate,
  children
}) {
  const gesture = useRef(null)

  // Start a move or resize. Pixel deltas are converted to page fractions as the pointer moves.
  const beginGesture = (e, kind) => {
    if (e.button !== undefined && e.button !== 0) return
    e.stopPropagation()
    onSelect()
    if (readOnly) {
      // Not movable, but a click still activates the field (e.g. a signer filling it in)
      gesture.current = { kind: 'click', moved: false }
      return
    }
    // Let inputs receive focus/caret placement; they are moved via the grip instead
    if (kind === 'move' && e.target.tagName === 'INPUT') return
    e.preventDefault()

    gesture.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      orig: { x: element.x, y: element.y, w: element.w, h: element.h },
      moved: false
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e) => {
    const g = gesture.current
    if (!g || g.kind === 'click') return
    const dxPx = e.clientX - g.startX
    const dyPx = e.clientY - g.startY
    if (!g.moved && Math.hypot(dxPx, dyPx) < CLICK_TOLERANCE) return
    g.moved = true

    const dx = dxPx / containerSize.width
    const dy = dyPx / containerSize.height

    if (g.kind === 'move') {
      onUpdate({
        x: clamp(g.orig.x + dx, 0, 1 - g.orig.w),
        y: clamp(g.orig.y + dy, 0, 1 - g.orig.h)
      })
    } else {
      onUpdate({
        w: clamp(g.orig.w + dx, MIN_SIZE / pageSize.width, 1 - g.orig.x),
        h: clamp(g.orig.h + dy, MIN_SIZE / pageSize.height, 1 - g.orig.y)
      })
    }
  }

  const handlePointerUp = () => {
    const g = gesture.current
    gesture.current = null
    if (g && !g.moved && g.kind !== 'resize') onActivate?.()
  }

  const handleVisibility = isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'

  return (
    <div
      className={`overlay-element group touch-none ${isSelected ? 'selected' : ''} ${readOnly ? 'cursor-default' : ''}`}
      data-testid="field"
      data-field-id={element.id}
      data-field-type={element.type}
      style={{
        left: `${element.x * 100}%`,
        top: `${element.y * 100}%`,
        width: `${element.w * 100}%`,
        height: `${element.h * 100}%`
      }}
      onPointerDown={(e) => beginGesture(e, 'move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => { gesture.current = null }}
    >
      {children}

      {!readOnly && (
        <>
          {/* Move grip (needed for text inputs, handy for everything) */}
          <div
            className={`absolute -top-2.5 -left-5 w-4 h-5 bg-blue-600 rounded flex items-center justify-center text-white cursor-move touch-none ${handleVisibility}`}
            onPointerDown={(e) => beginGesture(e, 'move')}
            title="Drag to move"
          >
            <GripVertical size={12} />
          </div>

          {onDelete && <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className={`absolute -top-2.5 -right-2.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white transition-opacity ${handleVisibility}`}
            title="Remove field"
          >
            <X size={12} />
          </button>}

          <div
            className={`absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-blue-600 rounded-sm cursor-nwse-resize touch-none ${handleVisibility}`}
            onPointerDown={(e) => beginGesture(e, 'resize')}
            title="Drag to resize"
          />
        </>
      )}
    </div>
  )
}
