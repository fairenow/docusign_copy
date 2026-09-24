import { useEffect } from 'react'

/** Ask the browser to confirm before closing or reloading the tab while `active`. */
export function useUnsavedChangesWarning(active) {
  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [active])
}
