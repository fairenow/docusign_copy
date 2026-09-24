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
      className={`border-2 border-dashed rounded-2xl p-12 text-center transition-all max-w-md w-full cursor-pointer ${
        isDragOver ? 'border-blue-500 bg-blue-500/10' : 'border-gray-300 hover:border-blue-500 hover:bg-blue-500/5'
      }`}
    >
      <div className="w-16 h-16 mx-auto mb-4 bg-gray-200 rounded-full flex items-center justify-center">
        <Upload size={32} className="text-gray-500" />
      </div>
      <h3 className="text-xl text-gray-800 mb-2">Upload Document</h3>
      <p className="text-gray-500 mb-4">Drop your file here or click to browse</p>
      <p className="text-sm text-gray-500">PDF or Word document (.docx, .doc, .odt, .rtf)</p>
      <input ref={inputRef} type="file" accept={ACCEPTED_FILE_TYPES} onChange={handleSelect} className="hidden" data-testid="file-input" />
    </div>
  )
}
