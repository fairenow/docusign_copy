import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BellRing, FilePlus, FileText, Trash2, Ban, RefreshCw, Download, LayoutTemplate, Search } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { createEnvelopeFromFile, deleteDraft, downloadSignedPdf, listEnvelopes, resendSigningLink, subscribeToEnvelopeChanges, voidEnvelope } from '../lib/api'
import { formatDateTime } from '../lib/format'
import { ACCEPTED_FILE_TYPES, isConvertible } from '../lib/documents'
import {
  ENVELOPE_GROUPS, RECIPIENT_STATUS, STATUS_LABELS, canDelete, canVoid, envelopeGroup, envelopeProgress, groupEnvelopes, isMine, isOwner,
  matchesSearch, remindTargets, senderName
} from '../lib/envelopeModel'
import LoadingOverlay from '../components/LoadingOverlay'
import { SkeletonRows } from '../components/Skeleton'
import { useFeedback } from '../components/feedback/useFeedback'
import ErrorBanner from '../components/ErrorBanner'

// A deleted draft can be brought back this long, then it is deleted for good. Pending deletes
// outlive the page, so a draft stays hidden if you leave and come back within that time.
const UNDO_DELETE_MS = 6000
const pendingDeletes = new Set()

const PROGRESS_STYLES = {
  waiting: 'text-gray-700',
  warning: 'text-amber-700',
  done: 'text-green-700',
  problem: 'text-red-700',
  draft: 'text-gray-500'
}

const STATUS_STYLES = {
  draft: 'bg-gray-50 text-gray-600 ring-gray-500/20',
  sent: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  declined: 'bg-red-50 text-red-700 ring-red-600/20',
  voided: 'bg-gray-50 text-gray-500 ring-gray-500/20 line-through',
  expired: 'bg-amber-50 text-amber-800 ring-amber-600/20'
}

