import { useState } from 'react'
import { Link } from 'react-router-dom'
import Brand from './Brand'
import { Pen, Type, Calendar, Hash, CheckSquare, Sparkles } from 'lucide-react'
import SignaturePanel from './SignaturePanel'
import TextOptions from './TextOptions'
import DetectedFieldsPanel from './DetectedFieldsPanel'

export default function Sidebar({
  hasDocument,
  fileType,
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
  onRedetect
}) {
  const [showDetectedFields, setShowDetectedFields] = useState(true)

  const togglePanel = (panel) => {
    onActivePanelChange(activePanel === panel ? null : panel)
  }

  // Every add action needs a document to add to
  const requireDocument = (action) => (...args) => {
    if (!hasDocument) {
      alert('Please upload a document first')
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
    <aside className="w-72 bg-dark-800 border-r border-dark-700 flex flex-col flex-shrink-0">
      <div className="p-5 border-b border-dark-700">
        <h1><Brand className="text-2xl" /></h1>
        <Link to="/" className="text-xs text-dark-400 hover:text-gray-200">← Envelopes</Link>
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
            className="w-full p-3 mb-4 bg-gradient-to-r from-blue-600/20 to-purple-600/20 border border-blue-500/30 rounded-lg text-gray-200 hover:border-blue-500/50 transition-all flex items-center gap-3"
          >
            <Sparkles size={20} className="text-blue-400" />
            <span className="text-sm">Show {detectedFields.length} detected fields</span>
          </button>
        )}

        {/* Re-detect button for PDF files when no fields shown */}
        {hasDocument && fileType === 'pdf' && !showDetectedFields && detectedFields.length === 0 && !isDetecting && (
          <button
            onClick={() => {
              setShowDetectedFields(true)
              onRedetect?.()
            }}
            className="w-full p-3 mb-4 bg-dark-700 border border-dark-600 rounded-lg text-gray-200 hover:bg-blue-600 hover:border-blue-600 transition-all flex items-center gap-3"
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
              : 'bg-dark-700 border-dark-600 text-gray-200 hover:bg-blue-600 hover:border-blue-600'
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
              : 'bg-dark-700 border-dark-600 text-gray-200 hover:bg-blue-600 hover:border-blue-600'
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
          className="w-full p-3 bg-dark-700 border border-dark-600 rounded-lg text-gray-200 hover:bg-blue-600 hover:border-blue-600 transition-all flex items-center gap-3 mb-2"
        >
          <Calendar size={20} />
          <span>Date Field</span>
        </button>

        {/* Initials Button */}
        <button
          onClick={handleAddInitials}
          className="w-full p-3 bg-dark-700 border border-dark-600 rounded-lg text-gray-200 hover:bg-blue-600 hover:border-blue-600 transition-all flex items-center gap-3 mb-2"
        >
          <Hash size={20} />
          <span>Initials</span>
        </button>

        {/* Checkbox Button */}
        <button
          onClick={handleAddCheckbox}
          className="w-full p-3 bg-dark-700 border border-dark-600 rounded-lg text-gray-200 hover:bg-blue-600 hover:border-blue-600 transition-all flex items-center gap-3 mb-2"
        >
          <CheckSquare size={20} />
          <span>Checkbox</span>
        </button>
      </div>
    </aside>
  )
}
