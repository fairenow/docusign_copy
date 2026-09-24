import { useCallback, useEffect, useRef, useState } from 'react'
import OverlayElement from './OverlayElement'

// CSS pixels per PDF point at 100% zoom
const BASE_SCALE = 1.5
// Pages are drawn when they come within this distance of the visible area
const RENDER_MARGIN = '1200px 0px'

/**
 * Shows every page of a PDF in one scrolling column, with fields on top.
 *
 * currentPage is the page in view: scrolling reports it through onPageChange, and changing
 * it from outside (e.g. page buttons) scrolls to that page.
 * renderField(element, { isSelected, scale, containerSize, onUpdate }) draws a field's content;
 * onActivateElement(element) runs when a field is clicked without being dragged.
 * readOnly: fields can be selected but not moved, resized or deleted.
 * Selection can be controlled with selectedId/onSelectedIdChange; otherwise it is internal.
 */
export default function DocumentViewer({
  pdfDoc,
  pageSizes,
  elements,
  currentPage,
  onPageChange,
  zoom,
  renderField,
  readOnly = false,
  selectedId: controlledSelectedId,
  onSelectedIdChange,
  onUpdateElement,
  onDeleteElement,
  onActivateElement
}) {
  const scrollRef = useRef(null)
  const pageRefs = useRef([])
  const shownPage = useRef(currentPage)
  const [internalSelectedId, setInternalSelectedId] = useState(null)
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId
  const setSelectedId = onSelectedIdChange ?? setInternalSelectedId
  const scale = BASE_SCALE * zoom

  // Scroll to a page chosen outside the viewer (the page the user scrolled to is already shown)
  useEffect(() => {
    if (currentPage === shownPage.current) return
    shownPage.current = currentPage
    pageRefs.current[currentPage - 1]?.scrollIntoView({ block: 'start' })
  }, [currentPage])

  // Report the page in view: the last page whose top is above a third of the viewport
  const frame = useRef(0)
  const handleScroll = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const container = scrollRef.current
      if (!container) return
      const line = container.getBoundingClientRect().top + container.clientHeight / 3
      let page = 1
      pageRefs.current.forEach((el, i) => { if (el && el.getBoundingClientRect().top <= line) page = i + 1 })
      if (page !== shownPage.current) {
        shownPage.current = page
        onPageChange?.(page)
      }
    })
  }, [onPageChange])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

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

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      onPointerDown={() => setSelectedId(null)}
      className="flex-1 overflow-auto bg-gray-100 px-8 pb-8"
    >
      {pageSizes.length > 1 && (
        <div className="sticky top-3 z-20 h-0 flex justify-end pointer-events-none">
          <span className="h-fit rounded-md bg-gray-800/80 px-2.5 py-1 text-xs font-medium text-white" data-testid="page-indicator">
            Page {currentPage} of {pageSizes.length}
          </span>
        </div>
      )}
      {pageSizes.map((size, i) => {
        const pageNumber = i + 1
        const displaySize = { width: size.width * scale, height: size.height * scale }
        return (
          <div
            key={pageNumber}
            ref={el => { pageRefs.current[i] = el }}
            className="relative document-container mx-auto mt-8 bg-white"
            style={displaySize}
            data-testid="document-page"
            data-page={pageNumber}
          >
            <PageCanvas pdfDoc={pdfDoc} pageNumber={pageNumber} scale={scale} size={displaySize} />
            <div className="absolute inset-0">
              {elements.filter(el => el.page === pageNumber).map(element => {
                const isSelected = selectedId === element.id
                const onUpdate = (updates) => onUpdateElement?.(element.id, updates)
                return (
                  <OverlayElement
                    key={element.id}
                    element={element}
                    readOnly={readOnly}
                    containerSize={displaySize}
                    pageSize={size}
                    isSelected={isSelected}
                    onSelect={() => setSelectedId(element.id)}
                    onUpdate={onUpdate}
                    onDelete={() => onDeleteElement?.(element.id)}
                    onActivate={() => onActivateElement?.(element)}
                  >
                    {renderField(element, { isSelected, scale, containerSize: displaySize, onUpdate })}
                  </OverlayElement>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * One page's canvas, drawn once it is near the visible area and again when the zoom
 * changes. A new render cancels the previous one so two renders never overlap.
 */
function PageCanvas({ pdfDoc, pageNumber, scale, size }) {
  const canvasRef = useRef(null)
  const [nearView, setNearView] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || nearView) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) setNearView(true)
    }, { rootMargin: RENDER_MARGIN })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [nearView])

  useEffect(() => {
    if (!pdfDoc || !nearView || !canvasRef.current) return
    let task = null
    let cancelled = false

    ;(async () => {
      const page = await pdfDoc.getPage(pageNumber)
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
  }, [pdfDoc, pageNumber, scale, nearView])

  return <canvas ref={canvasRef} className="block" style={size} />
}
