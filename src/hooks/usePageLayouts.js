import { useCallback, useEffect, useRef } from 'react'
import { readPageLayout } from '../lib/pageLayout'

/**
 * Page layouts (words and lines, see lib/pageLayout) for a pdf.js document, read on
 * first use and kept for as long as the document is open.
 */
export function usePageLayouts(pdfDoc) {
  const cache = useRef(new Map())
  useEffect(() => { cache.current = new Map() }, [pdfDoc])

  const getLayout = useCallback((pageNumber) => {
    if (!pdfDoc) return Promise.resolve(null)
    if (!cache.current.has(pageNumber)) {
      const reading = pdfDoc.getPage(pageNumber).then(readPageLayout).catch(() => null)
      cache.current.set(pageNumber, reading)
    }
    return cache.current.get(pageNumber)
  }, [pdfDoc])

  const getAllLayouts = useCallback(
    () => Promise.all(Array.from({ length: pdfDoc?.numPages ?? 0 }, (_, i) => getLayout(i + 1))),
    [pdfDoc, getLayout]
  )

  return { getLayout, getAllLayouts }
}
