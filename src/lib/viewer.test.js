import { describe, it, expect } from 'vitest'
import { spotInView } from './viewer'

// A 390 × 700 visible area and pages 600 px tall with 20 px gaps, as on a phone
const view = { left: 0, top: 100, width: 390, height: 700 }
const pagesFrom = (firstTop) => Array.from({ length: 3 }, (_, i) => ({ left: 10, top: firstTop + i * 620, width: 370, height: 600 }))

describe('spotInView', () => {
  it('is the middle of what is on screen, on the page shown there', () => {
    // Scrolled so page 2 spans the screen: the spot is 45% down the view, on page 2
    const spot = spotInView(view, pagesFrom(-500))
    expect(spot.page).toBe(2)
    expect(spot.x).toBeCloseTo(0.5)
    expect(spot.y).toBeCloseTo((100 + 700 * 0.45 - 120) / 600)
  })

  it('at the bottom of a page, is near the bottom of that page', () => {
    const spot = spotInView(view, pagesFrom(-165)) // page 1 ends at 435, just past the spot
    expect(spot.page).toBe(1)
    expect(spot.y).toBeGreaterThan(0.95)
  })

  it('between two pages, picks the nearer page edge', () => {
    // The spot (y = 415) falls in the gap between page 1 (ends 410) and page 2 (starts 430)
    const spot = spotInView(view, pagesFrom(-190))
    expect(spot).toMatchObject({ page: 1, y: 1 })
  })

  it('without pages there is no spot', () => {
    expect(spotInView(view, [])).toBeNull()
  })
})
