import { useEffect, useState } from 'react'
import { openPdf } from '../lib/documents'

const EMPTY = { doc: null, pageSizes: [], error: null, loading: false }

/**
 * Open PDF bytes with pdf.js. Re-opens when `bytes` changes and destroys the
 * previous document so its worker memory is released.
 */
export function usePdf(bytes) {
  const [state, setState] = useState(EMPTY)

  useEffect(() => {
    if (!bytes) {
      setState(EMPTY)
      return
    }
    let cancelled = false
    let opened = null
    setState({ ...EMPTY, loading: true })

    openPdf(bytes)
      .then(({ doc, pageSizes }) => {
        opened = doc
        if (cancelled) {
          doc.destroy()
          return
        }
        setState({ doc, pageSizes, error: null, loading: false })
      })
      .catch(error => {
        if (!cancelled) setState({ ...EMPTY, error })
      })

    return () => {
      cancelled = true
      opened?.destroy()
    }
  }, [bytes])

  return state
}
