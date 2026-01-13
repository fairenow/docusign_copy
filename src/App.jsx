import { useState, useCallback } from 'react'
import Sidebar from './components/Sidebar'
import DocumentViewer from './components/DocumentViewer'
import Toolbar from './components/Toolbar'
import LoadingOverlay from './components/LoadingOverlay'
import { useDocument } from './hooks/useDocument'

function App() {
  const [elements, setElements] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(false)
  
  const {
    file,
    fileType,
    pdfDoc,
    totalPages,
    docxHtml,
    loadFile,
    renderPage,
    canvasRef,
    detectedFields,
    isDetecting,
    clearDetectedFields,
    redetectFields
  } = useDocument()

  const addElement = useCallback((element) => {
    setElements(prev => [...prev, { ...element, id: Date.now(), page: currentPage }])
  }, [currentPage])

  const updateElement = useCallback((id, updates) => {
    setElements(prev => prev.map(el => 
      el.id === id ? { ...el, ...updates } : el
    ))
  }, [])

  const deleteElement = useCallback((id) => {
    setElements(prev => prev.filter(el => el.id !== id))
  }, [])

  const clearAllElements = useCallback(() => {
    if (window.confirm('Remove all added fields?')) {
      setElements([])
    }
  }, [])

  // Place a detected field as an element
  const placeDetectedField = useCallback((field) => {
    const elementBase = {
      id: Date.now() + Math.random(),
      page: field.page,
      x: field.x,
      y: field.y
    }

    switch (field.type) {
      case 'signature':
        setElements(prev => [...prev, {
          ...elementBase,
          type: 'signature',
          data: null // User will need to add signature
        }])
        break
      case 'text':
        setElements(prev => [...prev, {
          ...elementBase,
          type: 'text',
          text: field.value || '',
          fontSize: 14,
          color: '#000000'
        }])
        break
      case 'date':
        setElements(prev => [...prev, {
          ...elementBase,
          type: 'date',
          text: new Date().toLocaleDateString()
        }])
        break
      case 'initials':
        const initials = prompt('Enter your initials:')
        if (initials) {
          setElements(prev => [...prev, {
            ...elementBase,
            type: 'initials',
            text: initials
          }])
        }
        break
      case 'checkbox':
      case 'radio':
        setElements(prev => [...prev, {
          ...elementBase,
          type: 'checkbox',
          checked: false
        }])
        break
      default:
        // Default to text field
        setElements(prev => [...prev, {
          ...elementBase,
          type: 'text',
          text: '',
          fontSize: 14,
          color: '#000000'
        }])
    }
  }, [])

  // Place all detected fields at once
  const placeAllDetectedFields = useCallback((fields) => {
    const newElements = []
    let initialsPrompted = false
    let initialsText = ''

    for (const field of fields) {
      const elementBase = {
        id: Date.now() + Math.random() + newElements.length,
        page: field.page,
        x: field.x,
        y: field.y
      }

      switch (field.type) {
        case 'signature':
          newElements.push({
            ...elementBase,
            type: 'signature',
            data: null
          })
          break
        case 'text':
          newElements.push({
            ...elementBase,
            type: 'text',
            text: field.value || '',
            fontSize: 14,
            color: '#000000'
          })
          break
        case 'date':
          newElements.push({
            ...elementBase,
            type: 'date',
            text: new Date().toLocaleDateString()
          })
          break
        case 'initials':
          if (!initialsPrompted) {
            initialsText = prompt('Enter your initials:') || ''
            initialsPrompted = true
          }
          if (initialsText) {
            newElements.push({
              ...elementBase,
              type: 'initials',
              text: initialsText
            })
          }
          break
        case 'checkbox':
        case 'radio':
          newElements.push({
            ...elementBase,
            type: 'checkbox',
            checked: false
          })
          break
        default:
          newElements.push({
            ...elementBase,
            type: 'text',
            text: '',
            fontSize: 14,
            color: '#000000'
          })
      }
    }

    setElements(prev => [...prev, ...newElements])
  }, [])

  const handleFileLoad = async (uploadedFile) => {
    setLoading(true)
    try {
      await loadFile(uploadedFile)
      setElements([])
      setCurrentPage(1)
      setZoom(1)
    } catch (err) {
      console.error(err)
      alert('Error loading file: ' + err.message)
    }
    setLoading(false)
  }

  const handlePageChange = async (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage)
      await renderPage(newPage, zoom)
    }
  }

  const handleZoomChange = async (newZoom) => {
    const clampedZoom = Math.max(0.5, Math.min(3, newZoom))
    setZoom(clampedZoom)
    if (fileType === 'pdf') {
      await renderPage(currentPage, clampedZoom)
    }
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        onAddElement={addElement}
        hasDocument={!!file}
        fileType={fileType}
        detectedFields={detectedFields}
        isDetecting={isDetecting}
        onPlaceField={placeDetectedField}
        onPlaceAllFields={placeAllDetectedFields}
        onDismissDetected={clearDetectedFields}
        onRedetect={redetectFields}
      />
      
      <main className="flex-1 flex flex-col overflow-hidden">
        {file && (
          <Toolbar
            fileName={file.name}
            currentPage={currentPage}
            totalPages={totalPages}
            zoom={zoom}
            fileType={fileType}
            onPageChange={handlePageChange}
            onZoomChange={handleZoomChange}
            onClearAll={clearAllElements}
            onDownload={() => {}}
            elements={elements}
            canvasRef={canvasRef}
            docxHtml={docxHtml}
            pdfDoc={pdfDoc}
            setLoading={setLoading}
          />
        )}
        
        <DocumentViewer
          file={file}
          fileType={fileType}
          docxHtml={docxHtml}
          canvasRef={canvasRef}
          elements={elements}
          currentPage={currentPage}
          zoom={zoom}
          onUpdateElement={updateElement}
          onDeleteElement={deleteElement}
          onFileUpload={handleFileLoad}
        />
      </main>

      <LoadingOverlay visible={loading} />
    </div>
  )
}

export default App