// The document icon beside each envelope, tinted by status
const ICON_STYLES = {
  draft: 'bg-gray-100 text-gray-500',
  sent: 'bg-blue-50 text-blue-600',
  completed: 'bg-emerald-50 text-emerald-600',
  declined: 'bg-red-50 text-red-600',
  voided: 'bg-gray-100 text-gray-400',
  expired: 'bg-amber-50 text-amber-600'
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth()
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
  const [hiddenIds, setHiddenIds] = useState(() => new Set(pendingDeletes))
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
    setBusy(isConvertible(file) ? 'Converting your Word document…' : 'Preparing your document…')
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
  const setHidden = (id, hidden) => {
    if (hidden) pendingDeletes.add(id)
    else pendingDeletes.delete(id)
    setHiddenIds(new Set(pendingDeletes))
  }

  const handleDelete = (envelope) => {
    const whose = isOwner(envelope, user) ? '' : ` by ${senderName(envelope)}`
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
    // The page's clock and the reminder time agree, so the wait reads exactly 10 minutes
    const at = new Date().toISOString()
    setNow(Date.parse(at))
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
    <div className="flex-1 px-4 pt-6 pb-8 sm:px-8 sm:pt-10 max-w-6xl w-full mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6 sm:mb-8">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="page-title text-[2.5rem] sm:text-5xl">Envelopes</h1>
            <button onClick={refresh} className="icon-btn w-9 h-9 text-gray-400" title="Refresh">
              <RefreshCw size={17} />
            </button>
          </div>
          <p className="mt-2 text-sm text-gray-500">Send, sign and track every agreement in one place.</p>
        </div>
        <div className="grid grid-cols-2 sm:flex gap-2 w-full sm:w-auto">
          <Link to="/templates" className="btn-secondary px-4 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2 whitespace-nowrap">
            <LayoutTemplate size={16} />
            Use a template
          </Link>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2.5 btn-primary rounded-lg text-sm flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <FilePlus size={16} />
            New envelope
          </button>
          <input ref={fileInputRef} type="file" accept={ACCEPTED_FILE_TYPES} onChange={handleNewEnvelope} className="hidden" data-testid="new-envelope-input" />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label className="relative flex-1 min-w-[12rem] max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isAdmin && scope === 'everyone' ? 'Search by title, sender or recipient' : 'Search by title or recipient'}
            aria-label="Search envelopes"
            className="w-full pl-9 pr-3 py-2.5 bg-white border border-gray-200 shadow-xs rounded-lg text-sm placeholder:text-gray-400"
          />
        </label>
        {isAdmin && (
          <div className="segmented" role="group" aria-label="Whose envelopes">
            {[['mine', 'Mine'], ['everyone', 'Everyone']].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setScope(id)}
                aria-pressed={scope === id}
                className="segmented-item"
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-1.5 mb-5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 [scrollbar-width:none]" role="tablist">
        {ENVELOPE_GROUPS.map(g => (
          <button
            key={g.id}
            role="tab"
            aria-selected={group === g.id}
            onClick={() => setGroup(g.id)}
            className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap flex-shrink-0 transition-colors ring-1 ring-inset ${
              group === g.id ? 'bg-gray-900 text-white ring-gray-900' : 'bg-white text-gray-600 ring-gray-200 hover:text-gray-900 hover:ring-gray-300'
            }`}
          >
            {g.label}
            {groups[g.id].length ? <span className={`ml-1.5 text-xs tabular-nums ${group === g.id ? 'text-white/70' : 'text-gray-400'}`}>{groups[g.id].length}</span> : null}
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
        <ul className="card divide-y divide-gray-100 overflow-hidden">
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
    <li className="group relative flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3.5 transition-colors hover:bg-gray-50/80" data-testid="envelope-row">
      <span className={`hidden sm:flex w-10 h-10 flex-shrink-0 rounded-lg items-center justify-center ${ICON_STYLES[envelope.status]}`} aria-hidden="true">
        <FileText size={18} />
      </span>
      <Link
        to={envelopeGroup(envelope, user) === 'action' ? `/envelopes/${envelope.id}/sign` : `/envelopes/${envelope.id}`}
        className="basis-full sm:basis-auto sm:flex-1 min-w-0"
      >
        <p className="text-gray-900 font-semibold tracking-[-0.005em] truncate group-hover:text-blue-700 transition-colors">{envelope.title}</p>
        {!isOwner(envelope, user) && (
          <p className="text-xs text-gray-600 truncate">Sent by {senderName(envelope)}</p>
        )}
        {progress.text && (
          <p className={`text-xs truncate ${PROGRESS_STYLES[progress.tone]}`} data-testid="envelope-progress">{progress.text}</p>
        )}
        <p className="text-xs text-gray-400 truncate mt-0.5">
          {recipients.length
            ? recipients.map(r => `${RECIPIENT_STATUS[r.status]?.icon ?? ''} ${r.name}${r.role === 'cc' ? ' (cc)' : ''}`).join('   ')
            : 'No recipients yet'}
        </p>
      </Link>
      <span className={`pill ${STATUS_STYLES[envelope.status]}`}>
        {STATUS_LABELS[envelope.status]}
      </span>
      <span className="flex-1 sm:flex-none text-xs text-gray-400 sm:w-40 sm:text-right whitespace-nowrap tabular-nums">{updated}</span>
      {remind.recipients.length > 0 && (
        <button
          onClick={onRemind}
          disabled={reminding || remindWait > 0}
          className="btn-secondary px-2.5 py-1.5 rounded-md text-xs flex items-center gap-1.5 whitespace-nowrap"
          title={remindWait > 0
            ? `Reminded a few minutes ago. You can remind again in ${remindWait} min.`
            : `Email ${remind.recipients.map(r => r.name).join(' and ')} a new signing link`}
        >
          <BellRing size={13} /> {reminding ? 'Reminding…' : 'Remind'}
        </button>
      )}
      <div className="w-8 flex justify-end">
        {envelope.status === 'completed' && envelope.final_path && (
          <button onClick={onDownload} className="icon-btn w-8 h-8" title="Download signed PDF">
            <Download size={16} />
          </button>
        )}
        {canDelete(envelope, user, isAdmin) && (
          <button onClick={onDelete} className="icon-btn w-8 h-8 hover:text-red-600 hover:bg-red-50" title="Delete draft">
            <Trash2 size={16} />
          </button>
        )}
        {canVoid(envelope, user, isAdmin) && (
          <button onClick={onVoid} className="icon-btn w-8 h-8 hover:text-red-600 hover:bg-red-50" title="Void envelope">
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
    <div className="card py-16 px-6 text-center">
      <span className="mx-auto mb-4 w-12 h-12 rounded-xl bg-gray-100 text-gray-400 flex items-center justify-center" aria-hidden="true"><FileText size={22} /></span>
      <p className="text-gray-600 mb-4">{EMPTY_MESSAGES[group]}</p>
      {group === 'all' || group === 'draft' ? (
        <button onClick={onNew} className="btn-primary px-4 py-2.5 rounded-lg text-sm">Upload a document to start an envelope</button>
      ) : null}
    </div>
  )
}
