import { useEffect } from 'react'
import { useBlocker } from 'react-router-dom'

/**
 * While `active`, ask before leaving: the browser's own prompt for reloads and closing
 * the tab, and a confirm dialog for in-app navigation.
 */
export function useUnsavedChangesWarning(active, message = 'You have unsaved changes. Leave without saving?') {
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
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm(message)) blocker.proceed()
    else blocker.reset()
  }, [blocker, message])
}
