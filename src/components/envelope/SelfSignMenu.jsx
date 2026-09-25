import { useEffect, useRef } from 'react'
import { signingDate } from '../../../supabase/functions/_shared/signing.js'

const KINDS = [['signature', 'Your signatures'], ['initials', 'Your initials']]

/**
 * Signing your own document: today's date and your signatures and initials, ready to place.
 * Picking one hands it to `onPick(type, image?)`, which makes it follow the pointer until it is
 * clicked onto the page. `current` is the image in use for each kind, listed first.
 */
export default function SelfSignMenu({ saved, current, onPick, onCreate, onClose }) {
  const ref = useRef(null)

  // Closes on Esc or a click anywhere else
  useEffect(() => {
    const onPointerDown = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const imagesOf = (kind) => {
    const images = saved.filter(s => s.kind === kind).map(s => s.image)
    return [...new Set([current[kind], ...images].filter(Boolean))]
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Sign"
      className="fixed md:absolute inset-x-2 bottom-2 md:inset-x-auto md:bottom-auto md:left-full md:top-2 md:ml-2 z-40 md:w-64 max-h-[70dvh] overflow-y-auto rounded-2xl md:rounded-xl bg-white shadow-xl ring-1 ring-gray-950/5 p-4 md:p-3 space-y-3 animate-pop-in"
    >
      <section>
        <h3 className="section-heading mb-1.5">Date stamp</h3>
        <button
          type="button"
          role="menuitem"
          onClick={() => onPick('date')}
          className="w-full rounded-md border border-dashed border-gray-300 py-2 text-sm text-gray-900 hover:border-blue-600 hover:bg-blue-50"
        >
          {signingDate()}
        </button>
      </section>
      {KINDS.map(([kind, heading]) => (
        <section key={kind}>
          <h3 className="section-heading mb-1.5">{heading}</h3>
          <div className="space-y-1.5">
            {imagesOf(kind).map((image, i) => (
              <button
                key={image}
                type="button"
                role="menuitem"
                onClick={() => onPick(kind, image)}
                aria-label={`Place your ${kind}${i ? ` ${i + 1}` : ''}`}
                className="w-full h-12 rounded-md border border-dashed border-gray-300 bg-white p-1 hover:border-blue-600 hover:bg-blue-50"
              >
                <img src={image} alt="" className="w-full h-full object-contain" draggable={false} />
              </button>
            ))}
            <button type="button" role="menuitem" onClick={() => onCreate(kind)} className="w-full text-left text-sm text-blue-700 hover:underline">
              {kind === 'signature' ? 'Create your signature…' : 'Create your initials…'}
            </button>
          </div>
        </section>
      ))}
    </div>
  )
}
