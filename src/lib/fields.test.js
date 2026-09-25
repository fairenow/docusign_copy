import { describe, it, expect } from 'vitest'
import { createElement, elementFromDetected, clamp, placementRect, rectInView, DEFAULT_SIZES } from './fields'

const letter = { width: 612, height: 792 }

describe('createElement', () => {
  it('sizes fields in page fractions from point defaults', () => {
    const el = createElement('text', { page: 2, pageSize: letter })
    expect(el.page).toBe(2)
    expect(el.w).toBeCloseTo(DEFAULT_SIZES.text.width / 612)
    expect(el.h).toBeCloseTo(DEFAULT_SIZES.text.height / 792)
    expect(el.x).toBeCloseTo(0.5 - el.w / 2)
  })

  it('keeps fields inside the page', () => {
    const el = createElement('checkbox', { page: 1, pageSize: letter }, { x: 0.999, y: -1 })
    expect(el.x).toBeLessThanOrEqual(1 - el.w)
    expect(el.y).toBe(0)
  })

  it('uses the image aspect ratio for signatures', () => {
    const el = createElement('signature', { page: 1, pageSize: letter }, { aspect: 3, data: 'data:x' })
    expect(el.w * 612 / (el.h * 792)).toBeCloseTo(3)
  })

  it('never makes a field larger than the page', () => {
    const el = createElement('signature', { page: 1, pageSize: { width: 100, height: 20 } })
    expect(el.w).toBe(1)
    expect(el.h).toBe(1)
    expect([el.x, el.y]).toEqual([0, 0])
  })

  it('rejects unknown types', () => {
    expect(() => createElement('stamp', { page: 1, pageSize: letter })).toThrow('Unknown field type')
  })
})

describe('elementFromDetected', () => {
  it('converts AcroForm pixel rects measured at scale 1.5', () => {
    const el = elementFromDetected(
      { type: 'text', source: 'acroform', page: 1, x: 108, y: 264, width: 300, height: 30, pageWidth: 918, pageHeight: 1188, value: 'Jane' },
      letter
    )
    expect(el.x).toBeCloseTo(108 / 918)
    expect(el.w).toBeCloseTo(300 / 918)
    expect(el.text).toBe('Jane')
  })

  it('maps radio to checkbox and unknown types to text', () => {
    const base = { source: 'content-analysis', page: 1, x: 100, y: 500, pageWidth: 918, pageHeight: 1188 }
    expect(elementFromDetected({ ...base, type: 'radio' }, letter).type).toBe('checkbox')
    expect(elementFromDetected({ ...base, type: 'weird' }, letter).type).toBe('text')
  })
})

describe('clamp', () => {
  it('clamps and tolerates max < min', () => {
    expect(clamp(5, 0, 1)).toBe(1)
    expect(clamp(-1, 0, 1)).toBe(0)
    expect(clamp(0.5, 0, -1)).toBe(0)
  })
})

describe('placementRect', () => {
  it('puts the bottom-left corner at the pointer, exactly (nothing snaps)', () => {
    const r = placementRect('text', letter, 0.2, 0.5)
    expect(r.x).toBeCloseTo(0.2)
    expect(r.y + r.h).toBeCloseTo(0.5)
    expect(r.w).toBeCloseTo(DEFAULT_SIZES.text.width / letter.width)
  })

  it('centres a checkbox on the pointer and keeps every field on the page', () => {
    const box = placementRect('checkbox', letter, 0.5, 0.5)
    expect(box.x + box.w / 2).toBeCloseTo(0.5)
    expect(box.y + box.h / 2).toBeCloseTo(0.5)
    const corner = placementRect('text', letter, 0.99, 0.01)
    expect(corner.x + corner.w).toBeCloseTo(1)
    expect(corner.y).toBe(0)
  })

  it('sizes a signature image to its aspect ratio, as it will be placed', () => {
    const r = placementRect('signature', letter, 0.1, 0.5, { aspect: 2 })
    const placed = createElement('signature', { page: 1, pageSize: letter }, { aspect: 2, ...r })
    expect(r.w * letter.width).toBeCloseTo(DEFAULT_SIZES.signature.height * 2)
    expect([placed.x, placed.y, placed.w, placed.h]).toEqual([r.x, r.y, r.w, r.h])
  })
})

describe('rectInView', () => {
  it('centres the field on the spot where you are looking', () => {
    const r = rectInView('date', letter, { page: 24, x: 0.3, y: 0.9 })
    expect(r.x + r.w / 2).toBeCloseTo(0.3)
    expect(r.y + r.h / 2).toBeCloseTo(0.9)
  })

  it('stays on the page at its edges', () => {
    const r = rectInView('signature', letter, { page: 1, x: 1, y: 1 })
    expect(r.x + r.w).toBeCloseTo(1)
    expect(r.y + r.h).toBeCloseTo(1)
  })

  it('moves clear of fields already there, so several in a row do not stack', () => {
    const first = rectInView('date', letter, { page: 1, x: 0.5, y: 0.5 })
    const second = rectInView('date', letter, { page: 1, x: 0.5, y: 0.5 }, [first])
    const third = rectInView('date', letter, { page: 1, x: 0.5, y: 0.5 }, [first, second])
    const overlap = (a, b) => a.y < b.y + b.h && b.y < a.y + a.h
    expect(overlap(first, second)).toBe(false)
    expect(overlap(first, third) || overlap(second, third)).toBe(false)
    // and stays close by
    expect(Math.abs(second.y - first.y)).toBeLessThan(0.1)
  })
})
