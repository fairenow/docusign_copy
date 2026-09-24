/**
 * Read what a page looks like from its PDF content: words with their positions and
 * horizontal lines (drawn lines, thin filled rectangles such as underlined tabs, and runs
 * of underscores). Used to snap fields onto lines and to suggest fields.
 *
 * Everything is in "display points": the page as shown (after /Rotate), origin top-left,
 * y growing downwards. Words: { text, x1, x2, baseline, size }. Lines: { x1, x2, y }.
 */

// Shortest line worth snapping to or suggesting a field on, and the thickest "line"
const MIN_LINE_LENGTH = 36
const MAX_LINE_THICKNESS = 2.5

export async function readPageLayout(page) {
  const { OPS, Util } = await import('pdfjs-dist')
  const viewport = page.getViewport({ scale: 1 })
  const [text, operators] = await Promise.all([page.getTextContent(), page.getOperatorList()])

  const words = []
  const segments = []

  for (const item of text.items) {
    if (!item.str?.trim() || !item.transform) continue
    const m = Util.transform(viewport.transform, item.transform)
    // Horizontal text only (as displayed)
    if (Math.abs(m[1]) > 0.01 || Math.abs(m[2]) > 0.01) continue
    const size = Math.abs(m[3]) || Math.hypot(item.transform[2], item.transform[3])
    const x = m[4]
    const baseline = m[5]
    const width = item.width * viewport.scale
    const length = item.str.length
    const at = (i) => x + (width * i) / length

    // Runs of underscores are lines; everything else is words (positions by character share)
    for (const match of item.str.matchAll(/_{3,}|[^\s_]+(?:_{1,2}[^\s_]+)*/g)) {
      const x1 = at(match.index)
      const x2 = at(match.index + match[0].length)
      if (match[0].startsWith('___')) segments.push({ x1, x2, y: baseline + size * 0.1 })
      else words.push({ text: match[0], x1, x2, baseline, size })
    }
  }

  segments.push(...drawnSegments(operators, OPS, Util, viewport.transform))
  return { width: viewport.width, height: viewport.height, words, lines: mergeSegments(segments) }
}

/** Horizontal strokes and thin filled rectangles from the page's drawing operators. */
function drawnSegments({ fnArray, argsArray }, OPS, Util, base) {
  const found = []
  const stack = []
  let ctm = [1, 0, 0, 1, 0, 0]
  let pending = []
  const toDisplay = (x, y) => Util.applyTransform(Util.applyTransform([x, y], ctm), base)

  const addRect = (x, y, w, h) => {
    const corners = [toDisplay(x, y), toDisplay(x + w, y + h)]
    const [x1, x2] = [corners[0][0], corners[1][0]].sort((a, b) => a - b)
    const [y1, y2] = [corners[0][1], corners[1][1]].sort((a, b) => a - b)
    if (y2 - y1 <= MAX_LINE_THICKNESS && x2 - x1 >= MIN_LINE_LENGTH) pending.push({ x1, x2, y: (y1 + y2) / 2 })
  }

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    const args = argsArray[i]
    switch (fn) {
      case OPS.save:
        stack.push(ctm)
        break
      case OPS.restore:
        ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
        break
      case OPS.transform:
        ctm = Util.transform(ctm, args)
        break
      case OPS.paintFormXObjectBegin:
        stack.push(ctm)
        if (args?.[0]) ctm = Util.transform(ctm, args[0])
        break
      case OPS.paintFormXObjectEnd:
        ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]
        break
      case OPS.constructPath: {
        const [ops, coords] = args
        let c = 0
        let last = null
        for (const op of ops) {
          if (op === OPS.rectangle) {
            addRect(coords[c], coords[c + 1], coords[c + 2], coords[c + 3])
            c += 4
          } else if (op === OPS.moveTo || op === OPS.lineTo) {
            const point = toDisplay(coords[c], coords[c + 1])
            if (op === OPS.lineTo && last && Math.abs(point[1] - last[1]) < 0.5) {
              pending.push({ x1: Math.min(point[0], last[0]), x2: Math.max(point[0], last[0]), y: point[1] })
            }
            last = point
            c += 2
          } else if (op === OPS.curveTo) {
            c += 6
          } else if (op === OPS.curveTo2 || op === OPS.curveTo3) {
            c += 4
          }
        }
        break
      }
      // A path only counts once it is painted; clipping paths are discarded
      case OPS.stroke:
      case OPS.closeStroke:
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        found.push(...pending)
        pending = []
        break
      case OPS.endPath:
        pending = []
        break
    }
  }
  return found.filter(s => s.x2 - s.x1 >= MIN_LINE_LENGTH)
}

/** Join pieces of the same line (e.g. several underlined tabs) and drop duplicates. */
export function mergeSegments(segments) {
  const sorted = [...segments].sort((a, b) => a.y - b.y || a.x1 - b.x1)
  const lines = []
  for (const s of sorted) {
    const same = lines.find(l => Math.abs(l.y - s.y) <= 1.5 && s.x1 <= l.x2 + 2 && s.x2 >= l.x1 - 2)
    if (same) {
      same.x1 = Math.min(same.x1, s.x1)
      same.x2 = Math.max(same.x2, s.x2)
    } else {
      lines.push({ ...s })
    }
  }
  return lines.filter(l => l.x2 - l.x1 >= MIN_LINE_LENGTH)
}
