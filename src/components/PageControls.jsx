import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'

// Low enough for a whole page on a phone
const MIN_ZOOM = 0.25
const MAX_ZOOM = 3
const clampZoom = (zoom) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))

export default function PageControls({ currentPage, totalPages, zoom, onPageChange, onZoomChange }) {
  const navButton = 'icon-btn w-8 h-8'
  const zoomButton = 'icon-btn w-8 h-8'

  const goTo = (page) => {
    if (page >= 1 && page <= totalPages) onPageChange(page)
  }

  return (
    <div className="flex items-center gap-4">
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 1} className={navButton} title="Previous page">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-gray-600 whitespace-nowrap tabular-nums px-1">{currentPage} / {totalPages}</span>
          <button onClick={() => goTo(currentPage + 1)} disabled={currentPage >= totalPages} className={navButton} title="Next page">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-1 pl-4 border-l border-gray-200">
        <button onClick={() => onZoomChange(clampZoom(zoom - 0.25))} disabled={zoom <= MIN_ZOOM} className={zoomButton} title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <span className="text-sm text-gray-600 min-w-[45px] text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button onClick={() => onZoomChange(clampZoom(zoom + 0.25))} disabled={zoom >= MAX_ZOOM} className={zoomButton} title="Zoom in">
          <ZoomIn size={14} />
        </button>
      </div>
    </div>
  )
}
