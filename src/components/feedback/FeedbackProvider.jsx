import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import Modal from '../Modal'
import { FeedbackContext } from './useFeedback'

const TOAST_MS = { success: 5000, info: 6000, error: 9000 }
const MAX_TOASTS = 3

/** Dialogs and short messages for the whole app; use them through useFeedback(). */
export function FeedbackProvider({ children }) {
  const [dialog, setDialog] = useState(null) // { kind: 'confirm' | 'ask', ...options, resolve }
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const openDialog = useCallback((kind, options) => new Promise(resolve => {
    setDialog({ kind, ...options, resolve })
  }), [])

  const closeDialog = (result) => {
    dialog?.resolve(result)
    setDialog(null)
  }

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts(list => list.filter(t => t.id !== id))
  }, [])

  const notify = useCallback((message, { tone = 'success', action, duration } = {}) => {
    const id = crypto.randomUUID()
    setToasts(list => [...list, { id, message, tone, action }].slice(-MAX_TOASTS))
    timers.current.set(id, setTimeout(() => dismiss(id), duration ?? TOAST_MS[tone] ?? TOAST_MS.info))
    return id
  }, [dismiss])

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach(clearTimeout)
  }, [])

  const value = useMemo(() => ({
    confirm: (options) => openDialog('confirm', options),
    ask: (options) => openDialog('ask', options),
    notify,
    dismiss
  }), [openDialog, notify, dismiss])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      {dialog && <FeedbackDialog dialog={dialog} onClose={closeDialog} />}
      <Toasts toasts={toasts} onDismiss={dismiss} />
    </FeedbackContext.Provider>
  )
}

function FeedbackDialog({ dialog, onClose }) {
  const { kind, title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false } = dialog
  const [text, setText] = useState(dialog.defaultValue ?? '')
  // A one-line answer (e.g. initials) or a few lines (e.g. a reason)
  const TextField = dialog.multiline === false ? 'input' : 'textarea'
  const cancel = () => onClose(kind === 'ask' ? null : false)
  const submit = (e) => {
    e.preventDefault()
    if (kind === 'ask' && dialog.required && !text.trim()) return
    onClose(kind === 'ask' ? text.trim() : true)
  }

  return (
    <Modal title={title} onClose={cancel}>
      <form onSubmit={submit} className="space-y-4" data-testid="feedback-dialog">
        {message && <p className="text-sm text-gray-600 whitespace-pre-line">{message}</p>}
        {kind === 'ask' && (
          <label className="block">
            <span className="block text-sm text-gray-700 mb-1">{dialog.label}</span>
            <TextField
              {...(dialog.multiline === false ? {} : { rows: 3 })}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={dialog.maxLength ?? 1000}
              placeholder={dialog.placeholder}
              className="w-full bg-white border border-gray-200 shadow-xs rounded-lg px-3 py-2.5 text-sm resize-y"
            />
          </label>
        )}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {/* Risky actions start on Cancel, so Enter does not delete by accident */}
          <button type="button" onClick={cancel} autoFocus={kind === 'confirm' && danger} className="btn-secondary px-4 py-2.5 rounded-lg text-sm">
            {cancelLabel}
          </button>
          <button
            type="submit"
            autoFocus={kind === 'confirm' && !danger}
            disabled={kind === 'ask' && dialog.required && !text.trim()}
            className={`${danger ? 'btn-danger' : 'btn-primary'} px-4 py-2.5 rounded-lg text-sm`}
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const TONES = {
  success: { icon: CheckCircle2, className: 'text-emerald-400' },
  info: { icon: Info, className: 'text-blue-300' },
  error: { icon: AlertCircle, className: 'text-red-400' }
}

function Toasts({ toasts, onDismiss }) {
  return (
    <div className="fixed z-[60] inset-x-0 bottom-20 md:bottom-6 flex flex-col items-center gap-2 px-4 pointer-events-none" aria-live="polite">
      {toasts.map(t => {
        const { icon: Icon, className } = TONES[t.tone] ?? TONES.info
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            data-testid="toast"
            className="pointer-events-auto w-full max-w-md flex items-start gap-3 bg-gray-900/95 backdrop-blur text-white text-sm rounded-xl shadow-xl ring-1 ring-white/10 px-4 py-3 animate-toast-in"
          >
            <Icon size={18} className={`${className} flex-shrink-0 mt-px`} aria-hidden="true" />
            <p className="flex-1 min-w-0">{t.message}</p>
            {t.action && (
              <button
                onClick={() => { onDismiss(t.id); t.action.onClick() }}
                className="font-semibold text-blue-300 hover:text-blue-200 whitespace-nowrap"
              >
                {t.action.label}
              </button>
            )}
            <button onClick={() => onDismiss(t.id)} className="text-gray-400 hover:text-white" aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
