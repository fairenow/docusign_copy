import { Trash2, X } from 'lucide-react'
import { FIELD_LABELS, FONT_SIZES } from '../../lib/fields'

export default function FieldProperties({ field, recipients, onChange, onDelete, onClose }) {
  const signers = recipients.filter(r => r.role === 'signer')
  const hasText = field.type === 'text' || field.type === 'date'

  return (
    <aside className="w-64 flex-shrink-0 bg-dark-800 border-l border-dark-700 p-4 space-y-4" data-testid="field-properties">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-100">{FIELD_LABELS[field.type]}</h2>
        <button onClick={onClose} className="p-1 text-dark-400 hover:text-white" title="Close"><X size={16} /></button>
      </div>

      <label className="block">
        <span className="block text-xs text-dark-400 mb-1">Assigned to</span>
        <select
          value={field.recipientId}
          onChange={(e) => onChange({ recipientId: e.target.value })}
          className="w-full bg-dark-700 border border-dark-600 rounded-lg px-2 py-1.5 text-sm text-gray-100"
        >
          {signers.map(r => <option key={r.id} value={r.id}>{r.name || r.email || 'Unnamed signer'}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-2 text-sm text-gray-200">
        <input type="checkbox" checked={field.required} onChange={(e) => onChange({ required: e.target.checked })} />
        Required
      </label>

      <label className="block">
        <span className="block text-xs text-dark-400 mb-1">Label (shown to the signer)</span>
        <input
          value={field.label}
          onChange={(e) => onChange({ label: e.target.value })}
          maxLength={200}
          placeholder={FIELD_LABELS[field.type]}
          className="w-full bg-dark-700 border border-dark-600 rounded-lg px-2 py-1.5 text-sm text-gray-100 placeholder-dark-500"
        />
      </label>

      {hasText && (
        <label className="block">
          <span className="block text-xs text-dark-400 mb-1">Font size</span>
          <select
            value={field.fontSize}
            onChange={(e) => onChange({ fontSize: Number(e.target.value) })}
            className="w-full bg-dark-700 border border-dark-600 rounded-lg px-2 py-1.5 text-sm text-gray-100"
          >
            {FONT_SIZES.map(size => <option key={size} value={size}>{size} pt</option>)}
          </select>
        </label>
      )}

      <button
        onClick={onDelete}
        className="w-full py-2 rounded-lg bg-dark-700 border border-dark-600 text-sm text-red-300 hover:bg-red-500/10 flex items-center justify-center gap-2"
      >
        <Trash2 size={14} />
        Remove field
      </button>
    </aside>
  )
}
