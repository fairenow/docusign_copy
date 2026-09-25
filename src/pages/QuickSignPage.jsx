import { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import Brand from '../components/Brand'
import DocumentViewer from '../components/DocumentViewer'
import FillField from '../components/FillField'
import FileDropzone from '../components/FileDropzone'
import Toolbar from '../components/Toolbar'
import LoadingOverlay from '../components/LoadingOverlay'
import { useFeedback } from '../components/feedback/useFeedback'
import Modal from '../components/Modal'
import SignaturePanel from '../components/SignaturePanel'
import PlacementHint from '../components/PlacementHint'
import { useDocument } from '../hooks/useDocument'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import { FIELD_LABELS, canHover, createElement, elementFromDetected, placementRect, rectInView } from '../lib/fields'
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
  // A field picked up with the mouse: { type, props }, following the pointer until clicked onto a page
  const [pending, setPending] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const viewerRef = useRef(null)

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
  const { ask, confirm, notify } = useFeedback()

  useEffect(() => {
    if (documentError) notify(`Could not open the document: ${documentError.message}`, { tone: 'error' })
  }, [documentError, notify])

  // With a mouse the field follows the pointer until it is clicked onto the page, as in the
  // envelope editor. Touch screens have no hover: it is added at once where you are looking,
  // selected, and scrolled fully into view.
  const addElement = useCallback((type, props = {}) => {
    if (!pageSizes[currentPage - 1]) return
    if (canHover()) {
      setPending({ type, props })
      return
    }
    const spot = viewerRef.current?.visibleSpot() ?? { page: currentPage, x: 0.5, y: 0.3 }
    const pageSize = pageSizes[spot.page - 1]
    const rect = rectInView(type, pageSize, spot, elements.filter(el => el.page === spot.page), props)
    const element = createElement(type, { page: spot.page, pageSize }, { ...props, ...rect })
    setElements(prev => [...prev, element])
    setSelectedId(element.id)
    requestAnimationFrame(() => viewerRef.current?.reveal(spot.page, rect))
  }, [currentPage, pageSizes, elements])

  const updateElement = useCallback((id, updates) => {
    setElements(prev => prev.map(el => (el.id === id ? { ...el, ...updates } : el)))
  }, [])

  const deleteElement = useCallback((id) => {
    setElements(prev => prev.filter(el => el.id !== id))
  }, [])

  const clearAllElements = useCallback(async () => {
    if (await confirm({ title: 'Remove all fields?', message: 'Everything you added to the document is removed.', confirmLabel: 'Remove all', danger: true })) {
      setElements([])
    }
  }, [confirm])

  const getInitials = useCallback(async () => {
    if (savedInitials) return savedInitials
    const text = await ask({ title: 'Your initials', label: 'Initials', placeholder: 'e.g. JD', confirmLabel: 'Use initials', multiline: false, maxLength: 10, required: true })
    if (!text) return null
    const image = await renderTypedSignature(text)
    const initials = { ...image, text }
    setSavedInitials(initials)
    return initials
  }, [savedInitials, ask])

  // From the sidebar: a new signature field on the current page
  const handleSignatureCreated = useCallback((signature) => {
    setSavedSignature(signature)
    addElement('signature', { data: signature.data, aspect: signature.aspect })
    setActivePanel(null)
  }, [addElement])

  // From the sidebar: one of your saved signatures or initials, in one click
  const handleUseSaved = useCallback(async (row) => {
    const image = await signatureFromImage(row.image)
    if (row.kind === 'signature') return handleSignatureCreated(image)
    setSavedInitials({ ...image, text: '' })
    addElement('initials', { data: image.data, aspect: image.aspect })
    setActivePanel(null)
  }, [addElement, handleSignatureCreated])

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

  useEffect(() => {
    if (!pending) return
    const onKeyDown = (e) => { if (e.key === 'Escape') setPending(null) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [pending])

  const placing = pending && {
    rectAt: (pageNumber, x, y) => placementRect(pending.type, pageSizes[pageNumber - 1], x, y, pending.props),
    // The preview is the field as it will be: the signature itself, today's date
    render: (rect, ctx) => (
      <FillField element={createElement(pending.type, { page: 1, pageSize: pageSizes[0] }, { ...pending.props, ...rect })} {...ctx} onUpdate={() => {}} />
    ),
    onPlace: (pageNumber, rect) => {
      setElements(prev => [...prev, createElement(pending.type, { page: pageNumber, pageSize: pageSizes[pageNumber - 1] }, { ...pending.props, ...rect })])
      setPending(null)
    }
  }

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
    if (elements.length && !(await confirm({
      title: 'Open another document?',
      message: 'The fields you placed on this one will be discarded.',
      confirmLabel: 'Open document',
      danger: true
    }))) {
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
      notify(`Could not open the file: ${err.message}`, { tone: 'error' })
    }
    setLoading(false)
  }

  const handleDownload = async () => {
    const { findIncompleteElements, buildSignedPdf, downloadPdf } = await import('../lib/exportPdf')
    const incomplete = findIncompleteElements(elements)
    if (incomplete.length) {
      setCurrentPage(incomplete[0].page)
      notify(`${incomplete.length} signature/initials field${incomplete.length > 1 ? 's are' : ' is'} still empty. Click the highlighted field to sign, or remove it.`, { tone: 'info' })
      return
    }

    setLoading(true)
    try {
      const bytes = await buildSignedPdf(pdfBytes, elements)
      downloadPdf(bytes, file.name)
    } catch (err) {
      console.error('Download error:', err)
      notify(`Could not create the PDF: ${err.message}`, { tone: 'error' })
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
        savedSignatures={saved}
        onUseSaved={thenShowDocument(handleUseSaved)}
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

        {placing && <PlacementHint what={pending.type === 'date' ? "today's date" : FIELD_LABELS[pending.type].toLowerCase()} />}
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
          ref={viewerRef}
          selectedId={selectedId}
          onSelectedIdChange={setSelectedId}
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
          placing={placing}
        />
        )}
      </main>

      {/* Phones: switch between the document and the field tools */}
      {file && (
        <nav className="md:hidden px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-gray-200/80 bg-white flex-shrink-0" aria-label="View">
          <div className="segmented w-full">
            {[['document', 'Document'], ['tools', 'Add fields']].map(([view, label]) => (
              <button
                key={view}
                onClick={() => setMobileView(view)}
                aria-pressed={mobileView === view}
                className="segmented-item flex-1 py-2"
              >
                {label}
              </button>
            ))}
          </div>
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

