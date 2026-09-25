import { Sparkles, X } from 'lucide-react'
import { FIELD_LABELS } from '../../lib/fields'
import { FIELD_ICONS } from '../fieldIcons'

// Choice in the "who" menu that turns a text suggestion into a "Fill in now" field
const FILL_NOW = '__fill_now__'
const canFillNow = (s) => s.type === 'text' || s.type === 'prefill'

/**
 * Fields found on the document, to review before they are added: who fills each one in
 * (unclear ones are highlighted), remove any that are wrong, then add them all.
 */
export default function SuggestionsPanel({ suggestions, recipients, onChange, onRemove, onAccept, onDismiss }) {
  const signers = recipients.filter(r => r.role === 'signer')
  const ready = suggestions.filter(s => s.type === 'prefill' || signers.some(r => r.id === s.recipientId))
  const unclear = suggestions.length - ready.length

  return (
    <section className="rounded-lg border border-violet-300 bg-violet-50/60 p-3 space-y-3" data-testid="suggestions">
      <div className="flex items-start gap-2">
        <Sparkles size={16} className="text-violet-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-900">Suggested fields ({suggestions.length})</h2>
          <p className="text-xs text-gray-600">
            Found on the document&rsquo;s blank lines and placeholders.
            {unclear > 0 && ` Choose who fills in the ${unclear} highlighted one${unclear > 1 ? 's' : ''}.`}
          </p>
        </div>
        <button onClick={onDismiss} className="p-1 text-gray-500 hover:text-gray-900" title="Dismiss suggestions"><X size={16} /></button>
      </div>

      <ol className="space-y-1.5 max-h-72 overflow-y-auto">
        {suggestions.map(s => {
          const Icon = FIELD_ICONS[s.type]
          const assigned = ready.includes(s)
          const value = s.type === 'prefill' ? FILL_NOW : s.recipientId ?? ''
          return (
            <li
              key={s.id}
              data-testid="suggestion"
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${assigned ? 'bg-white' : 'bg-amber-50 ring-1 ring-amber-400'}`}
            >
              <Icon size={14} className="text-gray-500 flex-shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0 truncate text-gray-800">
                {s.label || FIELD_LABELS[s.type]}
                <span className="text-xs text-gray-500"> · p.{s.page}</span>
              </span>
              <select
                value={value}
                onChange={(e) => onChange(s.id, e.target.value === FILL_NOW
                  ? { type: 'prefill', recipientId: null }
                  : { recipientId: e.target.value || null, ...(s.type === 'prefill' && { type: 'text' }) })}
                aria-label={`Who fills in ${s.label || FIELD_LABELS[s.type]} on page ${s.page}`}
                className="max-w-[8.5rem] bg-white border border-gray-300 rounded px-1 py-0.5 text-xs text-gray-800"
              >
                {value === '' && <option value="">Choose who…</option>}
                {signers.map(r => <option key={r.id} value={r.id}>{r.name || r.email || 'Unnamed signer'}</option>)}
                {canFillNow(s) && <option value={FILL_NOW}>Me, now</option>}
              </select>
              <button onClick={() => onRemove(s.id)} className="p-0.5 text-gray-400 hover:text-red-600" title="Don't add this field"><X size={14} /></button>
            </li>
          )
        })}
      </ol>

      <div className="flex gap-2">
        <button
          onClick={onAccept}
          disabled={!ready.length}
          className="flex-1 btn-primary px-3 py-1.5 rounded-md text-sm"
        >
          Add {ready.length} field{ready.length === 1 ? '' : 's'}
        </button>
        <button onClick={onDismiss} className="btn-secondary px-3 py-1.5 rounded-md text-sm">Dismiss</button>
      </div>
      {unclear > 0 && ready.length > 0 && (
        <p className="text-xs text-gray-500">Highlighted fields stay as suggestions until you choose who fills them in.</p>
      )}
    </section>
  )
}
