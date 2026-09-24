import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'

// Low enough for a whole page on a phone
const MIN_ZOOM = 0.25
const MAX_ZOOM = 3
const clampZoom = (zoom) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))

export default function PageControls({ currentPage, totalPages, zoom, onPageChange, onZoomChange }) {
  const navButton = 'w-8 h-8 bg-gray-50 border border-gray-300 rounded-lg text-gray-800 flex items-center justify-center hover:bg-blue-600 disabled:opacity-50 disabled:hover:bg-white transition-all'
  const zoomButton = 'w-7 h-7 bg-gray-50 border border-gray-300 rounded text-gray-800 flex items-center justify-center hover:bg-gray-200 disabled:opacity-50 transition-all'

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
          <span className="text-sm text-gray-500 whitespace-nowrap">{currentPage} / {totalPages}</span>
          <button onClick={() => goTo(currentPage + 1)} disabled={currentPage >= totalPages} className={navButton} title="Next page">
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 pl-4 border-l border-gray-300">
        <button onClick={() => onZoomChange(clampZoom(zoom - 0.25))} disabled={zoom <= MIN_ZOOM} className={zoomButton} title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <span className="text-sm text-gray-500 min-w-[45px] text-center">{Math.round(zoom * 100)}%</span>
        <button onClick={() => onZoomChange(clampZoom(zoom + 0.25))} disabled={zoom >= MAX_ZOOM} className={zoomButton} title="Zoom in">
          <ZoomIn size={14} />
        </button>
      </div>
    </div>
  )
}
