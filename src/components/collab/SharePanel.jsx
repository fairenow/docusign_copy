import { useState } from 'react'
import { UserPlus, X } from 'lucide-react'
import Avatar from './Avatar'
import { displayName } from '../../lib/envelopeModel'

/**
 * Who on the team can see this envelope, and sharing it with a teammate (view and comment,
 * never edit or sign). The owner and admins share; anyone it is shared with can leave.
 */
export default function SharePanel({ envelope, team, me, canShare, onShare, onUnshare }) {
  const [choice, setChoice] = useState('')
  const [busy, setBusy] = useState(null)
  const byId = new Map(team.map(p => [p.id, p]))
  const owner = byId.get(envelope.owner_id) ?? { id: envelope.owner_id, full_name: envelope.owner?.full_name, email: envelope.owner?.email }
  const shares = envelope.envelope_shares ?? []
  const sharedIds = new Set(shares.map(s => s.user_id))
  const candidates = team.filter(p => p.id !== envelope.owner_id && !sharedIds.has(p.id))

  const run = async (key, action) => {
    setBusy(key)
    try {
      await action()
    } finally {
      setBusy(null)
    }
  }

  return (
    <section data-testid="share-panel">
      <h2 className="section-heading mb-2">People with access</h2>
      <ul className="space-y-2 mb-3">
        <li className="flex items-center gap-2.5 text-sm">
          <Avatar person={owner} />
          <span className="flex-1 min-w-0 truncate text-gray-800">{displayName(owner)}{owner.id === me?.id ? ' (you)' : ''}</span>
          <span className="text-xs text-gray-400">Owner</span>
        </li>
        {shares.map(s => {
          const person = byId.get(s.user_id) ?? { id: s.user_id }
          const mine = s.user_id === me?.id
          return (
            <li key={s.user_id} className="flex items-center gap-2.5 text-sm" data-testid="shared-with">
              <Avatar person={person} />
              <span className="flex-1 min-w-0 truncate text-gray-800">{displayName(person)}{mine ? ' (you)' : ''}</span>
              <span className="text-xs text-gray-400">Can comment</span>
              {(canShare || mine) && (
                <button
                  onClick={() => run(s.user_id, () => onUnshare(s.user_id))}
                  disabled={busy === s.user_id}
                  className="icon-btn w-7 h-7 hover:text-red-600 hover:bg-red-50"
                  title={mine ? 'Leave: stop seeing this envelope' : `Stop sharing with ${displayName(person)}`}
                  aria-label={mine ? 'Leave' : `Stop sharing with ${displayName(person)}`}
                >
                  <X size={14} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {canShare && candidates.length > 0 && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (choice) run('add', async () => { await onShare(choice); setChoice('') })
          }}
        >
          <select
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            aria-label="Teammate to share with"
            className="flex-1 min-w-0 bg-white border border-gray-200 shadow-xs rounded-lg px-2.5 py-2 text-sm"
          >
            <option value="">Share with a teammate…</option>
            {candidates.map(p => <option key={p.id} value={p.id}>{displayName(p)}</option>)}
          </select>
          <button type="submit" disabled={!choice || busy === 'add'} className="btn-secondary px-3 py-2 rounded-lg text-sm flex items-center gap-1.5">
            <UserPlus size={15} /> Share
          </button>
        </form>
      )}
      <p className="text-xs text-gray-500 mt-2">Shared teammates can view and comment; only the owner can change or send it. Admins can see every envelope.</p>
    </section>
  )
}
