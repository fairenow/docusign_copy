import { useCallback, useEffect, useState } from 'react'
import { deleteSavedSignature, listSavedSignatures, saveSignature } from '../lib/api'

/**
 * The signed-in user's saved signatures and initials (newest first).
 * Does nothing when `enabled` is false (e.g. an external signer without an account).
 */
export function useSavedSignatures(enabled) {
  const [saved, setSaved] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    listSavedSignatures()
      .then(rows => { if (!cancelled) setSaved(rows) })
      .catch(err => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [enabled])

  // Saving the same image twice keeps one copy
  const save = useCallback(async (kind, image) => {
    if (saved.some(s => s.kind === kind && s.image === image)) return
    const row = await saveSignature(kind, image)
    setSaved(list => [row, ...list])
  }, [saved])

  const remove = useCallback(async (id) => {
    await deleteSavedSignature(id)
    setSaved(list => list.filter(s => s.id !== id))
  }, [])

  return { saved, error, save, remove }
}
