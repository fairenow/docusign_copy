import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Brand from '../components/Brand'
import DocumentViewer from '../components/DocumentViewer'
import FillField from '../components/FillField'
import FileDropzone from '../components/FileDropzone'
import Toolbar from '../components/Toolbar'
import LoadingOverlay from '../components/LoadingOverlay'
import Modal from '../components/Modal'
import SignaturePanel from '../components/SignaturePanel'
import { useDocument } from '../hooks/useDocument'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { createElement, elementFromDetected, nextFieldY } from '../lib/fields'
import { renderTypedSignature, signatureFromImage } from '../lib/signatureImage'
import { useAuth } from '../auth/useAuth'
import { useSavedSignatures } from '../hooks/useSavedSignatures'
import { fitWidthZoom } from '../lib/viewer'
import { preloadPdfViewer } from '../lib/documents'

/**
 * Single-user signing: open a document, fill and sign it, download the result.
 * Everything stays in the browser.
 */
export default function QuickSignPage() {
  const [elements, setElements] = useState([])
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  // Phones show the document or the field tools, one at a time
  const [mobileView, setMobileView] = useState('document') // 'document' | 'tools'
  const [loading, setLoading] = useState(false)
  const [activePanel, setActivePanel] = useState(null)
  // Signature/initials created in this session, reused for "Click to sign" placeholders
  const [savedSignature, setSavedSignature] = useState(null)
  const [savedInitials, setSavedInitials] = useState(null)
  // Signature placeholder being signed in the pop-up (opens over the page, where you are)
  const [signingFieldId, setSigningFieldId] = useState(null)

  // Ready by the time a file is picked
  useEffect(preloadPdfViewer, [])

  // Signed-in team members start with their newest saved signature and initials
  const { user } = useAuth()
  const { saved } = useSavedSignatures(Boolean(user))
  useEffect(() => {
    let cancelled = false
    const newest = (kind) => saved.find(s => s.kind === kind)
    ;(async () => {
      const [signature, initials] = await Promise.all(['signature', 'initials'].map(kind => newest(kind) && signatureFromImage(newest(kind).image)))
      if (cancelled) return
      if (signature) setSavedSignature(current => current ?? signature)
      if (initials) setSavedInitials(current => current ?? { ...initials, text: '' })
    })().catch(err => console.error('Could not load saved signatures:', err))
    return () => { cancelled = true }
  }, [saved])

  const {
    file,
    pdfBytes,
    pdfDoc,
    pageSizes,
    error: documentError,
    loadFile,
    detectedFields,
    isDetecting,
    clearDetectedFields,
    redetectFields
  } = useDocument()

  // Phones and narrow windows: fit each newly opened document to the screen
  useEffect(() => {
    if (pageSizes.length && window.innerWidth < 768) setZoom(fitWidthZoom(pageSizes, window.innerWidth))
  }, [pageSizes])

  useUnsavedChangesWarning(elements.length > 0)

  useEffect(() => {
    if (documentError) alert('Error opening document: ' + documentError.message)
  }, [documentError])

  const addElement = useCallback((type, props = {}) => {
    const pageSize = pageSizes[currentPage - 1]
    if (!pageSize) return
    setElements(prev => [
      ...prev,
      createElement(type, { page: currentPage, pageSize }, { y: nextFieldY(prev, currentPage), ...props })
    ])
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

  // From the sidebar: a new signature field on the current page
  const handleSignatureCreated = useCallback((signature) => {
    setSavedSignature(signature)
    addElement('signature', { data: signature.data, aspect: signature.aspect })
    setActivePanel(null)
  }, [addElement])

  // From the pop-up: fill the placeholder that was clicked
  const handlePlaceholderSigned = (signature) => {
    setSavedSignature(signature)
    updateElement(signingFieldId, { data: signature.data })
    setSigningFieldId(null)
  }

  // A click on a field: toggle checkboxes, sign empty signature/initials placeholders
  const handleActivateElement = useCallback(async (element) => {
    if (element.type === 'checkbox') {
      updateElement(element.id, { checked: !element.checked })
      return
    }
    if ((element.type !== 'signature' && element.type !== 'initials') || element.data) return
    if (element.type === 'initials') {
      const initials = await getInitials()
      if (initials) updateElement(element.id, { data: initials.data, text: initials.text })
      return
    }
    if (savedSignature) updateElement(element.id, { data: savedSignature.data })
    else setSigningFieldId(element.id)
  }, [getInitials, savedSignature, updateElement])

  const renderField = useCallback((element, ctx) => <FillField element={element} {...ctx} />, [])

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

  // Adding a field on a phone goes back to the document, where the field is
  const thenShowDocument = (action) => (...args) => {
    action(...args)
    setMobileView('document')
  }

  return (
    <div className="flex flex-col md:flex-row h-screen">
      <Sidebar
        className={mobileView === 'tools' ? 'flex' : 'hidden md:flex'}
        hasDocument={!!file}
        activePanel={activePanel}
        onActivePanelChange={setActivePanel}
        onAddSignature={thenShowDocument(handleSignatureCreated)}
        onAddText={thenShowDocument((options) => addElement('text', options))}
        onAddDate={thenShowDocument(() => addElement('date'))}
        onAddInitials={thenShowDocument(handleAddInitials)}
        onAddCheckbox={thenShowDocument(() => addElement('checkbox'))}
        detectedFields={detectedFields}
        isDetecting={isDetecting}
        onPlaceField={thenShowDocument((field) => placeDetectedFields([field]))}
        onPlaceAllFields={thenShowDocument(placeDetectedFields)}
        onDismissDetected={clearDetectedFields}
        onRedetect={redetectFields}
      />

      <main className={`flex-1 flex-col overflow-hidden min-h-0 ${mobileView === 'document' ? 'flex' : 'hidden md:flex'}`}>
        {file && (
          <Toolbar
            fileName={file.name}
            currentPage={currentPage}
            totalPages={pageSizes.length}
            zoom={zoom}
            onPageChange={setCurrentPage}
            onZoomChange={setZoom}
            onClearAll={clearAllElements}
            onDownload={handleDownload}
          />
        )}

        {!file && (
          <div className="md:hidden px-4 h-14 flex items-center justify-between bg-white border-b border-gray-200 flex-shrink-0">
            <Brand />
            <Link to="/" className="text-sm text-gray-600">← Envelopes</Link>
          </div>
        )}
        {!file ? (
          <div className="flex-1 flex items-center justify-center bg-gray-50 p-4 sm:p-8">
            <FileDropzone onFile={handleFileLoad} />
          </div>
        ) : (
        <DocumentViewer
          pdfDoc={pdfDoc}
          pageSizes={pageSizes}
          elements={elements}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          zoom={zoom}
          onUpdateElement={updateElement}
          onDeleteElement={deleteElement}
          renderField={renderField}
          onActivateElement={handleActivateElement}
        />
        )}
      </main>

      {/* Phones: switch between the document and the field tools */}
      {file && (
        <nav className="md:hidden flex border-t border-gray-200 bg-white flex-shrink-0 pb-[env(safe-area-inset-bottom)]" aria-label="View">
          {[['document', 'Document'], ['tools', 'Add fields']].map(([view, label]) => (
            <button
              key={view}
              onClick={() => setMobileView(view)}
              aria-pressed={mobileView === view}
              className={`flex-1 py-3 text-sm font-medium ${mobileView === view ? 'text-blue-600 border-t-2 border-blue-600 -mt-px' : 'text-gray-500'}`}
            >
              {label}
            </button>
          ))}
        </nav>
      )}

      {signingFieldId && (
        <Modal title="Adopt your signature" onClose={() => setSigningFieldId(null)}>
          <p className="text-sm text-gray-500 mb-3">Draw or type your signature. It is used for every signature field you click.</p>
          <SignaturePanel onApply={handlePlaceholderSigned} applyLabel="Adopt and sign" />
        </Modal>
      )}

      <LoadingOverlay visible={loading} />
    </div>
  )
}

