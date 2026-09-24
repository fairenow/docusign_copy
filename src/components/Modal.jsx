import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onPointerDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md bg-dark-800 border border-dark-600 rounded-2xl p-5"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg text-gray-100 font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 text-dark-400 hover:text-white" title="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
