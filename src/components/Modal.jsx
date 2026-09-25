import { useEffect } from 'react'
import { X } from 'lucide-react'

/** Dialog: centered on larger screens, a bottom sheet on phones. Scrolls when taller than the screen. */
export default function Modal({ title, onClose, wide = false, children }) {
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center sm:p-4 animate-fade-in" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'sm:max-w-lg' : 'sm:max-w-md'} max-h-[92dvh] overflow-y-auto bg-white shadow-2xl ring-1 ring-gray-950/5 rounded-t-3xl sm:rounded-2xl px-5 pt-3 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] animate-sheet-up sm:animate-pop-in`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Phones: a grab handle, as on a native bottom sheet */}
        <div className="sm:hidden mx-auto mb-3 h-1 w-10 rounded-full bg-gray-200" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="text-lg text-gray-900 font-semibold tracking-[-0.01em]">{title}</h2>
          <button onClick={onClose} className="icon-btn w-8 h-8 -mr-1.5" title="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
