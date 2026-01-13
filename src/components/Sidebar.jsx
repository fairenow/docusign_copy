import { useState, useEffect } from 'react'
import { Pen, Type, Calendar, Hash, CheckSquare, Sparkles } from 'lucide-react'
import SignaturePanel from './SignaturePanel'
import TextOptions from './TextOptions'
import DetectedFieldsPanel from './DetectedFieldsPanel'

export default function Sidebar({
  onAddElement,
  hasDocument,
  fileType,
  detectedFields = [],
  isDetecting = false,
  onPlaceField,
  onPlaceAllFields,
  onDismissDetected,
  onRedetect,
  onApplySignature,
  pendingSignatureId,
  onClearPendingSignature
}) {
  const [activePanel, setActivePanel] = useState(null)
  const [showDetectedFields, setShowDetectedFields] = useState(true)

  // Auto-open signature panel when a signature placeholder is clicked
  useEffect(() => {
    if (pendingSignatureId) {
      setActivePanel('signature')
    }
  }, [pendingSignatureId])

  const togglePanel = (panel) => {
    // Clear pending signature if closing signature panel
    if (activePanel === 'signature' && panel !== 'signature') {
      onClearPendingSignature?.()
    }
    setActivePanel(activePanel === panel ? null : panel)
  }

  const handleAddSignature = (signatureData) => {
    if (!hasDocument) {
      alert('Please upload a document first')
      return
    }
    // Use onApplySignature if available (handles both new and pending)
    if (onApplySignature) {
      onApplySignature(signatureData)
    } else {
      onAddElement({
        type: 'signature',
        data: signatureData,
        x: 100,
        y: 100
      })
    }
    // Close the panel after applying
    setActivePanel(null)
  }

  const handleAddText = (options) => {
    if (!hasDocument) {
      alert('Please upload a document first')
      return
    }
    onAddElement({
      type: 'text',
      text: '',
      x: 100,
      y: 100,
      fontSize: options.fontSize,
      color: options.color
    })
  }

  const handleAddDate = () => {
    if (!hasDocument) {
      alert('Please upload a document first')
      return
    }
    onAddElement({
      type: 'date',
      text: new Date().toLocaleDateString(),
      x: 100,
      y: 100
    })
  }

  const handleAddInitials = () => {
    if (!hasDocument) {
      alert('Please upload a document first')
      return
    }
    const initials = prompt('Enter your initials:')
    if (initials) {
      onAddElement({
        type: 'initials',
        text: initials,
        x: 100,
        y: 100
      })
    }
  }

  const handleAddCheckbox = () => {
    if (!hasDocument) {
      alert('Please upload a document first')
      return
    }
    onAddElement({
      type: 'checkbox',
      checked: false,
      x: 100,
      y: 100
    })
  }

  return (
    <aside className="w-72 bg-dark-800 border-r border-dark-700 flex flex-col flex-shrink-0">
      <div className="p-5 border-b border-dark-700">
        <h1 className="text-2xl font-bold gradient-text flex items-center gap-2">
          📝 DocSign
        </h1>
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

        <p className="text-xs font-semibold text-dark-500 uppercase tracking-wide mb-3">
          Add Fields
        </p>

        {/* Signature Button */}
        <button
          onClick={() => togglePanel('signature')}
          className={`w-full p-3 rounded-lg border transition-all flex items-center gap-3 mb-2 ${
            activePanel === 'signature'
              ? 'bg-blue-600 border-blue-600 text-white'
              : pendingSignatureId
              ? 'bg-amber-600 border-amber-600 text-white animate-pulse'
              : 'bg-dark-700 border-dark-600 text-gray-200 hover:bg-blue-600 hover:border-blue-600'
          }`}
        >
          <Pen size={20} />
          <span>{pendingSignatureId ? 'Apply Signature' : 'Signature'}</span>
        </button>

        {activePanel === 'signature' && (
          <div className="mb-2">
            {pendingSignatureId && (
              <div className="mb-2 p-2 bg-amber-500/20 border border-amber-500/50 rounded text-amber-200 text-xs">
                Draw or type your signature below, then click Apply to add it to the selected field.
              </div>
            )}
            <SignaturePanel onApply={handleAddSignature} />
          </div>
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
