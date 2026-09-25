import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { ACCEPTED_FILE_TYPES } from '../lib/documents'

export default function FileDropzone({ onFile }) {
  const inputRef = useRef(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files.length) onFile(e.dataTransfer.files[0])
  }

  const handleSelect = (e) => {
    if (e.target.files.length) onFile(e.target.files[0])
    e.target.value = ''
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`group bg-white border-2 border-dashed rounded-2xl px-6 py-10 sm:p-12 text-center transition-all max-w-md w-full cursor-pointer shadow-card ${
        isDragOver ? 'border-blue-500 bg-blue-50/60' : 'border-gray-200 hover:border-blue-400 hover:bg-blue-50/30'
      }`}
    >
      <div className="w-14 h-14 mx-auto mb-5 bg-gray-900 rounded-2xl flex items-center justify-center shadow-button transition-transform group-hover:-translate-y-0.5">
        <Upload size={24} className="text-white" />
      </div>
      <h3 className="page-title text-3xl mb-2">Upload a document</h3>
      <p className="text-gray-600 mb-4">Drop your file here, or <span className="font-medium text-blue-700">browse</span></p>
      <p className="text-xs text-gray-400">PDF or Word document (.docx, .doc, .odt, .rtf)</p>
      <input ref={inputRef} type="file" accept={ACCEPTED_FILE_TYPES} onChange={handleSelect} className="hidden" data-testid="file-input" />
    </div>
  )
}
