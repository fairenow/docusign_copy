// POST <document bytes>?name=<file name> — convert a Word/OpenDocument/RTF file to PDF (signed-in users only).
import { HttpError, corsHeaders } from '../http.ts'
import { requireUser } from '../supabase.ts'
import { converterConfig } from '../config.ts'
import { MAX_UPLOAD_BYTES, assertLooksLike, convertToPdf, extensionOf } from '../converter.ts'

export async function convertDocument(req: Request): Promise<Response> {
  await requireUser(req)
  const ext = extensionOf(new URL(req.url).searchParams.get('name') ?? '')
  const config = converterConfig()

  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Documents must be 25 MB or smaller.')
  const bytes = new Uint8Array(await req.arrayBuffer())
  if (bytes.length > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Documents must be 25 MB or smaller.')
  if (!bytes.length) throw new HttpError(400, 'The file is empty.')
  assertLooksLike(ext, bytes)

  const pdf = await convertToPdf(bytes, ext, config)
  return new Response(pdf, { headers: { ...corsHeaders, 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } })
}
