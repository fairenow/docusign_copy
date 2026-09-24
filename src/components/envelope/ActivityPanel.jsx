import { RefreshCw } from 'lucide-react'
import { RECIPIENT_STATUS } from '../../lib/envelopeModel'
import { ACTION_LABELS } from '../../../supabase/functions/_shared/labels.js'
import { formatDateTime } from '../../lib/format'


const WARNING_ACTIONS = new Set(['email_failed', 'finalize_failed', 'recipient_declined', 'envelope_voided', 'envelope_declined'])

/** Signer progress and the audit trail of a sent envelope. */
export default function ActivityPanel({ recipients, events, canResend, onResend, resendingId }) {
  const nameOf = (id) => recipients.find(r => r.id === id)?.name
  return (
    <>
      <section>
        <h2 className="section-heading mb-2">Signers</h2>
        <ul className="space-y-2">
          {recipients.map(r => (
            <li key={r.id} className="flex items-center gap-2 text-sm" data-testid="signer-status">
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.color }} />
              <span className="flex-1 min-w-0 truncate text-gray-200" title={r.email}>{r.name}{r.role === 'cc' ? ' (copy)' : ''}</span>
              <span className={`text-xs ${r.status === 'signed' ? 'text-green-300' : r.status === 'declined' ? 'text-red-300' : 'text-dark-400'}`}>
                {r.role === 'cc' ? 'Gets a copy' : RECIPIENT_STATUS[r.status]?.label}
              </span>
              {canResend && r.role === 'signer' && (r.status === 'sent' || r.status === 'viewed') && (
                <button
                  onClick={() => onResend(r)}
                  disabled={resendingId === r.id}
                  className="p-1 text-dark-400 hover:text-white disabled:opacity-50"
                  title={`Email ${r.name} a new signing link`}
                >
                  <RefreshCw size={13} className={resendingId === r.id ? 'animate-spin' : ''} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section-heading mb-2">Activity</h2>
        <ol className="space-y-2 border-l border-dark-600 pl-3" data-testid="activity">
          {events.map(e => (
            <li key={e.id} className="text-xs">
              <p className={WARNING_ACTIONS.has(e.action) ? 'text-amber-300' : 'text-gray-200'}>
                {ACTION_LABELS[e.action] ?? e.action}
                {nameOf(e.recipient_id) ? ` · ${nameOf(e.recipient_id)}` : ''}
              </p>
              <p className="text-dark-500">
                {formatDateTime(e.created_at)}
                {e.ip ? ` · ${e.ip}` : ''}
              </p>
            </li>
          ))}
        </ol>
      </section>
    </>
  )
}
