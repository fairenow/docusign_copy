// POST { token } or { envelopeId } (+ team member session) — what a signer sees.
import { json, readJson, clientIp, userAgent } from '../http.ts'
import { admin, rpc } from '../supabase.ts'
import { signerArgs } from '../signer.ts'

// Signed URLs for the document are short-lived; the page downloads it right away
const DOCUMENT_URL_TTL_SECONDS = 600

interface Session {
  state: string
  envelope: { id: string; title: string; message: string | null; original_path: string; sender: string }
  recipient: { id: string; name: string; email: string }
  fields: unknown[]
}

export async function signingSession(req: Request): Promise<Response> {
  const body = await readJson(req)
  const session = await rpc<Session>('svc_signing_session', {
    ...(await signerArgs(req, body)),
    p_ip: clientIp(req),
    p_user_agent: userAgent(req)
  })

  let documentUrl: string | null = null
  if (session.state === 'ready') {
    const { data, error } = await admin.storage.from('documents').createSignedUrl(session.envelope.original_path, DOCUMENT_URL_TTL_SECONDS)
    if (error) throw error
    documentUrl = data.signedUrl
  }

  const { original_path: _path, ...envelope } = session.envelope
  return json({ ...session, envelope, documentUrl })
}
