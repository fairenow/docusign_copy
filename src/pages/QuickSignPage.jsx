import { useState, useCallback, useEffect } from 'react'
import Sidebar from '../components/Sidebar'
import DocumentViewer from '../components/DocumentViewer'
import FileDropzone from '../components/FileDropzone'
import Toolbar from '../components/Toolbar'
import LoadingOverlay from '../components/LoadingOverlay'
import { useDocument } from '../hooks/useDocument'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { createElement, elementFromDetected } from '../lib/fields'
import { renderTypedSignature } from '../lib/signatureImage'

/**
 * Single-user signing: open a document, fill and sign it, download the result.
 * Everything stays in the browser.
 */
export default function QuickSignPage() {
  const [elements, setElements] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(false)
  const [activePanel, setActivePanel] = useState(null)
  // Signature/initials created in this session, reused for "Click to sign" placeholders
  const [savedSignature, setSavedSignature] = useState(null)
  const [savedInitials, setSavedInitials] = useState(null)
  // Placeholder waiting for the user to create a signature in the sidebar
  const [pendingSignId, setPendingSignId] = useState(null)

  const {
    file,
    pdfBytes,
    pdfDoc,
    pageSizes,
    totalPages,
    sourceType,
    error: documentError,
    loadFile,
    detectedFields,
    isDetecting,
    clearDetectedFields,
    redetectFields
  } = useDocument()

  useUnsavedChangesWarning(elements.length > 0)

  useEffect(() => {
    if (documentError) alert('Error opening document: ' + documentError.message)
  }, [documentError])

  const addElement = useCallback((type, props = {}) => {
    const pageSize = pageSizes[currentPage - 1]
    if (!pageSize) return
    setElements(prev => {
      // Stagger new fields so they don't stack exactly on top of each other
      const onPage = prev.filter(el => el.page === currentPage).length
      const y = props.y ?? 0.2 + (onPage % 10) * 0.05
      return [...prev, createElement(type, { page: currentPage, pageSize }, { ...props, y })]
    })
  }, [currentPage, pageSizes])

  const updateElement = useCallback((id, updates) => {
    setElements(prev => prev.map(el => (el.id === id ? { ...el, ...updates } : el)))
  }, [])

  const deleteElement = useCallback((id) => {
    setElements(prev => prev.filter(el => el.id !== id))
  }, [])

  const clearAllElements = useCallback(() => {
    if (window.confirm('Remove all added fields?')) setElements([])
  }, [])

  const getInitials = useCallback(async () => {
    if (savedInitials) return savedInitials
    const text = window.prompt('Enter your initials:')?.trim()
    if (!text) return null
    const image = await renderTypedSignature(text)
    const initials = { ...image, text }
    setSavedInitials(initials)
    return initials
  }, [savedInitials])

  const handleSignatureCreated = useCallback((signature) => {
    setSavedSignature(signature)
    if (pendingSignId) {
      updateElement(pendingSignId, { data: signature.data })
      setPendingSignId(null)
    } else {
      addElement('signature', { data: signature.data, aspect: signature.aspect })
    }
    setActivePanel(null)
  }, [pendingSignId, addElement, updateElement])

  // Fill an empty signature/initials placeholder
  const handleSignElement = useCallback(async (element) => {
    if (element.type === 'initials') {
      const initials = await getInitials()
      if (initials) updateElement(element.id, { data: initials.data, text: initials.text })
      return
    }
    if (savedSignature) {
      updateElement(element.id, { data: savedSignature.data })
    } else {
      setPendingSignId(element.id)
      setActivePanel('signature')
    }
  }, [getInitials, savedSignature, updateElement])

  const handleAddInitials = useCallback(async () => {
    const initials = await getInitials()
    if (initials) addElement('initials', { data: initials.data, text: initials.text, aspect: initials.aspect })
  }, [getInitials, addElement])

  const placeDetectedFields = useCallback((fields) => {
    const placed = fields
      .filter(field => pageSizes[field.page - 1])
      .map(field => elementFromDetected(field, pageSizes[field.page - 1], { initials: savedInitials }))
    setElements(prev => [...prev, ...placed])
  }, [pageSizes, savedInitials])

  const handleFileLoad = async (uploadedFile) => {
    if (elements.length && !window.confirm('Loading a new document will discard the fields you placed. Continue?')) {
      return
    }
    setLoading(true)
    try {
      await loadFile(uploadedFile)
      setElements([])
      setCurrentPage(1)
      setZoom(1)
      setPendingSignId(null)
    } catch (err) {
      console.error(err)
      alert('Error loading file: ' + err.message)
    }
    setLoading(false)
  }

  const handleDownload = async () => {
    const { findIncompleteElements, buildSignedPdf, downloadPdf } = await import('../lib/exportPdf')
    const incomplete = findIncompleteElements(elements)
    if (incomplete.length) {
      setCurrentPage(incomplete[0].page)
      alert(`${incomplete.length} signature/initials field${incomplete.length > 1 ? 's are' : ' is'} still empty. Click the highlighted field to sign, or remove it.`)
      return
    }

    setLoading(true)
    try {
      const bytes = await buildSignedPdf(pdfBytes, elements)
      downloadPdf(bytes, file.name)
    } catch (err) {
      console.error('Download error:', err)
      alert('Error generating PDF: ' + err.message)
    }
    setLoading(false)
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        hasDocument={!!file}
        fileType={sourceType}
        activePanel={activePanel}
        onActivePanelChange={(panel) => {
          setActivePanel(panel)
          if (panel !== 'signature') setPendingSignId(null)
        }}
        onAddSignature={handleSignatureCreated}
        onAddText={(options) => addElement('text', options)}
        onAddDate={() => addElement('date')}
        onAddInitials={handleAddInitials}
        onAddCheckbox={() => addElement('checkbox')}
        detectedFields={detectedFields}
        isDetecting={isDetecting}
        onPlaceField={(field) => placeDetectedFields([field])}
        onPlaceAllFields={placeDetectedFields}
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
            onPageChange={setCurrentPage}
            onZoomChange={setZoom}
            onClearAll={clearAllElements}
            onDownload={handleDownload}
          />
        )}

        {!file ? (
          <div className="flex-1 flex items-center justify-center bg-dark-700 p-8">
            <FileDropzone onFile={handleFileLoad} />
          </div>
        ) : (
        <DocumentViewer
          pdfDoc={pdfDoc}
          pageSizes={pageSizes}
          elements={elements}
          currentPage={currentPage}
          zoom={zoom}
          onUpdateElement={updateElement}
          onDeleteElement={deleteElement}
          onSignElement={handleSignElement}
        />
        )}
      </main>

      <LoadingOverlay visible={loading} />
    </div>
  )
}

