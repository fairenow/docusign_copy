import { useState } from 'react'
import { Pen, Type, Calendar, Hash, CheckSquare } from 'lucide-react'
import SignaturePanel from './SignaturePanel'
import TextOptions from './TextOptions'

export default function Sidebar({ onAddElement, hasDocument }) {
  const [activePanel, setActivePanel] = useState(null)

  const togglePanel = (panel) => {
    setActivePanel(activePanel === panel ? null : panel)
  }

  const handleAddSignature = (signatureData) => {
    if (!hasDocument) {
      alert('Please upload a document first')
      return
    }
    onAddElement({
      type: 'signature',
      data: signatureData,
      x: 100,
      y: 100
    })
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
        <p className="text-xs font-semibold text-dark-500 uppercase tracking-wide mb-3">
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
