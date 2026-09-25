// Document viewer geometry shared by the viewer and pages that pick its zoom

// CSS pixels per PDF point at 100% zoom
export const BASE_SCALE = 1.5

// Horizontal space the page cannot use: px-2 on phones (overlay scrollbars), px-8 plus a
// scrollbar from the sm breakpoint (640px)
const reserved = (width) => (width < 640 ? 16 : 80)

/**
 * Zoom at which the widest page fits `width` CSS pixels (never above 100%), so a phone
 * shows whole pages instead of scrolling sideways.
 */
export function fitWidthZoom(pageSizes, width) {
  const widest = Math.max(...pageSizes.map(size => size.width))
  if (!(widest > 0) || !(width > 0)) return 1
  return Math.min(1, (width - reserved(width)) / (widest * BASE_SCALE))
}

/**
 * The spot on the document where you are looking: the middle of the visible area (a little
 * above centre, clear of bottom bars and sheets), as { page, x, y } in page fractions. Between
 * two pages it is the nearest point of the nearer page. `view` and `pages` are rectangles
 * ({ left, top, width, height }) in the same coordinates, e.g. from getBoundingClientRect().
 */
export function spotInView(view, pages, { heightRatio = 0.45 } = {}) {
  const cx = view.left + view.width / 2
  const cy = view.top + view.height * heightRatio
  let nearest = null
  pages.forEach((page, i) => {
    if (!page?.width || !page?.height) return
    const distance = cy < page.top ? page.top - cy : Math.max(0, cy - (page.top + page.height))
    if (!nearest || distance < nearest.distance) nearest = { distance, index: i, page }
  })
  if (!nearest) return null
  const { page, index } = nearest
  const fraction = (value) => Math.min(1, Math.max(0, value))
  return { page: index + 1, x: fraction((cx - page.left) / page.width), y: fraction((cy - page.top) / page.height) }
}
