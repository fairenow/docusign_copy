import { useCallback, useEffect, useState } from 'react'
import { addComment, deleteComment, listComments, setCommentResolved, subscribeToComments } from '../lib/api'

/**
 * An envelope's team comments, kept live: changes by teammates arrive over Realtime and the
 * list is simply reloaded (comment lists are short).
 */
export function useEnvelopeComments(envelopeId, enabled = true) {
  const [comments, setComments] = useState([])
  const [error, setError] = useState(null)

  const reload = useCallback(async () => {
    try {
      setComments(await listComments(envelopeId))
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [envelopeId])

  useEffect(() => {
    if (!enabled) return
    reload()
    return subscribeToComments(envelopeId, reload)
  }, [enabled, envelopeId, reload])

  const upsert = (comment) => setComments(list => [...list.filter(c => c.id !== comment.id), comment])

  const post = useCallback(async (comment) => {
    const saved = await addComment({ envelopeId, ...comment })
    upsert(saved)
    return saved
  }, [envelopeId])

  const resolve = useCallback(async (id, resolved) => upsert(await setCommentResolved(id, resolved)), [])

  const remove = useCallback(async (id) => {
    await deleteComment(id)
    // Replies go with it (the database cascades)
    setComments(list => list.filter(c => c.id !== id && c.parent_id !== id))
  }, [])

  return { comments, error, post, resolve, remove }
}
