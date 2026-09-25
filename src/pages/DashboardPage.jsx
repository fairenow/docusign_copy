import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BellRing, FilePlus, Trash2, Ban, RefreshCw, Download, LayoutTemplate, Search } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { createEnvelopeFromFile, deleteDraft, downloadSignedPdf, listEnvelopes, resendSigningLink, subscribeToEnvelopeChanges, voidEnvelope } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { ACCEPTED_FILE_TYPES, CONVERTIBLE_EXTENSIONS } from '../lib/documents'
import {
  ENVELOPE_GROUPS, RECIPIENT_STATUS, STATUS_LABELS, canDelete, canVoid, envelopeGroup, envelopeProgress, groupEnvelopes, isMine,
  matchesSearch, remindTargets, senderName
} from '../lib/envelopeModel'
import LoadingOverlay from '../components/LoadingOverlay'
import { SkeletonRows } from '../components/Skeleton'
import { useFeedback } from '../components/feedback/useFeedback'
import ErrorBanner from '../components/ErrorBanner'

// A deleted draft can be brought back this long, then it is deleted for good
const UNDO_DELETE_MS = 6000

const PROGRESS_STYLES = {
  waiting: 'text-gray-700',
  warning: 'text-amber-700',
  done: 'text-green-700',
  problem: 'text-red-700',
  draft: 'text-gray-500'
}

const STATUS_STYLES = {
  draft: 'bg-gray-200 text-gray-800',
  sent: 'bg-blue-500/15 text-blue-700',
  completed: 'bg-green-500/15 text-green-700',
  declined: 'bg-red-500/15 text-red-700',
  voided: 'bg-gray-200 text-gray-500 line-through',
  expired: 'bg-amber-500/15 text-amber-800'
}

