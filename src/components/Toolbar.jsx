import { Trash2, Download } from 'lucide-react'
import PageControls from './PageControls'

export default function Toolbar({ fileName, onClearAll, onDownload, ...pageControls }) {
  return (
    <div className="px-3 sm:px-5 py-2 sm:py-2.5 bg-white border-b border-gray-200/80 flex justify-between items-center gap-2 sm:gap-4">
      <div className="flex items-center gap-4 min-w-0 overflow-x-auto">
        <span className="hidden sm:inline text-gray-900 text-sm font-semibold truncate" title={fileName}>{fileName}</span>
        <PageControls {...pageControls} />
      </div>

      <div className="flex gap-2 flex-shrink-0">
        <button onClick={onClearAll} aria-label="Clear All" title="Clear all fields" className="btn-secondary px-3 sm:px-4 py-2 rounded-lg text-sm flex items-center gap-2">
          <Trash2 size={16} />
          <span className="hidden sm:inline">Clear All</span>
        </button>
        <button onClick={onDownload} aria-label="Download PDF" className="px-3 sm:px-4 py-2 btn-primary rounded-lg text-sm flex items-center gap-2">
          <Download size={16} />
          <span className="hidden sm:inline">Download PDF</span>
          <span className="sm:hidden">PDF</span>
        </button>
      </div>
    </div>
  )
}
