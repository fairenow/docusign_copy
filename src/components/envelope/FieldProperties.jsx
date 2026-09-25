import { Trash2, X } from 'lucide-react'
import { FIELD_LABELS, FONT_SIZES } from '../../lib/fields'

const inputClass = 'w-full bg-white border border-gray-300 rounded-md px-2.5 py-2 text-sm text-gray-900 placeholder-gray-400'

export default function FieldProperties({ field, recipients, onChange, onDelete, onClose }) {
  const signers = recipients.filter(r => r.role === 'signer')
  const prefill = field.type === 'prefill'
  const hasText = field.type === 'text' || field.type === 'date' || prefill

  return (
    <div className="space-y-4" data-testid="field-properties">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">{FIELD_LABELS[field.type]}</h2>
        <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900" title="Done editing field"><X size={16} /></button>
      </div>

      {prefill ? (
        <>
          <p className="text-xs text-gray-500">You fill this in now. It is printed into the document and signers cannot change it.</p>
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">What is it? (e.g. Company name)</span>
            <input value={field.label} onChange={(e) => onChange({ label: e.target.value })} maxLength={200} placeholder="Company name" className={inputClass} />
          </label>
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Text to print</span>
            <input value={field.text ?? ''} onChange={(e) => onChange({ text: e.target.value })} maxLength={500} className={inputClass} />
          </label>
        </>
      ) : (
        <>
          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Assigned to</span>
            <select value={field.recipientId} onChange={(e) => onChange({ recipientId: e.target.value })} className={inputClass}>
              {signers.map(r => <option key={r.id} value={r.id}>{r.name || r.email || 'Unnamed signer'}</option>)}
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} />
            Required
          </label>

          <label className="block">
            <span className="block text-xs text-gray-500 mb-1">Label (shown to the signer)</span>
            <input value={field.label} onChange={(e) => onChange({ label: e.target.value })} maxLength={200} placeholder={FIELD_LABELS[field.type]} className={inputClass} />
          </label>
        </>
      )}

      {hasText && (
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">Font size</span>
          <select value={field.fontSize} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} className={inputClass}>
            {FONT_SIZES.map(size => <option key={size} value={size}>{size} pt</option>)}
          </select>
        </label>
      )}

      <button
        onClick={onDelete}
        className="w-full py-2 rounded-md border border-gray-300 text-sm text-red-700 hover:bg-red-50 flex items-center justify-center gap-2"
      >
        <Trash2 size={14} />
        Remove field
      </button>
    </div>
  )
}
