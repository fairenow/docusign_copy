import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Self-host the worker so documents never touch a third-party CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

// One worker for every document, so it can start before the first one arrives (see
// preloadPdfViewer) and opening another document does not start a new one
let worker = null
export function sharedWorker() {
  if (!worker || worker.destroyed) worker = new pdfjsLib.PDFWorker()
  return worker
}

export function loadPdfDocument(bytes) {
  // pdf.js transfers the buffer to its worker (emptying it), so hand it a copy
  return pdfjsLib.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    worker: sharedWorker()
  }).promise
}
