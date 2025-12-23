import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Trash2, Download } from 'lucide-react'
import { generatePDF } from '../utils/pdfGenerator'

export default function Toolbar({
  fileName,
  currentPage,
  totalPages,
  zoom,
  fileType,
  onPageChange,
  onZoomChange,
  onClearAll,
  elements,
  canvasRef,
  docxHtml,
  pdfDoc,
  setLoading
}) {
  const handleDownload = async () => {
    setLoading(true)
    try {
      await generatePDF({
        elements,
        canvasRef,
        docxHtml,
        pdfDoc,
        fileType,
        totalPages,
        zoom,
        fileName
      })
    } catch (err) {
      console.error('Download error:', err)
      alert('Error generating PDF: ' + err.message)
    }
    setLoading(false)
  }

  return (
    <div className="px-5 py-3 bg-dark-800 border-b border-dark-700 flex justify-between items-center">
      <div className="flex items-center gap-4">
        <span className="text-gray-200 text-sm font-medium">{fileName}</span>

        {/* Page Navigation (PDF only) */}
        {fileType === 'pdf' && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage <= 1}
              className="w-8 h-8 bg-dark-700 border border-dark-600 rounded-lg text-gray-200 flex items-center justify-center hover:bg-blue-600 disabled:opacity-50 disabled:hover:bg-dark-700 transition-all"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm text-dark-400">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="w-8 h-8 bg-dark-700 border border-dark-600 rounded-lg text-gray-200 flex items-center justify-center hover:bg-blue-600 disabled:opacity-50 disabled:hover:bg-dark-700 transition-all"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Zoom Controls */}
        <div className="flex items-center gap-2 pl-4 border-l border-dark-600">
          <button
            onClick={() => onZoomChange(zoom - 0.25)}
            className="w-7 h-7 bg-dark-700 border border-dark-600 rounded text-gray-200 flex items-center justify-center hover:bg-dark-600 transition-all"
          >
            <ZoomOut size={14} />
          </button>
          <span className="text-sm text-dark-400 min-w-[45px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => onZoomChange(zoom + 0.25)}
            className="w-7 h-7 bg-dark-700 border border-dark-600 rounded text-gray-200 flex items-center justify-center hover:bg-dark-600 transition-all"
          >
            <ZoomIn size={14} />
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onClearAll}
          className="px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-gray-200 text-sm hover:bg-dark-600 transition-all flex items-center gap-2"
        >
          <Trash2 size={16} />
          Clear All
        </button>
        <button
          onClick={handleDownload}
          className="px-4 py-2 btn-gradient rounded-lg text-white text-sm flex items-center gap-2"
        >
          <Download size={16} />
          Download PDF
        </button>
      </div>
    </div>
  )
}