export default function DashboardPage() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const navigate = useNavigate()
  const fileInputRef = useRef(null)
  const [envelopes, setEnvelopes] = useState(null)
  const [error, setError] = useState(null)
  const [group, setGroup] = useState('all')
  const [busy, setBusy] = useState(null) // what is being done, shown over the page
  // Admins see everyone's envelopes; "Mine" narrows that to what they sent or were sent
  const [scope, setScope] = useState('mine') // 'mine' | 'everyone'
  const [query, setQuery] = useState('')
  const { ask, notify } = useFeedback()
  // Drafts deleted a moment ago, hidden until the undo window passes
  const [hiddenIds, setHiddenIds] = useState(() => new Set())
  // "sent 3 min ago" stays true while the page is open
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  const [reminding, setReminding] = useState(null)

  const refresh = useCallback(async () => {
    try {
      setEnvelopes(await listEnvelopes())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  // Initial load, then refetch (debounced) whenever Realtime reports a change
  useEffect(() => {
    refresh()
    let timer = null
    const unsubscribe = subscribeToEnvelopeChanges(() => {
      clearTimeout(timer)
      timer = setTimeout(refresh, 300)
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [refresh])

  const shown = useMemo(() => (envelopes ?? []).filter(e =>
    !hiddenIds.has(e.id) && (!isAdmin || scope === 'everyone' || isMine(e, user)) && matchesSearch(e, query)
  ), [envelopes, hiddenIds, isAdmin, scope, user, query])
  const groups = useMemo(() => groupEnvelopes(shown, user), [shown, user])
  const visible = groups[group]

  const handleNewEnvelope = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const isWord = CONVERTIBLE_EXTENSIONS.includes(file.name.split('.').pop().toLowerCase())
    setBusy(isWord ? 'Converting your Word document…' : 'Preparing your document…')
    try {
      const id = await createEnvelopeFromFile(file)
      navigate(`/envelopes/${id}`)
    } catch (err) {
      notify(`Could not create the envelope: ${err.message}`, { tone: 'error' })
      setBusy(null)
    }
  }

  // Deleting hides the draft at once and offers Undo; it is deleted when that runs out (even
  // if you have moved to another page meanwhile)
  const setHidden = (id, hidden) => setHiddenIds(ids => {
    const next = new Set(ids)
    if (hidden) next.add(id)
    else next.delete(id)
    return next
  })

  const handleDelete = (envelope) => {
    const whose = envelope.owner_id === user?.id ? '' : ` by ${senderName(envelope)}`
    setHidden(envelope.id, true)
    const timer = setTimeout(async () => {
      try {
        await deleteDraft(envelope)
        setEnvelopes(list => list?.filter(e => e.id !== envelope.id))
      } catch (err) {
        notify(`Could not delete "${envelope.title}": ${err.message}`, { tone: 'error' })
      }
      setHidden(envelope.id, false)
    }, UNDO_DELETE_MS)
    notify(`Deleted the draft "${envelope.title}"${whose}.`, {
      duration: UNDO_DELETE_MS,
      action: {
        label: 'Undo',
        onClick: () => {
          clearTimeout(timer)
          setHidden(envelope.id, false)
        }
      }
    })
  }

  const handleDownload = async (envelope) => {
    try {
      await downloadSignedPdf(envelope)
    } catch (err) {
      notify(`Could not download: ${err.message}`, { tone: 'error' })
    }
  }

  // Email a fresh link to the signers whose turn it is
  const handleRemind = async (envelope) => {
    const { recipients } = remindTargets(envelope, user)
    if (!recipients.length) return
    setReminding(envelope.id)
    const results = await Promise.allSettled(recipients.map(r => resendSigningLink(envelope.id, r.id)))
    setReminding(null)
    setNow(Date.now())
    const at = new Date().toISOString()
    const done = recipients.filter((_, i) => results[i].status === 'fulfilled')
    setEnvelopes(list => list.map(e => (e.id !== envelope.id ? e : {
      ...e,
      recipients: e.recipients.map(r => (done.some(d => d.id === r.id) ? { ...r, last_reminded_at: at } : r))
    })))
    if (done.length) notify(`Reminded ${done.map(r => r.name).join(' and ')}.`)
    const failed = results.find(r => r.status === 'rejected')
    if (failed) notify(`Could not send a reminder: ${failed.reason.message}`, { tone: 'error' })
  }

  const handleVoid = async (envelope) => {
    const reason = await ask({
      title: `Void "${envelope.title}"?`,
      message: 'Signers will no longer be able to open or sign it. This cannot be undone.',
      label: 'Reason (optional, shown in the activity)',
      confirmLabel: 'Void envelope',
      danger: true
    })
    if (reason === null) return
    try {
      const voided = await voidEnvelope(envelope.id, reason)
      setEnvelopes(list => list.map(e => (e.id === envelope.id ? { ...e, ...voided, recipients: e.recipients } : e)))
      notify(`Voided "${envelope.title}".`)
    } catch (err) {
      notify(`Could not void the envelope: ${err.message}`, { tone: 'error' })
    }
  }

  return (
    <div className="flex-1 p-4 sm:p-6 max-w-6xl w-full mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 sm:mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl text-gray-900 font-semibold">Envelopes</h1>
          <button onClick={refresh} className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100" title="Refresh">
            <RefreshCw size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
          <Link to="/templates" className="btn-secondary px-4 py-2.5 sm:py-2 rounded-lg text-sm flex items-center justify-center gap-2 whitespace-nowrap">
            <LayoutTemplate size={16} />
            Use a template
          </Link>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2.5 sm:py-2 btn-primary rounded-lg text-white text-sm flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <FilePlus size={16} />
            New envelope
          </button>
          <input ref={fileInputRef} type="file" accept={ACCEPTED_FILE_TYPES} onChange={handleNewEnvelope} className="hidden" data-testid="new-envelope-input" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="relative flex-1 min-w-[12rem] max-w-md">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAdmin && scope === 'everyone' ? 'Search by title, sender or recipient' : 'Search by title or recipient'}
            aria-label="Search envelopes"
            className="w-full pl-8 pr-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
          />
        </label>
        {isAdmin && (
          <div className="flex rounded-lg border border-gray-300 bg-white p-0.5 text-sm" role="group" aria-label="Whose envelopes">
            {[['mine', 'Mine'], ['everyone', 'Everyone']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setScope(id)}
                aria-pressed={scope === id}
                className={`px-3 py-1.5 rounded-md ${scope === id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist">
        {ENVELOPE_GROUPS.map(g => (
          <button
            key={g.id}
            role="tab"
            aria-selected={group === g.id}
            onClick={() => setGroup(g.id)}
            className={`px-3 sm:px-4 py-2 text-sm -mb-px border-b-2 whitespace-nowrap flex-shrink-0 transition-colors ${
              group === g.id ? 'border-blue-500 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            {g.label}
            {groups[g.id].length ? <span className="ml-2 text-xs text-gray-500">{groups[g.id].length}</span> : null}
          </button>
        ))}
      </div>

      <ErrorBanner>{error}</ErrorBanner>

      {envelopes === null && !error ? (
        <SkeletonRows />
      ) : visible.length === 0 ? (
        query.trim()
          ? <p className="py-16 text-center text-gray-500">No envelopes match “{query.trim()}”.</p>
          : <EmptyState group={group} onNew={() => fileInputRef.current?.click()} />
      ) : (
        <ul className="divide-y divide-gray-200 bg-white border border-gray-200 rounded-xl overflow-hidden">
          {visible.map(envelope => (
            <EnvelopeRow
              key={envelope.id}
              envelope={envelope}
              user={user}
              isAdmin={isAdmin}
              now={now}
              reminding={reminding === envelope.id}
              onRemind={() => handleRemind(envelope)}
              onDelete={() => handleDelete(envelope)}
              onVoid={() => handleVoid(envelope)}
              onDownload={() => handleDownload(envelope)}
            />
          ))}
        </ul>
      )}

      <LoadingOverlay visible={Boolean(busy)} message={busy} />
    </div>
  )
}

function EnvelopeRow({ envelope, user, isAdmin, now, reminding, onRemind, onDelete, onVoid, onDownload }) {
  const recipients = [...envelope.recipients].sort((a, b) => a.routing_order - b.routing_order)
  const updated = formatDateTime(envelope.updated_at)
  const progress = envelopeProgress(envelope, user, now)
  const remind = canVoid(envelope, user, isAdmin) ? remindTargets(envelope, user, now) : { recipients: [] }
  const remindWait = remind.availableAt ? Math.ceil((remind.availableAt - now) / 60_000) : 0

  return (
    <li className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-gray-50" data-testid="envelope-row">
      <Link
        to={envelopeGroup(envelope, user) === 'action' ? `/envelopes/${envelope.id}/sign` : `/envelopes/${envelope.id}`}
        className="basis-full sm:basis-auto sm:flex-1 min-w-0"
      >
        <p className="text-gray-900 font-medium truncate">{envelope.title}</p>
        {envelope.owner_id !== user?.id && (
          <p className="text-xs text-gray-600 truncate">Sent by {senderName(envelope)}</p>
        )}
        {progress.text && (
          <p className={`text-xs truncate ${PROGRESS_STYLES[progress.tone]}`} data-testid="envelope-progress">{progress.text}</p>
        )}
        <p className="text-xs text-gray-500 truncate">
          {recipients.length
            ? recipients.map(r => `${RECIPIENT_STATUS[r.status]?.icon ?? ''} ${r.name}${r.role === 'cc' ? ' (cc)' : ''}`).join('   ')
            : 'No recipients yet'}
        </p>
      </Link>
      <span className={`px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${STATUS_STYLES[envelope.status]}`}>
        {STATUS_LABELS[envelope.status]}
      </span>
      <span className="flex-1 sm:flex-none text-xs text-gray-500 sm:w-40 sm:text-right whitespace-nowrap">{updated}</span>
      {remind.recipients.length > 0 && (
        <button
          onClick={onRemind}
          disabled={reminding || remindWait > 0}
          className="btn-secondary px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 whitespace-nowrap"
          title={remindWait > 0
            ? `Reminded a few minutes ago. You can remind again in ${remindWait} min.`
            : `Email ${remind.recipients.map(r => r.name).join(' and ')} a new signing link`}
        >
          <BellRing size={13} /> {reminding ? 'Reminding…' : 'Remind'}
        </button>
      )}
      <div className="w-8 flex justify-end">
        {envelope.status === 'completed' && envelope.final_path && (
          <button onClick={onDownload} className="p-1.5 rounded text-gray-500 hover:text-gray-900 hover:bg-gray-100" title="Download signed PDF">
            <Download size={16} />
          </button>
        )}
        {canDelete(envelope, user, isAdmin) && (
          <button onClick={onDelete} className="p-1.5 rounded text-gray-500 hover:text-red-600 hover:bg-gray-100" title="Delete draft">
            <Trash2 size={16} />
          </button>
        )}
        {canVoid(envelope, user, isAdmin) && (
          <button onClick={onVoid} className="p-1.5 rounded text-gray-500 hover:text-red-600 hover:bg-gray-100" title="Void envelope">
            <Ban size={16} />
          </button>
        )}
      </div>
    </li>
  )
}

const EMPTY_MESSAGES = {
  action: 'Nothing needs your signature right now.',
  waiting: 'No envelopes are waiting on other people.',
  draft: 'No drafts.',
  completed: 'No completed envelopes yet.',
  all: 'No envelopes yet.'
}

function EmptyState({ group, onNew }) {
  return (
    <div className="py-16 text-center">
      <p className="text-gray-500 mb-4">{EMPTY_MESSAGES[group]}</p>
      {group === 'all' || group === 'draft' ? (
        <button onClick={onNew} className="text-blue-600 hover:underline text-sm">Upload a document to start an envelope</button>
      ) : null}
    </div>
  )
}
