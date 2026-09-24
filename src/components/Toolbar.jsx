import { Trash2, Download } from 'lucide-react'
import PageControls from './PageControls'

export default function Toolbar({ fileName, onClearAll, onDownload, ...pageControls }) {
  return (
    <div className="px-5 py-3 bg-dark-800 border-b border-dark-700 flex justify-between items-center gap-4">
      <div className="flex items-center gap-4 min-w-0">
        <span className="text-gray-200 text-sm font-medium truncate" title={fileName}>{fileName}</span>
        <PageControls {...pageControls} />
      </div>

      <div className="flex gap-2 flex-shrink-0">
        <button onClick={onClearAll} className="px-4 py-2 bg-dark-700 border border-dark-600 rounded-lg text-gray-200 text-sm hover:bg-dark-600 transition-all flex items-center gap-2">
          <Trash2 size={16} />
          Clear All
        </button>
        <button onClick={onDownload} className="px-4 py-2 btn-gradient rounded-lg text-white text-sm flex items-center gap-2">
          <Download size={16} />
          Download PDF
        </button>
      </div>
    </div>
  )
}
