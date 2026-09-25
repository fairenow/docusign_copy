import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import { useFeedback } from '../components/feedback/useFeedback'

/**
 * While `active`, ask before leaving: the browser's own prompt for reloads and closing
 * the tab (browsers allow nothing else there), and our own dialog for in-app navigation.
 */
export function useUnsavedChangesWarning(active, message = 'Your latest changes have not been saved yet.') {
  const { confirm } = useFeedback()
  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])

  const blocker = useBlocker(active)
  // The blocker object changes on every render; the dialog acts on the latest one
  const blockerRef = useRef(blocker)
  useEffect(() => { blockerRef.current = blocker })
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    confirm({ title: 'Leave without saving?', message, confirmLabel: 'Leave', cancelLabel: 'Stay', danger: true })
      .then(leave => {
        const current = blockerRef.current
        if (current.state !== 'blocked') return
        if (leave) current.proceed()
        else current.reset()
      })
  }, [blocker.state, message, confirm])
}
