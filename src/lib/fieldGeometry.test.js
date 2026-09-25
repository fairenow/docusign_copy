import { describe, it, expect } from 'vitest'
import { alignmentGuides, dragRect, nudgeRect } from './fieldGeometry'

const rect = { x: 0.2, y: 0.3, w: 0.2, h: 0.05 }
const close = (a, b) => Object.keys(b).forEach(k => expect(a[k]).toBeCloseTo(b[k], 10))

describe('moving and resizing', () => {
  it('moves exactly by the drag, and stays on the page', () => {
    close(dragRect(rect, 0.013, -0.007, 'move'), { x: 0.213, y: 0.293, w: 0.2, h: 0.05 })
    close(dragRect(rect, 0.9, -0.9, 'move'), { x: 0.8, y: 0 })
  })

  it('keeps a Shift-drag straight along the axis it moved most', () => {
    close(dragRect(rect, 0.1, 0.02, 'move', { straight: true }), { x: 0.3, y: 0.3 })
    close(dragRect(rect, 0.01, -0.05, 'move', { straight: true }), { x: 0.2, y: 0.25 })
  })

  it('resizes from any corner, keeping the opposite corner where it is', () => {
    close(dragRect(rect, 0.05, 0.01, 'se'), { x: 0.2, y: 0.3, w: 0.25, h: 0.06 })
    close(dragRect(rect, -0.05, -0.01, 'nw'), { x: 0.15, y: 0.29, w: 0.25, h: 0.06 })
    close(dragRect(rect, 0.05, -0.01, 'ne'), { x: 0.2, y: 0.29, w: 0.25, h: 0.06 })
    close(dragRect(rect, -0.05, 0.01, 'sw'), { x: 0.15, y: 0.3, w: 0.25, h: 0.06 })
  })

  it('never makes a field smaller than the minimum or pushes it off the page', () => {
    const min = { w: 0.02, h: 0.01 }
    close(dragRect(rect, 0.5, 0.5, 'nw', { min }), { x: 0.38, y: 0.34, w: 0.02, h: 0.01 })
    close(dragRect(rect, -0.5, -0.5, 'nw', { min }), { x: 0, y: 0, w: 0.4, h: 0.35 })
    close(dragRect(rect, 0.9, 0.9, 'se', { min }), { w: 0.8, h: 0.7 })
  })

  it('nudges with the arrow keys', () => {
    close(nudgeRect(rect, 'ArrowRight', { x: 0.001, y: 0.002 }), { x: 0.201, y: 0.3 })
    close(nudgeRect(rect, 'ArrowUp', { x: 0.001, y: 0.002 }), { x: 0.2, y: 0.298 })
    expect(nudgeRect(rect, 'Enter', { x: 0.001, y: 0.001 })).toBeNull()
  })
})

describe('alignment guides', () => {
  const others = [{ x: 0.5, y: 0.6, w: 0.1, h: 0.04 }]
  const tolerance = { x: 0.002, y: 0.002 }

  it('shows where edges or centres line up, within the tolerance', () => {
    expect(alignmentGuides({ x: 0.501, y: 0.1, w: 0.2, h: 0.05 }, others, tolerance)).toEqual({ vertical: 0.5, horizontal: null })
    // Right edge on the other field's centre; bottoms level
    expect(alignmentGuides({ x: 0.35, y: 0.59, w: 0.2, h: 0.05 }, others, tolerance)).toEqual({ vertical: 0.55, horizontal: 0.64 })
  })

  it('shows nothing when nothing lines up', () => {
    expect(alignmentGuides(rect, others, tolerance)).toEqual({ vertical: null, horizontal: null })
  })
})
