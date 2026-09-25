import { useCallback, useEffect, useRef, useState } from 'react'
import OverlayElement from './OverlayElement'
import { PageSkeletons } from './Skeleton'
import { BASE_SCALE } from '../lib/viewer'
// Pages are drawn when they come within this distance of the visible area
const RENDER_MARGIN = '1200px 0px'

/**
 * Shows every page of a PDF in one scrolling column, with fields on top.
 *
 * currentPage is the page in view: scrolling reports it through onPageChange, and changing
 * it from outside (e.g. page buttons) scrolls to that page.
 * renderField(element, { isSelected, scale, containerSize, onUpdate }) draws a field's content;
 * onActivateElement(element) runs when a field is clicked without being dragged, and
 * onElementGestureEnd(element, kind, event) when a move ('move') or resize ('resize') ends.
 * readOnly (or element.fixed for one field): fields can be selected but not moved, resized or
 * deleted. Without onDeleteElement, fields can be moved and resized but not deleted (e.g. a
 * signer adjusting their own fields).
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
  onActivateElement,
  onElementGestureEnd, // (element, kind, event) after a field was moved or resized
  // Placing a new field: { rectAt(pageNumber, x, y) -> rect, render(rect), onPlace(pageNumber, rect) }.
  // The field follows the pointer as a preview and a click puts it there.
  placing = null,
  // Pages to sketch while the document is still loading (e.g. the envelope's page count)
  placeholderPages = 1
}) {
  const scrollRef = useRef(null)
  const pageRefs = useRef([])
  const shownPage = useRef(currentPage)
  const [internalSelectedId, setInternalSelectedId] = useState(null)
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId
  const setSelectedId = onSelectedIdChange ?? setInternalSelectedId
  const scale = BASE_SCALE * zoom
  // Where the field being placed would go: { page, rect } under the pointer
  const [preview, setPreview] = useState(null)
  useEffect(() => { if (!placing) setPreview(null) }, [placing])

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
    if (readOnly || !onDeleteElement) return
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
      className="flex-1 overflow-auto bg-gray-100 px-2 sm:px-8 pb-4 sm:pb-8"
    >
      {pageSizes.length > 1 && (
        <div className="sticky top-3 z-20 h-0 flex justify-end pointer-events-none">
          <span className="h-fit rounded-md bg-gray-800/80 px-2.5 py-1 text-xs font-medium text-white" data-testid="page-indicator">
            Page {currentPage} of {pageSizes.length}
          </span>
        </div>
      )}
      {!pageSizes.length && <PageSkeletons count={placeholderPages} width={612 * scale} height={792 * scale} />}
      {pageSizes.map((size, i) => {
        const pageNumber = i + 1
        const displaySize = { width: size.width * scale, height: size.height * scale }
        return (
          <div
            key={pageNumber}
            ref={el => { pageRefs.current[i] = el }}
            className="relative document-container mx-auto mt-3 sm:mt-8 bg-white"
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
                    readOnly={readOnly || element.fixed}
                    containerSize={displaySize}
                    pageSize={size}
                    isSelected={isSelected}
                    onSelect={() => setSelectedId(element.id)}
                    onUpdate={onUpdate}
                    onDelete={onDeleteElement && (() => onDeleteElement(element.id))}
                    onActivate={() => onActivateElement?.(element)}
                    onGestureEnd={(kind, e) => onElementGestureEnd?.(element, kind, e)}
                  >
                    {renderField(element, { isSelected, scale, containerSize: displaySize, onUpdate })}
                  </OverlayElement>
                )
              })}
            </div>
            {placing && (
              <PlacementLayer
                pageNumber={pageNumber}
                placing={placing}
                preview={preview?.page === pageNumber ? preview.rect : null}
                onPreview={setPreview}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Above a page while a field is being placed: the preview follows the pointer and a click
 * places the field (on top of fields already there, so they do not catch the click).
 */
function PlacementLayer({ pageNumber, placing, preview, onPreview }) {
  const rectAt = (e) => {
    const box = e.currentTarget.getBoundingClientRect()
    return placing.rectAt(pageNumber, (e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height)
  }
  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair"
      data-testid="placement-layer"
      onPointerMove={(e) => onPreview({ page: pageNumber, rect: rectAt(e) })}
      onPointerLeave={() => onPreview(null)}
      onPointerDown={(e) => {
        e.stopPropagation()
        if (e.button !== undefined && e.button !== 0) return
        placing.onPlace(pageNumber, rectAt(e))
      }}
    >
      {preview && (
        <div
          className="absolute pointer-events-none opacity-80"
          style={{ left: `${preview.x * 100}%`, top: `${preview.y * 100}%`, width: `${preview.w * 100}%`, height: `${preview.h * 100}%` }}
          data-testid="placement-preview"
        >
          {placing.render(preview)}
        </div>
      )}
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
