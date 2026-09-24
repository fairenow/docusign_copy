import { describe, it, expect } from 'vitest'
import { createElement, elementFromDetected, clamp, DEFAULT_SIZES } from './fields'

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
