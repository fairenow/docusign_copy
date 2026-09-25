import { useState } from 'react'
import SignaturePanel from './SignaturePanel'

const NOUN = { signature: 'signature', initials: 'initials' }

/**
 * Pick a saved signature (or initials) or create a new one.
 * onAdopt(image, remember): remember is true when a new one should be saved for next time.
 * canSave: the signer is the signed-in team member, so saving is offered.
 */
export default function AdoptSignature({ kind, defaultTypedName, saved = [], canSave, onAdopt }) {
  const [remember, setRemember] = useState(true)
  const options = saved.filter(s => s.kind === kind)

  return (
    <div>
      {options.length > 0 && (
        <section className="mb-4">
          <h3 className="section-heading mb-2">Your saved {NOUN[kind]}</h3>
          <div className="grid grid-cols-2 gap-2">
            {options.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onAdopt(s.image, false)}
                aria-label={`Use saved ${NOUN[kind]} ${i + 1}`}
                className="h-16 p-2 rounded-md border border-gray-300 bg-white hover:border-blue-500 hover:bg-blue-50"
              >
                <img src={s.image} alt="" className="max-h-full max-w-full mx-auto object-contain" />
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-3">Or create a new one:</p>
        </section>
      )}
      <SignaturePanel
        onApply={({ data }) => onAdopt(data, canSave && remember)}
        defaultTypedName={defaultTypedName}
        applyLabel="Adopt and sign"
      />
      {canSave && (
        <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Save to my signatures for next time
        </label>
      )}
    </div>
  )
}
