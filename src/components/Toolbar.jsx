import { Trash2, Download } from 'lucide-react'
import PageControls from './PageControls'

export default function Toolbar({ fileName, onClearAll, onDownload, ...pageControls }) {
  return (
    <div className="px-5 py-3 bg-white border-b border-gray-200 flex justify-between items-center gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <span className="text-gray-800 text-sm font-medium truncate" title={fileName}>{fileName}</span>
        <PageControls {...pageControls} />
      </div>

      <div className="flex gap-2 flex-shrink-0">
        <button onClick={onClearAll} className="px-4 py-2 bg-gray-50 border border-gray-300 rounded-lg text-gray-800 text-sm hover:bg-gray-200 transition-all flex items-center gap-2">
          <Trash2 size={16} />
          Clear All
        </button>
        <button onClick={onDownload} className="px-4 py-2 btn-primary rounded-lg text-white text-sm flex items-center gap-2">
          <Download size={16} />
          Download PDF
        </button>
      </div>
    </div>
  )
}
