import { HttpError } from './http.ts'

/** Formats LibreOffice converts; PDFs never need converting. */
export const CONVERTIBLE = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  odt: 'application/vnd.oasis.opendocument.text',
  rtf: 'application/rtf'
} as const
export type ConvertibleExtension = keyof typeof CONVERTIBLE

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const TIMEOUT_MS = 110_000

export function extensionOf(fileName: string): ConvertibleExtension {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (!(ext in CONVERTIBLE)) throw new HttpError(400, 'Only Word (.docx, .doc), OpenDocument (.odt) and RTF files can be converted.')
  return ext as ConvertibleExtension
}

/** Reject files whose contents do not match their extension (e.g. a renamed executable). */
export function assertLooksLike(ext: ConvertibleExtension, bytes: Uint8Array) {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b)
  const ok = ext === 'docx' || ext === 'odt'
    ? starts(0x50, 0x4b, 0x03, 0x04) // zip
    : ext === 'doc'
      ? starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1) // OLE compound file
      : starts(0x7b, 0x5c, 0x72, 0x74, 0x66) // {\rtf
  if (!ok) throw new HttpError(400, 'This file does not look like a valid document. Open it in Word and save it again, or upload a PDF.')
}

/**
 * Convert a document to PDF with LibreOffice (Gotenberg's /forms/libreoffice/convert).
 * The page layout comes from LibreOffice exactly; nothing is re-rendered in the browser.
 */
export async function convertToPdf(
  bytes: Uint8Array<ArrayBuffer>,
  ext: ConvertibleExtension,
  { url, username, password }: { url: string; username: string; password: string }
): Promise<Uint8Array<ArrayBuffer>> {
  const form = new FormData()
  form.append('files', new Blob([bytes], { type: CONVERTIBLE[ext] }), `document.${ext}`)
  // Keep images exactly as they are, and draw form controls as page content
  form.append('losslessImageCompression', 'true')
  form.append('exportFormFields', 'false')

  let res: Response
  try {
    res = await fetch(`${url}/forms/libreoffice/convert`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`${username}:${password}`)}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    console.error('Converter unreachable:', err)
    throw new HttpError(502, 'The document converter is not responding. Try again in a minute.')
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    console.error(`Converter returned ${res.status}: ${detail}`)
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'The document converter rejected our credentials. Ask an admin to check CONVERTER_USERNAME and CONVERTER_PASSWORD.')
    if (res.status === 400) throw new HttpError(400, 'This document could not be converted. It may be damaged or password-protected; save it again in Word, or upload a PDF.')
    throw new HttpError(502, 'The document could not be converted. Try again, or upload a PDF.')
  }
  const pdf = new Uint8Array(await res.arrayBuffer())
  if (pdf.length < 5 || String.fromCharCode(...pdf.subarray(0, 5)) !== '%PDF-') {
    throw new HttpError(502, 'The converter returned something that is not a PDF.')
  }
  return pdf
}
