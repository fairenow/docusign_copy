import { ChevronUp, ChevronDown, Trash2, UserPlus } from 'lucide-react'
import { RECIPIENT_STATUS } from '../../lib/envelopeModel'

/**
 * Recipients of an envelope. The active signer receives newly added fields.
 */
export default function RecipientsPanel({
  recipients,
  signingOrder,
  activeRecipientId,
  readOnly,
  onActivate,
  onAdd,
  onChange,
  onRemove,
  onMove,
  onSigningOrderChange,
  signingMyself, // { checked, onChange } for "I need to sign this document"
}) {
  const sequential = signingOrder === 'sequential'

  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Who should complete this document?</h2>
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          {signingMyself && (
            <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer">
              <input
                type="checkbox"
                checked={signingMyself.checked}
                onChange={(e) => signingMyself.onChange(e.target.checked)}
              />
              I need to sign this document
            </label>
          )}
          <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={sequential}
              onChange={(e) => onSigningOrderChange(e.target.checked ? 'sequential' : 'parallel')}
            />
            Sign in order
          </label>
        </div>
      )}

      <ol className="space-y-2">
        {recipients.map((r, index) => {
          const active = r.id === activeRecipientId
          return (
            <li
              key={r.id}
              className={`rounded-lg border p-2 ${active ? 'border-blue-500 bg-blue-500/5' : 'border-gray-300 bg-gray-50'}`}
              data-testid="recipient"
            >
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => r.role === 'signer' && onActivate(r.id)}
                  className="w-4 h-4 rounded-full flex-shrink-0 ring-offset-2 ring-offset-white"
                  style={{ backgroundColor: r.color, boxShadow: active ? `0 0 0 2px ${r.color}` : undefined }}
                  title={r.role === 'signer' ? 'Add fields for this signer' : 'CC recipients do not get fields'}
                  aria-label={`Select ${r.name || `recipient ${index + 1}`}`}
                />
                {sequential && <span className="text-xs text-gray-500">{index + 1}.</span>}
                {readOnly ? (
                  <span className="text-sm text-gray-800 truncate flex-1">{r.name}</span>
                ) : (
                  <input
                    value={r.name}
                    onChange={(e) => onChange(r.id, { name: e.target.value })}
                    onFocus={() => r.role === 'signer' && onActivate(r.id)}
                    placeholder="Full name"
                    maxLength={200}
                    className="flex-1 min-w-0 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 placeholder-gray-400"
                    aria-label="Recipient name"
                  />
                )}
                {readOnly ? (
                  <span className="text-xs text-gray-500">{RECIPIENT_STATUS[r.status]?.label}</span>
                ) : (
                  <div className="flex items-center">
                    {sequential && (
                      <>
                        <button type="button" onClick={() => onMove(r.id, -1)} disabled={index === 0} className="p-0.5 text-gray-500 hover:text-gray-900 disabled:opacity-30" title="Move up"><ChevronUp size={14} /></button>
                        <button type="button" onClick={() => onMove(r.id, 1)} disabled={index === recipients.length - 1} className="p-0.5 text-gray-500 hover:text-gray-900 disabled:opacity-30" title="Move down"><ChevronDown size={14} /></button>
                      </>
                    )}
                    <button type="button" onClick={() => onRemove(r.id)} className="p-0.5 text-gray-500 hover:text-red-600" title="Remove recipient"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>

              {readOnly ? (
                <p className="text-xs text-gray-500 truncate pl-6">{r.email}{r.role === 'cc' ? ' · CC' : ''}</p>
              ) : (
                <div className="flex gap-2 pl-6">
                  <input
                    type="email"
                    value={r.email}
                    onChange={(e) => onChange(r.id, { email: e.target.value })}
                    onFocus={() => r.role === 'signer' && onActivate(r.id)}
                    placeholder="Email address"
                    maxLength={320}
                    className="flex-1 min-w-0 bg-white border border-gray-300 rounded px-2 py-1 text-xs text-gray-900 placeholder-gray-400"
                    aria-label="Recipient email"
                  />
                  <select
                    value={r.role}
                    onChange={(e) => onChange(r.id, { role: e.target.value })}
                    className="bg-white border border-gray-300 rounded px-1 py-1 text-xs text-gray-800"
                    aria-label="Recipient role"
                  >
                    <option value="signer">Signs</option>
                    <option value="cc">Gets a copy</option>
                  </select>
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {!readOnly && (
        <button
          type="button"
          onClick={onAdd}
          className="mt-2 w-full py-2 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:text-gray-900 hover:border-blue-500 flex items-center justify-center gap-2"
        >
          <UserPlus size={14} />
          Add recipient
        </button>
      )}
    </section>
  )
}
