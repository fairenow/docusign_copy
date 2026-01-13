import { useRef, useCallback } from 'react'
import { Upload } from 'lucide-react'
import OverlayElement from './OverlayElement'

export default function DocumentViewer({
  file,
  fileType,
  docxHtml,
  canvasRef,
  elements,
  currentPage,
  zoom,
  onUpdateElement,
  onDeleteElement,
  onFileUpload,
  onSignatureClick
}) {
  const fileInputRef = useRef(null)
  const dropZoneRef = useRef(null)

  const handleDragOver = (e) => {
    e.preventDefault()
    e.currentTarget.classList.add('border-blue-500', 'bg-blue-500/10')
  }

  const handleDragLeave = (e) => {
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-500/10')
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.currentTarget.classList.remove('border-blue-500', 'bg-blue-500/10')
    
    if (e.dataTransfer.files.length) {
      onFileUpload(e.dataTransfer.files[0])
    }
  }

  const handleFileSelect = (e) => {
    if (e.target.files.length) {
      onFileUpload(e.target.files[0])
    }
  }

  const handleElementUpdate = useCallback((id, updates) => {
    onUpdateElement(id, updates)
  }, [onUpdateElement])

  // Filter elements for current page
  const pageElements = elements.filter(el => el.page === currentPage)

  // Empty state
  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center bg-dark-700 p-8">
        <div
          ref={dropZoneRef}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className="border-2 border-dashed border-dark-600 rounded-2xl p-12 text-center cursor-pointer transition-all hover:border-blue-500 hover:bg-blue-500/5 max-w-md w-full"
        >
          <div className="w-16 h-16 mx-auto mb-4 bg-dark-600 rounded-full flex items-center justify-center">
            <Upload size={32} className="text-dark-400" />
          </div>
          <h3 className="text-xl text-gray-200 mb-2">Upload Document</h3>
          <p className="text-dark-400 mb-4">
            Drop your file here or click to browse
          </p>
          <p className="text-sm text-dark-500">
            Supports PDF and DOCX files
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-dark-700 p-8 flex justify-center">
      <div className="relative document-container">
        {/* PDF Canvas */}
        {fileType === 'pdf' && (
          <canvas ref={canvasRef} className="block" />
        )}

        {/* DOCX Content */}
        {fileType === 'docx' && (
          <div
            className="docx-content"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
            dangerouslySetInnerHTML={{ __html: docxHtml }}
          />
        )}

        {/* Overlay Elements */}
        <div className="absolute inset-0 pointer-events-none">
          {pageElements.map(element => (
            <OverlayElement
              key={element.id}
              element={element}
              onUpdate={(updates) => handleElementUpdate(element.id, updates)}
              onDelete={() => onDeleteElement(element.id)}
              onSignatureClick={onSignatureClick}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
