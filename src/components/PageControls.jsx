import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'

const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const clampZoom = (zoom) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))

export default function PageControls({ currentPage, totalPages, zoom, onPageChange, onZoomChange }) {
  const navButton = 'w-8 h-8 bg-dark-700 border border-dark-600 rounded-lg text-gray-200 flex items-center justify-center hover:bg-blue-600 disabled:opacity-50 disabled:hover:bg-dark-700 transition-all'
  const zoomButton = 'w-7 h-7 bg-dark-700 border border-dark-600 rounded text-gray-200 flex items-center justify-center hover:bg-dark-600 disabled:opacity-50 transition-all'

  const goTo = (page) => {
    if (page >= 1 && page <= totalPages) onPageChange(page)
  }

  return (
    <div className="flex items-center gap-4">
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 1} className={navButton} title="Previous page">
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm text-dark-400 whitespace-nowrap">{currentPage} / {totalPages}</span>
          <button onClick={() => goTo(currentPage + 1)} disabled={currentPage >= totalPages} className={navButton} title="Next page">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 pl-4 border-l border-dark-600">
        <button onClick={() => onZoomChange(clampZoom(zoom - 0.25))} disabled={zoom <= MIN_ZOOM} className={zoomButton} title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <span className="text-sm text-dark-400 min-w-[45px] text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => onZoomChange(clampZoom(zoom + 0.25))} disabled={zoom >= MAX_ZOOM} className={zoomButton} title="Zoom in">
          <ZoomIn size={14} />
        </button>
      </div>
    </div>
  )
}
