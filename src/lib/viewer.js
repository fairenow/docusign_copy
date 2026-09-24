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
