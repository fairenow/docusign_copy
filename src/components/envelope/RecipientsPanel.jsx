import { ChevronUp, ChevronDown, Trash2, UserPlus } from 'lucide-react'

const STATUS_TEXT = { pending: 'Not sent', sent: 'Sent', viewed: 'Viewed', signed: 'Signed', declined: 'Declined' }

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
  onSigningOrderChange
}) {
  const sequential = signingOrder === 'sequential'

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-semibold text-dark-500 uppercase tracking-wide">Recipients</h2>
        {!readOnly && (
          <label className="flex items-center gap-2 text-xs text-dark-400 cursor-pointer">
            <input
              type="checkbox"
              checked={sequential}
              onChange={(e) => onSigningOrderChange(e.target.checked ? 'sequential' : 'parallel')}
            />
            Sign in order
          </label>
        )}
      </div>

      <ol className="space-y-2">
        {recipients.map((r, index) => {
          const active = r.id === activeRecipientId
          return (
            <li
              key={r.id}
              className={`rounded-lg border p-2 ${active ? 'border-blue-500 bg-blue-500/5' : 'border-dark-600 bg-dark-700'}`}
              data-testid="recipient"
            >
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => r.role === 'signer' && onActivate(r.id)}
                  className="w-4 h-4 rounded-full flex-shrink-0 ring-offset-2 ring-offset-dark-700"
                  style={{ backgroundColor: r.color, boxShadow: active ? `0 0 0 2px ${r.color}` : undefined }}
                  title={r.role === 'signer' ? 'Add fields for this signer' : 'CC recipients do not get fields'}
                  aria-label={`Select ${r.name || `recipient ${index + 1}`}`}
                />
                {sequential && <span className="text-xs text-dark-500">{index + 1}.</span>}
                {readOnly ? (
                  <span className="text-sm text-gray-200 truncate flex-1">{r.name}</span>
                ) : (
                  <input
                    value={r.name}
                    onChange={(e) => onChange(r.id, { name: e.target.value })}
                    onFocus={() => r.role === 'signer' && onActivate(r.id)}
                    placeholder="Name"
                    maxLength={200}
                    className="flex-1 min-w-0 bg-transparent text-sm text-gray-100 placeholder-dark-500 outline-none"
                    aria-label="Recipient name"
                  />
                )}
                {readOnly ? (
                  <span className="text-xs text-dark-400">{STATUS_TEXT[r.status]}</span>
                ) : (
                  <div className="flex items-center">
                    {sequential && (
                      <>
                        <button type="button" onClick={() => onMove(r.id, -1)} disabled={index === 0} className="p-0.5 text-dark-400 hover:text-white disabled:opacity-30" title="Move up"><ChevronUp size={14} /></button>
                        <button type="button" onClick={() => onMove(r.id, 1)} disabled={index === recipients.length - 1} className="p-0.5 text-dark-400 hover:text-white disabled:opacity-30" title="Move down"><ChevronDown size={14} /></button>
                      </>
                    )}
                    <button type="button" onClick={() => onRemove(r.id)} className="p-0.5 text-dark-400 hover:text-red-400" title="Remove recipient"><Trash2 size={14} /></button>
                  </div>
                )}
              </div>

              {readOnly ? (
                <p className="text-xs text-dark-400 truncate pl-6">{r.email}{r.role === 'cc' ? ' · CC' : ''}</p>
              ) : (
                <div className="flex gap-2 pl-6">
                  <input
                    type="email"
                    value={r.email}
                    onChange={(e) => onChange(r.id, { email: e.target.value })}
                    onFocus={() => r.role === 'signer' && onActivate(r.id)}
                    placeholder="Email"
                    maxLength={320}
                    className="flex-1 min-w-0 bg-dark-800 border border-dark-600 rounded px-2 py-1 text-xs text-gray-100 placeholder-dark-500"
                    aria-label="Recipient email"
                  />
                  <select
                    value={r.role}
                    onChange={(e) => onChange(r.id, { role: e.target.value })}
                    className="bg-dark-800 border border-dark-600 rounded px-1 py-1 text-xs text-gray-200"
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
          className="mt-2 w-full py-2 rounded-lg border border-dashed border-dark-600 text-sm text-dark-400 hover:text-white hover:border-blue-500 flex items-center justify-center gap-2"
        >
          <UserPlus size={14} />
          Add recipient
        </button>
      )}
    </section>
  )
}
