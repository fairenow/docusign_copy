import { useState } from 'react'
import { Link } from 'react-router-dom'
import Brand from './Brand'
import { Pen, Type, Calendar, Hash, CheckSquare, Sparkles } from 'lucide-react'
import SignaturePanel from './SignaturePanel'
import TextOptions from './TextOptions'
import DetectedFieldsPanel from './DetectedFieldsPanel'
import { useFeedback } from './feedback/useFeedback'

export default function Sidebar({
  hasDocument,
  activePanel,
  onActivePanelChange,
  onAddSignature,
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
  const handleAddText = requireDocument(onAddText)
  const handleAddDate = requireDocument(onAddDate)
  const handleAddInitials = requireDocument(onAddInitials)
  const handleAddCheckbox = requireDocument(onAddCheckbox)

  return (
    <aside className={`w-full md:w-72 flex-1 md:flex-none bg-white border-r border-gray-200 flex-col flex-shrink-0 min-h-0 ${className || 'flex'}`}>
      <div className="p-5 border-b border-gray-200">
        <h1><Brand className="text-2xl" /></h1>
        <Link to="/" className="text-xs text-gray-500 hover:text-gray-900">← Envelopes</Link>
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
            className="w-full p-3 mb-4 bg-gray-50 border border-gray-300 rounded-lg text-gray-800 hover:bg-blue-600 hover:border-blue-600 transition-all flex items-center gap-3"
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
          className={`w-full p-3 rounded-lg border transition-all flex items-center gap-3 mb-2 ${
            activePanel === 'signature'
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-gray-50 border-gray-300 text-gray-800 hover:bg-blue-600 hover:border-blue-600'
          }`}
        >
          <Pen size={20} />
          <span>Signature</span>
        </button>

        {activePanel === 'signature' && (
          <SignaturePanel onApply={handleAddSignature} />
        )}

        {/* Text Button */}
        <button
          onClick={() => togglePanel('text')}
          className={`w-full p-3 rounded-lg border transition-all flex items-center gap-3 mb-2 ${
            activePanel === 'text'
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-gray-50 border-gray-300 text-gray-800 hover:bg-blue-600 hover:border-blue-600'
          }`}
        >
          <Type size={20} />
          <span>Text Field</span>
        </button>

        {activePanel === 'text' && (
          <TextOptions onApply={handleAddText} />
        )}

        {/* Date Button */}
        <button
          onClick={handleAddDate}
          className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg text-gray-800 hover:bg-blue-600 hover:border-blue-600 transition-all flex items-center gap-3 mb-2"
        >
          <Calendar size={20} />
          <span>Date Field</span>
        </button>

        {/* Initials Button */}
        <button
          onClick={handleAddInitials}
          className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg text-gray-800 hover:bg-blue-600 hover:border-blue-600 transition-all flex items-center gap-3 mb-2"
        >
          <Hash size={20} />
          <span>Initials</span>
        </button>

        {/* Checkbox Button */}
        <button
          onClick={handleAddCheckbox}
          className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg text-gray-800 hover:bg-blue-600 hover:border-blue-600 transition-all flex items-center gap-3 mb-2"
        >
          <CheckSquare size={20} />
          <span>Checkbox</span>
        </button>
      </div>
    </aside>
  )
}
