import { useRef, useState, useEffect } from 'react'
import { Upload } from 'lucide-react'
import OverlayElement from './OverlayElement'

// CSS pixels per PDF point at 100% zoom
const BASE_SCALE = 1.5

export default function DocumentViewer({
  file,
  pdfDoc,
  pageSizes,
  elements,
  currentPage,
  zoom,
  onUpdateElement,
  onDeleteElement,
  onSignElement,
  onFileUpload
}) {
  const fileInputRef = useRef(null)
  const canvasRef = useRef(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  const pageSize = pageSizes[currentPage - 1]
  const scale = BASE_SCALE * zoom
  const displaySize = pageSize && { width: pageSize.width * scale, height: pageSize.height * scale }

  // Render the current page. A new render cancels the previous one so fast
  // page/zoom changes never draw two pages onto the same canvas.
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    let task = null
    let cancelled = false

    ;(async () => {
      const page = await pdfDoc.getPage(currentPage)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1
      const canvas = canvasRef.current
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      task = page.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
      })
      await task.promise
    })().catch(err => {
      if (err?.name !== 'RenderingCancelledException') console.error('Render error:', err)
    })

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [pdfDoc, currentPage, scale])

  // Delete / Backspace removes the selected field (unless typing in it)
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!selectedId) return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onDeleteElement(selectedId)
        setSelectedId(null)
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [selectedId, onDeleteElement])

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files.length) onFileUpload(e.dataTransfer.files[0])
  }

  const handleFileSelect = (e) => {
    if (e.target.files.length) onFileUpload(e.target.files[0])
    e.target.value = ''
  }

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center bg-dark-700 p-8">
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all max-w-md w-full ${
            isDragOver ? 'border-blue-500 bg-blue-500/10' : 'border-dark-600 hover:border-blue-500 hover:bg-blue-500/5'
          }`}
        >
          <div className="w-16 h-16 mx-auto mb-4 bg-dark-600 rounded-full flex items-center justify-center">
            <Upload size={32} className="text-dark-400" />
          </div>
          <h3 className="text-xl text-gray-200 mb-2">Upload Document</h3>
          <p className="text-dark-400 mb-4">Drop your file here or click to browse</p>
          <p className="text-sm text-dark-500">PDF or DOCX, up to 50 MB</p>
        </div>
        <input ref={fileInputRef} type="file" accept=".pdf,.docx" onChange={handleFileSelect} className="hidden" />
      </div>
    )
  }

  const pageElements = elements.filter(el => el.page === currentPage)

  return (
    <div className="flex-1 overflow-auto bg-dark-700 p-8" onPointerDown={() => setSelectedId(null)}>
      {displaySize && (
        <div
          className="relative document-container mx-auto"
          style={{ width: displaySize.width, height: displaySize.height }}
        >
          <canvas
            ref={canvasRef}
            className="block"
            style={{ width: displaySize.width, height: displaySize.height }}
          />

          <div className="absolute inset-0">
            {pageElements.map(element => (
              <OverlayElement
                key={element.id}
                element={element}
                scale={scale}
                containerSize={displaySize}
                pageSize={pageSize}
                isSelected={selectedId === element.id}
                onSelect={() => setSelectedId(element.id)}
                onUpdate={(updates) => onUpdateElement(element.id, updates)}
                onDelete={() => onDeleteElement(element.id)}
                onSign={() => onSignElement(element)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
