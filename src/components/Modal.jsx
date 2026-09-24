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
    <div className="fixed inset-0 z-50 bg-gray-900/40 flex items-end sm:items-center justify-center sm:p-4" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'sm:max-w-lg' : 'sm:max-w-md'} max-h-[92dvh] overflow-y-auto bg-white border border-gray-300 rounded-t-2xl sm:rounded-2xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]`}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg text-gray-900 font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 text-gray-500 hover:text-gray-900" title="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
