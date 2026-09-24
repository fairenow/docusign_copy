import { FIELD_LABELS, FIELD_TYPES } from '../../lib/fields'
import { initialsOf } from '../../../supabase/functions/_shared/signing.js'
import { FIELD_ICONS } from '../fieldIcons'

/**
 * Vertical field toolbar on the left of the editor. Fields are added to the page in view
 * for the selected signer, whose color and initials are shown at the top.
 */
export default function FieldRail({ recipient, documentReady, onAdd }) {
  const disabled = !recipient || !documentReady
  const hint = !documentReady ? 'Loading the document…' : !recipient ? 'Add a signer first' : null

  return (
    <nav aria-label="Add fields" className="w-[76px] flex-shrink-0 bg-white border-r border-gray-200 py-3 flex flex-col items-center gap-1 overflow-y-auto">
      <span
        className="mb-2 w-8 h-8 rounded-full text-xs font-semibold text-white flex items-center justify-center"
        style={{ backgroundColor: recipient?.color ?? '#9ca3af' }}
        title={recipient ? `New fields go to ${recipient.name || 'this signer'}` : 'No signer selected'}
      >
        {recipient ? initialsOf(recipient.name) || '?' : '–'}
      </span>
      {FIELD_TYPES.map(type => {
        const Icon = FIELD_ICONS[type]
        return (
          <button
            key={type}
            type="button"
            disabled={disabled}
            onClick={() => onAdd(type)}
            title={hint ?? `Add ${FIELD_LABELS[type].toLowerCase()} for ${recipient.name || 'this signer'}`}
            className="w-16 py-2 rounded-lg flex flex-col items-center gap-1 text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Icon size={20} style={recipient ? { color: recipient.color } : undefined} aria-hidden="true" />
            <span className="text-[11px] leading-tight text-center">{FIELD_LABELS[type]}</span>
          </button>
        )
      })}
    </nav>
  )
}
