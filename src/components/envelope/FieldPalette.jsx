import { Pen, Hash, Type, Calendar, CheckSquare } from 'lucide-react'
import { FIELD_LABELS, FIELD_TYPES } from '../../lib/fields'

const ICONS = { signature: Pen, initials: Hash, text: Type, date: Calendar, checkbox: CheckSquare }

export default function FieldPalette({ recipient, onAdd }) {
  return (
    <section>
      <h2 className="text-xs font-semibold text-dark-500 uppercase tracking-wide mb-2">Fields</h2>
      {recipient ? (
        <p className="text-xs text-dark-400 mb-2">
          Adding to the current page for{' '}
          <span className="font-medium" style={{ color: recipient.color }}>{recipient.name || 'this signer'}</span>
        </p>
      ) : (
        <p className="text-xs text-dark-400 mb-2">Add a signer, then select them to place their fields.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {FIELD_TYPES.map(type => {
          const Icon = ICONS[type]
          return (
            <button
              key={type}
              type="button"
              disabled={!recipient}
              onClick={() => onAdd(type)}
              className="p-2 rounded-lg bg-dark-700 border border-dark-600 text-sm text-gray-200 flex items-center gap-2 hover:border-blue-500 disabled:opacity-40 disabled:hover:border-dark-600"
            >
              <Icon size={14} />
              {FIELD_LABELS[type]}
            </button>
          )
        })}
      </div>
    </section>
  )
}
