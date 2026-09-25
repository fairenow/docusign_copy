/**
 * Moving and resizing a field precisely. Rectangles are { x, y, w, h } as fractions of the
 * page; deltas are fractions too. Nothing here snaps: a field goes exactly where it is put.
 */

import { clamp } from './fields'

/** Corner handles for resizing; each moves the edges it touches. */
export const RESIZE_HANDLES = {
  nw: { left: true, top: true, cursor: 'nwse-resize' },
  ne: { right: true, top: true, cursor: 'nesw-resize' },
  sw: { left: true, bottom: true, cursor: 'nesw-resize' },
  se: { right: true, bottom: true, cursor: 'nwse-resize' }
}

/**
 * The rectangle after dragging by (dx, dy): a move ('move'), or a resize from a corner
 * ('nw' | 'ne' | 'sw' | 'se'). It stays on the page and no smaller than min { w, h }.
 * With `straight`, a move keeps to the axis it has moved along most (Shift while dragging).
 */
export function dragRect(orig, dx, dy, handle, { min = { w: 0, h: 0 }, straight = false } = {}) {
  if (handle === 'move') {
    if (straight) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = 0
      else dx = 0
    }
    return { ...orig, x: clamp(orig.x + dx, 0, 1 - orig.w), y: clamp(orig.y + dy, 0, 1 - orig.h) }
  }
  const edges = RESIZE_HANDLES[handle]
  let { x, y, w, h } = orig
  if (edges.left) {
    x = clamp(orig.x + dx, 0, orig.x + orig.w - min.w)
    w = orig.x + orig.w - x
  }
  if (edges.right) w = clamp(orig.w + dx, min.w, 1 - orig.x)
  if (edges.top) {
    y = clamp(orig.y + dy, 0, orig.y + orig.h - min.h)
    h = orig.y + orig.h - y
  }
  if (edges.bottom) h = clamp(orig.h + dy, min.h, 1 - orig.y)
  return { ...orig, x, y, w, h }
}

/** Arrow keys move a field by `step` (a fraction of the page in each direction). */
export function nudgeRect(rect, key, step) {
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  const move = moves[key]
  if (!move) return null
  return dragRect(rect, move[0] * step.x, move[1] * step.y, 'move')
}

const edgesOf = (start, size) => [start, start + size / 2, start + size]

/**
 * Where `rect` lines up with another field (left/centre/right, top/middle/bottom), within
 * `tolerance` (fractions: { x, y }). Returns the positions to draw guide lines at, or null.
 */
export function alignmentGuides(rect, others, tolerance) {
  const find = (mine, theirs, tol) => {
    for (const a of mine) for (const b of theirs) if (Math.abs(a - b) <= tol) return b
    return null
  }
  let vertical = null
  let horizontal = null
  for (const other of others) {
    vertical ??= find(edgesOf(rect.x, rect.w), edgesOf(other.x, other.w), tolerance.x)
    horizontal ??= find(edgesOf(rect.y, rect.h), edgesOf(other.y, other.h), tolerance.y)
    if (vertical !== null && horizontal !== null) break
  }
  return { vertical, horizontal }
}
