import { useCallback, useEffect, useState } from 'react'
import { useSavedSignatures } from './useSavedSignatures'
import { signingDate, validateSigningValues } from '../../supabase/functions/_shared/signing.js'

const storageKey = (envelopeId) => `self-sign:${envelopeId}`

function readStored(envelopeId) {
  try {
    const stored = JSON.parse(window.localStorage.getItem(storageKey(envelopeId)) ?? 'null')
    return stored && typeof stored === 'object' ? stored : {}
  } catch {
    return {}
  }
}

/**
 * Signing your own envelope in the editor, as you place fields: your signature and initials
 * (your newest saved ones unless you pick others), the text and checkboxes you fill in, and
 * today's date. Kept in this browser until you finish, so a reload loses nothing.
 * @param {{ envelopeId: string, enabled: boolean, myFields: object[] }} options
 */
export function useSelfSigning({ envelopeId, enabled, myFields }) {
  const { saved, save } = useSavedSignatures(enabled)
  const [state, setState] = useState(() => readStored(envelopeId)) // { signature?, initials?, values? }

  useEffect(() => {
    if (!enabled) return
    try {
      if (Object.keys(state).length) window.localStorage.setItem(storageKey(envelopeId), JSON.stringify(state))
      else window.localStorage.removeItem(storageKey(envelopeId))
    } catch {
      // Private windows may refuse storage; the values still work until the page is closed
    }
  }, [enabled, envelopeId, state])

  const newest = (kind) => saved.find(s => s.kind === kind)?.image ?? null
  const images = { signature: state.signature ?? newest('signature'), initials: state.initials ?? newest('initials') }

  /** Use this image for every field of its kind; `remember` also saves it for next time. */
  const adopt = useCallback((kind, image, { remember = false } = {}) => {
    setState(s => ({ ...s, [kind]: image }))
    if (remember) save(kind, image).catch(err => console.error('Could not save the signature:', err))
  }, [save])

  const setValue = useCallback((fieldId, value) => {
    setState(s => ({ ...s, values: { ...s.values, [fieldId]: value } }))
  }, [])

  /** What a field of yours shows: your signature, today's date, what you typed. */
  const valueOf = (field) => {
    if (field.type === 'signature' || field.type === 'initials') return images[field.type]
    if (field.type === 'date') return signingDate()
    return state.values?.[field.id] ?? (field.type === 'checkbox' ? 'false' : '')
  }

  const values = Object.fromEntries(myFields.filter(f => f.type !== 'date').map(f => [f.id, valueOf(f)]))
  const { values: submission, problems } = validateSigningValues(myFields, values)

  /** Forget the values once the envelope is signed. */
  const clear = useCallback(() => setState({}), [])

  return { saved, images, adopt, valueOf, setValue, submission, problems, clear }
}
