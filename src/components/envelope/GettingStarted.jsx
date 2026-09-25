import { useState } from 'react'
import { Check } from 'lucide-react'

const STORAGE_KEY = 'flmlnk.editorGuide.hidden'

const readHidden = () => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * Three steps for a first envelope, ticked off as they are done. Hidden for good once the
 * person chooses "Hide guide" (remembered in this browser).
 */
export default function GettingStarted({ draft, selfSign = false }) {
  const [hidden, setHidden] = useState(readHidden)
  if (hidden) return null

  const signers = draft.recipients.filter(r => r.role === 'signer')
  const named = signers.length > 0 && signers.every(r => r.name.trim() && r.email.trim())
  const placed = signers.length > 0 && signers.every(r => draft.fields.some(f => f.recipientId === r.id))
  const steps = [
    { done: named, title: 'Add who signs', hint: 'Name and email for each signer, or tick "I need to sign this document".' },
    { done: placed, title: 'Place their fields', hint: 'Pick a field on the left and click it onto the page, or use Suggest fields.' },
    selfSign
      ? { done: false, title: 'Sign it', hint: 'Press Sign now at the top. The signed PDF is emailed to you and anyone you add below.' }
      : { done: false, title: 'Send', hint: 'Press Send at the top. Everyone gets an email with their own link.' }
  ]

  const hide = () => {
    setHidden(true)
    try {
      window.localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      // Private browsing: hidden for this visit only
    }
  }

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50/60 p-3" aria-label="Getting started" data-testid="getting-started">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-900">Getting started</h2>
        <button onClick={hide} className="text-xs text-blue-700 hover:underline">Hide guide</button>
      </div>
      <ol className="space-y-2">
        {steps.map((step, i) => (
          <li key={step.title} className="flex gap-2.5" data-done={step.done}>
            <span
              className={`mt-0.5 w-5 h-5 flex-shrink-0 rounded-full text-[11px] font-semibold flex items-center justify-center ${
                step.done ? 'bg-green-600 text-white' : 'bg-white border border-blue-300 text-blue-700'
              }`}
              aria-hidden="true"
            >
              {step.done ? <Check size={12} strokeWidth={3} /> : i + 1}
            </span>
            <div className="min-w-0">
              <p className={`text-sm ${step.done ? 'text-gray-500 line-through' : 'text-gray-900 font-medium'}`}>{step.title}</p>
              {!step.done && <p className="text-xs text-gray-600">{step.hint}</p>}
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-gray-500 mt-2">Changes save automatically. Ctrl+Z undoes a change.</p>
    </section>
  )
}
