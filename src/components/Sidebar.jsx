import { useState } from 'react'
import { Link } from 'react-router-dom'
import Brand from './Brand'
import { Pen, Type, Calendar, Hash, CheckSquare, Sparkles } from 'lucide-react'
import SignaturePanel from './SignaturePanel'
import TextOptions from './TextOptions'
import DetectedFieldsPanel from './DetectedFieldsPanel'
import { useFeedback } from './feedback/useFeedback'

// One field tool: a quiet row that lifts on hover; the open one is outlined in the accent
const toolClass = (active) => `w-full px-3 py-2.5 rounded-lg border text-sm font-medium flex items-center gap-3 mb-2 transition-[background-color,border-color,box-shadow,color] duration-150 ${
  active ? 'bg-blue-50 border-blue-300 text-blue-900 shadow-focus' : 'bg-white border-gray-200 text-gray-800 shadow-xs hover:border-gray-300 hover:bg-gray-50'
}`

export default function Sidebar({
  hasDocument,
  activePanel,
  onActivePanelChange,
  onAddSignature,
  savedSignatures = [], // [{ id, kind: 'signature' | 'initials', image }], newest first
  onUseSaved,
  onAddText,
  onAddDate,
  onAddInitials,
  onAddCheckbox,
  detectedFields = [],
  isDetecting = false,
  onPlaceField,
  onPlaceAllFields,
  onDismissDetected,
  onRedetect,
  className = ''
}) {
  const [showDetectedFields, setShowDetectedFields] = useState(true)
  const { notify } = useFeedback()

  const togglePanel = (panel) => {
    onActivePanelChange(activePanel === panel ? null : panel)
  }

  // Every add action needs a document to add to
  const requireDocument = (action) => (...args) => {
    if (!hasDocument) {
      notify('Upload a document first.', { tone: 'info' })
      return
    }
    action(...args)
  }

  const handleAddSignature = requireDocument(onAddSignature)
  const handleUseSaved = requireDocument(onUseSaved)
  const handleAddText = requireDocument(onAddText)
  const handleAddDate = requireDocument(onAddDate)
  const handleAddInitials = requireDocument(onAddInitials)
  const handleAddCheckbox = requireDocument(onAddCheckbox)

  return (
    <aside className={`w-full md:w-72 flex-1 md:flex-none bg-white border-r border-gray-200/80 flex-col flex-shrink-0 min-h-0 ${className || 'flex'}`}>
      <div className="p-5 border-b border-gray-200">
        <h1><Brand className="text-2xl" /></h1>
        <Link to="/" className="mt-1 inline-block text-xs font-medium text-gray-500 hover:text-gray-900">← Envelopes</Link>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        {/* Detected Fields Panel */}
        {hasDocument && showDetectedFields && (isDetecting || detectedFields.length > 0) && (
          <DetectedFieldsPanel
            detectedFields={detectedFields}
            isDetecting={isDetecting}
            onPlaceField={onPlaceField}
            onPlaceAllFields={onPlaceAllFields}
            onClose={() => {
              setShowDetectedFields(false)
              onDismissDetected?.()
            }}
          />
        )}

        {/* Show detected fields toggle if previously hidden */}
        {hasDocument && !showDetectedFields && detectedFields.length > 0 && (
          <button
            onClick={() => setShowDetectedFields(true)}
            className="w-full p-3 mb-4 bg-blue-50 border border-blue-200 rounded-lg text-gray-800 hover:border-blue-500/50 transition-all flex items-center gap-3"
          >
            <Sparkles size={20} className="text-blue-600" />
            <span className="text-sm">Show {detectedFields.length} detected fields</span>
          </button>
        )}

        {/* Re-detect button for PDF files when no fields shown */}
        {hasDocument && !showDetectedFields && detectedFields.length === 0 && !isDetecting && (
          <button
            onClick={() => {
              setShowDetectedFields(true)
              onRedetect?.()
            }}
            className={`${toolClass(false)} mb-4`}
          >
            <Sparkles size={20} />
            <span className="text-sm">Detect Form Fields</span>
          </button>
        )}

        <p className="section-heading mb-3">
          Add Fields
        </p>

        {/* Signature Button */}
        <button
          onClick={() => togglePanel('signature')}
          className={toolClass(activePanel === 'signature')}
        >
          <Pen size={18} className="text-gray-500" aria-hidden="true" />
          <span>Signature</span>
        </button>

        {activePanel === 'signature' && (
          <>
            {savedSignatures.length > 0 && (
              <div className="mb-3" data-testid="saved-signatures">
                <p className="text-xs font-medium text-gray-600 mb-1.5">Yours: click one to place it</p>
                <div className="grid grid-cols-2 gap-2">
                  {savedSignatures.map(s => (
                    <button
                      key={s.id}
                      onClick={() => handleUseSaved(s)}
                      aria-label={`Place your saved ${s.kind}`}
                      className={`h-14 rounded-md border border-gray-300 bg-white p-1 hover:border-blue-600 ${s.kind === 'signature' ? 'col-span-2' : ''}`}
                    >
                      <img src={s.image} alt="" className="w-full h-full object-contain" draggable={false} />
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-3">Or make a new one:</p>
              </div>
            )}
            <SignaturePanel onApply={handleAddSignature} />
          </>
        )}

        {/* Text Button */}
        <button
          onClick={() => togglePanel('text')}
          className={toolClass(activePanel === 'text')}
        >
          <Type size={18} className="text-gray-500" aria-hidden="true" />
          <span>Text Field</span>
        </button>

        {activePanel === 'text' && (
          <TextOptions onApply={handleAddText} />
        )}

        {/* Date Button */}
        <button
          onClick={handleAddDate}
          className={toolClass(false)}
        >
          <Calendar size={18} className="text-gray-500" aria-hidden="true" />
          <span>Today&apos;s date</span>
        </button>

        {/* Initials Button */}
        <button
          onClick={handleAddInitials}
          className={toolClass(false)}
        >
          <Hash size={18} className="text-gray-500" aria-hidden="true" />
          <span>Initials</span>
        </button>

        {/* Checkbox Button */}
        <button
          onClick={handleAddCheckbox}
          className={toolClass(false)}
        >
          <CheckSquare size={18} className="text-gray-500" aria-hidden="true" />
          <span>Checkbox</span>
        </button>
      </div>
    </aside>
  )
}
