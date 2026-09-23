import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// Self-host the worker so documents never touch a third-party CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export function loadPdfDocument(bytes) {
  // pdf.js transfers the buffer to its worker, so hand it a copy
  return pdfjsLib.getDocument({
    data: bytes.slice(),
    isEvalSupported: false
  }).promise
}

export { pdfjsLib }
