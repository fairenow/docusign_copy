import { useRef, useState } from 'react'
import { X, GripVertical } from 'lucide-react'
import { MIN_SIZE } from '../lib/fields'
import { RESIZE_HANDLES, alignmentGuides, dragRect } from '../lib/fieldGeometry'

// Movement (in px) below which a press counts as a click, not a drag. Fingers wobble more.
const CLICK_TOLERANCE = { mouse: 3, pen: 5, touch: 10 }
// How close (in screen px) edges must be for an alignment guide to show
const GUIDE_TOLERANCE_PX = 1.5

const HANDLE_POSITION = {
  nw: '-top-1.5 -left-1.5 pointer-coarse:-top-4 pointer-coarse:-left-4',
  ne: '-top-1.5 -right-1.5 pointer-coarse:-top-4 pointer-coarse:-right-4',
  sw: '-bottom-1.5 -left-1.5 pointer-coarse:-bottom-4 pointer-coarse:-left-4',
  se: '-bottom-1.5 -right-1.5 pointer-coarse:-bottom-5 pointer-coarse:-right-5'
}

/**
 * Frame around one field on the page: selection, move, resize and (when onDelete is given) delete.
 * What the field looks like is up to `children`; what a click does is up to `onActivate`.
 *
 * While dragging, the frame follows the pointer one-to-one on its own and reports the result
 * once (onUpdate) when the pointer is released, so a drag stays smooth however large the page
 * is. `constrain(rect)` can limit where it may go (e.g. a signer's small adjustments);
 * `neighbors` are the other fields on the page, for alignment guides.
 */
export default function OverlayElement({
  element,
  readOnly = false,
  containerSize,
  pageSize,
  neighbors = [],
  constrain,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onActivate,
  onGestureEnd, // (kind, event) after a field was moved or resized
  children
}) {
  const gesture = useRef(null)
  // The rectangle while a move or resize is in progress
  const [live, setLive] = useState(null)
  const rect = live ?? element

  // Start a move or resize ('move' | 'nw' | 'ne' | 'sw' | 'se')
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
      tolerance: CLICK_TOLERANCE[e.pointerType] ?? CLICK_TOLERANCE.mouse,
      moved: false
    }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  const handlePointerMove = (e) => {
    const g = gesture.current
    if (!g || g.kind === 'click') return
    const dxPx = e.clientX - g.startX
    const dyPx = e.clientY - g.startY
    if (!g.moved && Math.hypot(dxPx, dyPx) < g.tolerance) return
    g.moved = true
    const next = dragRect(g.orig, dxPx / containerSize.width, dyPx / containerSize.height, g.kind, {
      min: { w: MIN_SIZE / pageSize.width, h: MIN_SIZE / pageSize.height },
      straight: e.shiftKey
    })
    setLive(constrain ? constrain(next) : next)
  }

  const handlePointerUp = (e) => {
    const g = gesture.current
    gesture.current = null
    // A press that did not drag is a click (resize handles excepted)
    if (g && !g.moved && (g.kind === 'click' || g.kind === 'move')) onActivate?.()
    if (g?.moved && live) {
      onUpdate({ x: live.x, y: live.y, w: live.w, h: live.h })
      onGestureEnd?.(g.kind === 'move' ? 'move' : 'resize', e)
    }
    setLive(null)
  }

  const guides = live
    ? alignmentGuides(live, neighbors, { x: GUIDE_TOLERANCE_PX / containerSize.width, y: GUIDE_TOLERANCE_PX / containerSize.height })
    : null
  const handleVisibility = isSelected || live ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'

  return (
    <>
      <div
        className={`overlay-element group touch-none ${isSelected ? 'selected' : ''} ${readOnly ? 'cursor-default' : ''} ${live ? 'dragging' : ''}`}
        data-testid="field"
        data-field-id={element.id}
        data-field-type={element.type}
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`
        }}
        onPointerDown={(e) => beginGesture(e, 'move')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { gesture.current = null; setLive(null) }}
      >
        {children}

        {!readOnly && (
          <>
            {/* Move grip (needed for text inputs, handy for everything) */}
            <div
              className={`absolute -top-2.5 -left-6 w-4 h-5 pointer-coarse:-left-8 pointer-coarse:w-6 pointer-coarse:h-7 bg-blue-600 rounded flex items-center justify-center text-white cursor-move touch-none ${handleVisibility}`}
              onPointerDown={(e) => beginGesture(e, 'move')}
              title="Drag to move (hold Shift to keep it straight)"
            >
              <GripVertical size={12} />
            </div>

            {onDelete && <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className={`absolute -top-3 right-3 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-white transition-opacity ${handleVisibility}`}
              title="Remove field"
            >
              <X size={12} />
            </button>}

            {Object.entries(RESIZE_HANDLES).map(([handle, { cursor }]) => (
              <div
                key={handle}
                className={`absolute ${HANDLE_POSITION[handle]} w-3 h-3 pointer-coarse:w-5 pointer-coarse:h-5 pointer-coarse:rounded-full bg-white border-2 border-blue-600 rounded-sm touch-none ${handle === 'se' ? '' : 'pointer-coarse:hidden'} ${handleVisibility}`}
                style={{ cursor }}
                onPointerDown={(e) => beginGesture(e, handle)}
                title="Drag to resize"
                data-handle={handle}
              />
            ))}
          </>
        )}
      </div>

      {/* Lines where the field being dragged lines up with another field (shown, never pulled to) */}
      {guides?.vertical != null && (
        <div className="absolute top-0 bottom-0 w-px bg-pink-500 pointer-events-none z-20" style={{ left: `${guides.vertical * 100}%` }} data-testid="guide-vertical" />
      )}
      {guides?.horizontal != null && (
        <div className="absolute left-0 right-0 h-px bg-pink-500 pointer-events-none z-20" style={{ top: `${guides.horizontal * 100}%` }} data-testid="guide-horizontal" />
      )}
    </>
  )
}
