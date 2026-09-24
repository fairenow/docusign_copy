import { useRef, useState, useEffect } from 'react'
import OverlayElement from './OverlayElement'

// CSS pixels per PDF point at 100% zoom
const BASE_SCALE = 1.5

/**
 * Renders one PDF page with its fields on top.
 *
 * mode 'fill'    - fields are filled in place (Quick sign)
 * mode 'prepare' - fields are placeholders assigned to recipients (envelope editor)
 * readOnly       - fields can be viewed but not moved, edited or deleted
 *
 * Selection can be controlled with selectedId/onSelectedIdChange; otherwise it is internal.
 */
export default function DocumentViewer({
  pdfDoc,
  pageSizes,
  elements,
  currentPage,
  zoom,
  mode = 'fill',
  readOnly = false,
  getAppearance,
  selectedId: controlledSelectedId,
  onSelectedIdChange,
  onUpdateElement,
  onDeleteElement,
  onSignElement
}) {
  const canvasRef = useRef(null)
  const [internalSelectedId, setInternalSelectedId] = useState(null)
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId
  const setSelectedId = onSelectedIdChange ?? setInternalSelectedId

  const pageSize = pageSizes[currentPage - 1]
  const scale = BASE_SCALE * zoom
  const displaySize = pageSize && { width: pageSize.width * scale, height: pageSize.height * scale }

  // Render the current page. A new render cancels the previous one so fast
  // page/zoom changes never draw two pages onto the same canvas.
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    let task = null
    let cancelled = false

    ;(async () => {
      const page = await pdfDoc.getPage(currentPage)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1
      const canvas = canvasRef.current
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      task = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      })
      await task.promise
    })().catch(err => {
      if (err?.name !== 'RenderingCancelledException') console.error('Render error:', err)
    })

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdfDoc, currentPage, scale])

  // Delete / Backspace removes the selected field (unless typing somewhere)
  useEffect(() => {
    if (readOnly) return
    const onKeyDown = (e) => {
      if (!selectedId) return
      const tag = document.activeElement?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || document.activeElement?.isContentEditable) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onDeleteElement(selectedId)
        setSelectedId(null)
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [readOnly, selectedId, setSelectedId, onDeleteElement])

  const pageElements = elements.filter(el => el.page === currentPage)

  return (
    <div className="flex-1 overflow-auto bg-dark-700 p-8" onPointerDown={() => setSelectedId(null)}>
      {displaySize && (
        <div
          className="relative document-container mx-auto"
          style={{ width: displaySize.width, height: displaySize.height }}
          data-testid="document-page"
        >
          <canvas
            ref={canvasRef}
            className="block"
            style={{ width: displaySize.width, height: displaySize.height }}
          />

          <div className="absolute inset-0">
            {pageElements.map(element => (
              <OverlayElement
                key={element.id}
                element={element}
                mode={mode}
                readOnly={readOnly}
                appearance={getAppearance?.(element)}
                scale={scale}
                containerSize={displaySize}
                pageSize={pageSize}
                isSelected={selectedId === element.id}
                onSelect={() => setSelectedId(element.id)}
                onUpdate={(updates) => onUpdateElement?.(element.id, updates)}
                onDelete={() => onDeleteElement?.(element.id)}
                onSign={() => onSignElement?.(element)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
