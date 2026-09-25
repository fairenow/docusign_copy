import { useEffect, useRef, useState } from 'react'
import { Check, CornerDownRight, MapPin, RotateCcw, Trash2, X } from 'lucide-react'
import Avatar from './Avatar'
import MentionTextarea from './MentionTextarea'
import { commentThreads, displayName, mentionsIn } from '../../lib/envelopeModel'
import { timeAgo } from '../../lib/format'

/**
 * Internal team comments on an envelope: threads with replies, pinned to the page or not,
 * @mentions (emailed), resolve and reopen. Signers outside the team never see any of it.
 *
 * pins: comment id -> its number on the page. pendingPin: where the next comment will be pinned.
 */
export default function CommentsPanel({
  comments, team, me, canShare, hasAccess, onPost, onResolve, onDelete,
  pins, focusId, onFocus, pinning, pendingPin, onPinStart, onPinClear, notify
}) {
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const byId = new Map(team.map(p => [p.id, p]))
  // Anyone can be mentioned by someone who can share (they are given access); others mention
  // only teammates who can already see the envelope
  const mentionable = team.filter(p => p.id !== me?.id && (canShare || hasAccess(p.id)))

  const threads = commentThreads(comments)
  const open = threads.filter(t => !t.resolved_at)
  const resolved = threads.filter(t => t.resolved_at)

  const post = async (body, extra = {}) => {
    const text = body.trim()
    if (!text) return false
    setPosting(true)
    try {
      await onPost({ body: text, mentions: mentionsIn(text, mentionable), ...extra })
      return true
    } catch (err) {
      notify(`Could not post the comment: ${err.message}`, { tone: 'error' })
      return false
    } finally {
      setPosting(false)
    }
  }

  const submit = async () => {
    if (await post(draft, { pin: pendingPin })) {
      setDraft('')
      onPinClear()
    }
  }

  return (
    <section className="flex flex-col gap-4" data-testid="comments-panel">
      <div className="flex items-center justify-between">
        <h2 className="section-heading">Comments{open.length ? ` · ${open.length} open` : ''}</h2>
        {resolved.length > 0 && (
          <button onClick={() => setShowResolved(v => !v)} className="text-xs font-medium text-gray-500 hover:text-gray-900">
            {showResolved ? 'Hide' : 'Show'} resolved ({resolved.length})
          </button>
        )}
      </div>

      {threads.length === 0 && (
        <p className="text-sm text-gray-500">No comments yet. Ask a teammate a question, or pin a note to a spot on the page. Type @ to mention someone.</p>
      )}

      <ul className="space-y-3">
        {[...open, ...(showResolved ? resolved : [])].map(thread => (
          <Thread
            key={thread.id}
            thread={thread}
            byId={byId}
            me={me}
            number={pins.get(thread.id)}
            focused={focusId === thread.id}
            onFocus={() => onFocus(thread)}
            onReply={(body) => post(body, { parentId: thread.id })}
            onResolve={(value) => onResolve(thread.id, value).catch(err => notify(err.message, { tone: 'error' }))}
            onDelete={(id) => onDelete(id).catch(err => notify(err.message, { tone: 'error' }))}
            mentionable={mentionable}
            hasAccess={hasAccess}
          />
        ))}
      </ul>

      <div className="rounded-xl bg-gray-50 ring-1 ring-inset ring-gray-200/80 p-2.5 space-y-2">
        <MentionTextarea
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          people={mentionable}
          hasAccess={hasAccess}
          placeholder="Add a comment… Type @ to mention"
          label="New comment"
        />
        <div className="flex items-center gap-2">
          {pendingPin ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-800 ring-1 ring-inset ring-blue-200 px-2 py-0.5 text-xs font-medium">
              <MapPin size={12} /> Pinned to page {pendingPin.page}
              <button onClick={onPinClear} className="ml-0.5 hover:text-blue-950" aria-label="Remove the pin"><X size={12} /></button>
            </span>
          ) : (
            <button
              onClick={onPinStart}
              aria-pressed={pinning}
              className={`inline-flex items-center gap-1 text-xs font-medium rounded-md px-2 py-1 ${pinning ? 'bg-blue-50 text-blue-800' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}
              title="Click a spot on the page to pin this comment there"
            >
              <MapPin size={13} /> {pinning ? 'Click the page…' : 'Pin to page'}
            </button>
          )}
          <button onClick={submit} disabled={!draft.trim() || posting} className="ml-auto btn-primary px-3.5 py-1.5 rounded-lg text-sm">
            {posting ? 'Posting…' : 'Comment'}
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400 -mt-2">Only your team sees comments. They are never shown to signers or added to the PDF.</p>
    </section>
  )
}

function Thread({ thread, byId, me, number, focused, onFocus, onReply, onResolve, onDelete, mentionable, hasAccess }) {
  const [replying, setReplying] = useState(false)
  const [reply, setReply] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focused])

  const sendReply = async () => {
    if (await onReply(reply)) {
      setReply('')
      setReplying(false)
    }
  }

  return (
    <li
      ref={ref}
      className={`rounded-xl bg-white ring-1 ring-inset p-3 transition-shadow ${focused ? 'ring-blue-400 shadow-focus' : 'ring-gray-200'} ${thread.resolved_at ? 'opacity-70' : ''}`}
      data-testid="comment-thread"
    >
      <Comment comment={thread} author={byId.get(thread.author_id)} mine={thread.author_id === me?.id} byId={byId} onDelete={() => onDelete(thread.id)}>
        {number !== undefined && (
          <button onClick={onFocus} className="inline-flex items-center gap-1 rounded-full bg-gray-900 text-white px-1.5 py-px text-[10px] font-semibold" title={`Show on page ${thread.page}`}>
            {number} · p.{thread.page}
          </button>
        )}
      </Comment>

      {thread.replies.map(r => (
        <div key={r.id} className="mt-3 pl-3 border-l-2 border-gray-100">
          <Comment comment={r} author={byId.get(r.author_id)} mine={r.author_id === me?.id} byId={byId} onDelete={() => onDelete(r.id)} />
        </div>
      ))}

      {thread.resolved_at && (
        <p className="mt-2 text-xs text-emerald-700 flex items-center gap-1">
          <Check size={12} /> Resolved by {displayName(byId.get(thread.resolved_by))} {timeAgo(thread.resolved_at)}
        </p>
      )}

      {replying ? (
        <div className="mt-3 space-y-2">
          <MentionTextarea value={reply} onChange={setReply} onSubmit={sendReply} people={mentionable} hasAccess={hasAccess} placeholder="Reply…" label="Reply" autoFocus />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setReplying(false); setReply('') }} className="btn-secondary px-3 py-1.5 rounded-lg text-sm">Cancel</button>
            <button onClick={sendReply} disabled={!reply.trim()} className="btn-primary px-3 py-1.5 rounded-lg text-sm">Reply</button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-3 text-xs font-medium">
          {!thread.resolved_at && (
            <button onClick={() => setReplying(true)} className="text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><CornerDownRight size={12} /> Reply</button>
          )}
          {thread.resolved_at
            ? <button onClick={() => onResolve(false)} className="text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><RotateCcw size={12} /> Reopen</button>
            : <button onClick={() => onResolve(true)} className="text-gray-500 hover:text-emerald-700 inline-flex items-center gap-1"><Check size={12} /> Resolve</button>}
        </div>
      )}
    </li>
  )
}

function Comment({ comment, author, mine, byId, onDelete, children }) {
  return (
    <div className="group">
      <div className="flex items-center gap-2">
        <Avatar person={author} size="w-6 h-6 text-[10px]" />
        <span className="text-sm font-semibold text-gray-900 truncate">{displayName(author)}</span>
        <span className="text-xs text-gray-400 whitespace-nowrap">{timeAgo(comment.created_at)}</span>
        {children}
        {mine && (
          <button onClick={onDelete} className="ml-auto icon-btn w-6 h-6 opacity-0 group-hover:opacity-100 focus:opacity-100 pointer-coarse:opacity-100 hover:text-red-600 hover:bg-red-50" title="Delete comment" aria-label="Delete comment">
            <Trash2 size={12} />
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-800 whitespace-pre-wrap break-words" data-testid="comment-body">
        <Highlighted body={comment.body} mentioned={(comment.mentions ?? []).map(id => byId.get(id)).filter(Boolean)} />
      </p>
    </div>
  )
}

/** The comment text with its @mentions highlighted. */
function Highlighted({ body, mentioned }) {
  const names = mentioned.map(p => `@${displayName(p)}`).sort((a, b) => b.length - a.length)
  if (!names.length) return body
  const escaped = names.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return body.split(new RegExp(`(${escaped.join('|')})`, 'g')).map((part, i) => (
    names.includes(part) ? <span key={i} className="font-medium text-blue-700 bg-blue-50 rounded px-0.5">{part}</span> : part
  ))
}
