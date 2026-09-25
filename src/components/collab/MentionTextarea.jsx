import { useRef, useState } from 'react'
import Avatar from './Avatar'
import { displayName } from '../../lib/envelopeModel'

const MAX_SUGGESTIONS = 6

/**
 * A comment box where typing "@" suggests teammates; picking one inserts "@Full Name ".
 * `people` are those who can be mentioned; `hasAccess(id)` marks the ones who would first
 * need the envelope shared with them.
 */
export default function MentionTextarea({ value, onChange, onSubmit, people, hasAccess, placeholder, autoFocus = false, label }) {
  const ref = useRef(null)
  const [query, setQuery] = useState(null) // text typed after "@", or null when not mentioning
  const [active, setActive] = useState(0)

  const matches = query === null ? [] : people
    .filter(p => displayName(p).toLowerCase().includes(query.toLowerCase()) || p.email.toLowerCase().startsWith(query.toLowerCase()))
    .slice(0, MAX_SUGGESTIONS)

  // The "@..." being typed right before the caret, if any
  const readQuery = (text, caret) => {
    const match = /(?:^|\s)@([^\s@][^@\n]{0,30})?$/.exec(text.slice(0, caret))
    return match ? (match[1] ?? '') : null
  }

  const change = (e) => {
    onChange(e.target.value)
    setQuery(readQuery(e.target.value, e.target.selectionStart))
    setActive(0)
  }

  const pick = (person) => {
    const el = ref.current
    const caret = el.selectionStart
    const start = value.slice(0, caret).lastIndexOf('@')
    const inserted = `@${displayName(person)} `
    const next = value.slice(0, start) + inserted + value.slice(caret)
    onChange(next)
    setQuery(null)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + inserted.length, start + inserted.length)
    })
  }

  const keyDown = (e) => {
    if (matches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive(i => (i + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pick(matches[active])
        return
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        setQuery(null)
        return
      }
    }
    // Ctrl/Cmd+Enter posts
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={change}
        onKeyDown={keyDown}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        rows={2}
        maxLength={4000}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        className="w-full bg-white border border-gray-200 shadow-xs rounded-lg px-3 py-2 text-sm resize-y min-h-[2.75rem]"
      />
      {matches.length > 0 && (
        <ul role="listbox" aria-label="Mention a teammate" className="absolute z-20 left-0 right-0 bottom-full mb-1 max-h-60 overflow-y-auto rounded-xl bg-white shadow-lg ring-1 ring-gray-950/5 p-1 animate-pop-in">
          {matches.map((person, i) => (
            <li key={person.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); pick(person) }}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm ${i === active ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
              >
                <Avatar person={person} size="w-6 h-6 text-[10px]" />
                <span className="flex-1 min-w-0 truncate text-gray-900">{displayName(person)}</span>
                {!hasAccess(person.id) && <span className="text-[11px] text-amber-700 whitespace-nowrap">will get access</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
