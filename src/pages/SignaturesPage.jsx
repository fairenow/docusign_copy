import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { useSavedSignatures } from '../hooks/useSavedSignatures'
import { initialsOf } from '../../supabase/functions/_shared/signing.js'
import SignaturePanel from '../components/SignaturePanel'
import Modal from '../components/Modal'
import ErrorBanner from '../components/ErrorBanner'
import { useFeedback } from '../components/feedback/useFeedback'

const KINDS = [
  { kind: 'signature', title: 'Signatures', noun: 'signature' },
  { kind: 'initials', title: 'Initials', noun: 'initials' }
]

/** Manage the signatures and initials offered when you sign. */
export default function SignaturesPage() {
  const { user, profile } = useAuth()
  const { saved, error: loadError, save, remove } = useSavedSignatures(Boolean(user))
  const [creating, setCreating] = useState(null) // 'signature' | 'initials'
  const [error, setError] = useState(null)
  const name = profile?.full_name || ''
  const { confirm } = useFeedback()

  const run = async (fn) => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="max-w-4xl w-full mx-auto px-4 sm:px-8 pt-6 pb-8 sm:pt-10">
      <h1 className="page-title text-[2.5rem] sm:text-5xl">My signatures</h1>
      <p className="text-sm text-gray-500 mt-2 mb-6 sm:mb-8">Saved signatures and initials are offered whenever you sign. Only you can see them.</p>
      <ErrorBanner className="mb-4">{error || loadError}</ErrorBanner>

      {KINDS.map(({ kind, title, noun }) => {
        const items = saved.filter(s => s.kind === kind)
        return (
          <section key={kind} className="mb-8" data-testid={`saved-${kind}`}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold text-gray-900">{title}</h2>
              <button
                onClick={() => setCreating(kind)}
                disabled={items.length >= 5}
                title={items.length >= 5 ? 'You can save up to 5. Delete one first.' : undefined}
                className="btn-secondary px-3 py-2 rounded-lg text-sm flex items-center gap-1.5"
              >
                <Plus size={14} /> Add {noun}
              </button>
            </div>
            {items.length === 0 ? (
              <p className="text-sm text-gray-500 card p-6 text-center">
                No saved {noun} yet. You can also save one the next time you sign.
              </p>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {items.map((s, i) => (
                  <li key={s.id} className="relative group card h-28 p-4 flex items-center justify-center">
                    <img src={s.image} alt={`Saved ${noun} ${i + 1}`} className="max-h-full max-w-full object-contain" />
                    <button
                      onClick={async () => {
                        const sure = await confirm({ title: `Delete this ${noun}?`, confirmLabel: 'Delete', danger: true })
                        if (sure) run(() => remove(s.id))
                      }}
                      className="absolute top-1.5 right-1.5 p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                      title={`Delete ${noun}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}

      {creating && (
        <Modal title={creating === 'signature' ? 'Add a signature' : 'Add initials'} onClose={() => setCreating(null)}>
          <SignaturePanel
            defaultTypedName={creating === 'signature' ? name : initialsOf(name)}
            applyLabel="Save"
            onApply={({ data }) => run(async () => {
              await save(creating, data)
              setCreating(null)
            })}
          />
        </Modal>
      )}
    </div>
  )
}
