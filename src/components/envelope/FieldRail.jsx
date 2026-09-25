import { FIELD_LABELS, FIELD_TYPES, SENDER_FIELD_TYPES } from '../../lib/fields'
import { initialsOf } from '../../../supabase/functions/_shared/signing.js'
import { FIELD_ICONS } from '../fieldIcons'

/**
 * Vertical field toolbar on the left of the editor, usable as soon as the document is open.
 * Fields go to the selected signer, whose color and initials are shown at the top; with no
 * signer yet, the first field adds one to name later. "Fill in now" fields are the sender's.
 */
export default function FieldRail({ recipient, documentReady, onAdd, activeType = null }) {
  const disabled = !documentReady
  const hint = !documentReady ? 'Loading the document…' : null

  return (
    <nav aria-label="Add fields" className="w-full md:w-[76px] flex-shrink-0 bg-white border-t md:border-t-0 md:border-r border-gray-200/80 px-2 py-1.5 md:px-0 md:py-3 flex md:flex-col items-center gap-1 overflow-x-auto md:overflow-x-visible md:overflow-y-auto [scrollbar-width:none]">
      <span
        className="flex-shrink-0 mx-1 md:mx-0 md:mb-2 w-8 h-8 rounded-full text-xs font-semibold text-white flex items-center justify-center shadow-sm ring-2 ring-white"
        style={{ backgroundColor: recipient?.color ?? '#9ca3af' }}
        title={recipient ? `New fields go to ${recipient.name || 'this signer'}` : 'New fields go to a signer you name later'}
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
            aria-pressed={activeType === type}
            title={hint ?? `Add ${FIELD_LABELS[type].toLowerCase()} for ${recipient ? recipient.name || 'this signer' : 'a signer (name them any time)'}`}
            className={`w-16 flex-shrink-0 py-2 rounded-lg flex flex-col items-center gap-1 text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent ${activeType === type ? 'bg-blue-50 ring-2 ring-inset ring-blue-500 text-blue-900' : ''}`}
          >
            <Icon size={20} style={recipient ? { color: recipient.color } : undefined} aria-hidden="true" />
            <span className="text-[11px] leading-tight text-center">{FIELD_LABELS[type]}</span>
          </button>
        )
      })}
      <div className="flex-shrink-0 h-8 w-px mx-1 md:mx-0 md:h-px md:w-10 bg-gray-200 md:my-2" role="separator" />
      {SENDER_FIELD_TYPES.map(type => {
        const Icon = FIELD_ICONS[type]
        return (
          <button
            key={type}
            type="button"
            disabled={!documentReady}
            onClick={() => onAdd(type)}
            aria-pressed={activeType === type}
            title={documentReady ? 'Add text you type now, e.g. the other company\'s name' : 'Loading the document…'}
            className={`w-16 flex-shrink-0 py-2 rounded-lg flex flex-col items-center gap-1 text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent ${activeType === type ? 'bg-blue-50 ring-2 ring-inset ring-blue-500 text-blue-900' : ''}`}
          >
            <Icon size={20} className="text-gray-600" aria-hidden="true" />
            <span className="text-[11px] leading-tight text-center">{FIELD_LABELS[type]}</span>
          </button>
        )
      })}
    </nav>
  )
}
