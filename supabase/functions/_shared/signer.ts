import { HttpError, requireUuid } from './http.ts'
import { sha256Hex } from './crypto.ts'
import { admin, getUser } from './supabase.ts'

const TOKEN = /^[A-Za-z0-9_-]{32,128}$/

/**
 * Identify the signer: by signing-link token, or by a signed-in team member's verified
 * email for an envelope they are a recipient of. Returns the svc_* identity arguments.
 */
export async function signerArgs(req: Request, body: Record<string, unknown>) {
  if (body.token !== undefined) {
    if (typeof body.token !== 'string' || !TOKEN.test(body.token)) {
      throw new HttpError(404, 'This signing link is invalid or has expired')
    }
    return { p_token_hash: await sha256Hex(body.token), p_envelope_id: null, p_email: null }
  }
  const envelopeId = requireUuid(body.envelopeId, 'envelopeId')
  const user = await getUser(req)
  if (!user) throw new HttpError(401, 'Please sign in or use the link from your email')
  return { p_token_hash: null, p_envelope_id: envelopeId, p_email: user.email }
}

/** The envelope a signer belongs to (look this up before signing: signing deletes the token). */
export async function envelopeIdForSigner(args: { p_token_hash: string | null; p_envelope_id: string | null }) {
  if (args.p_envelope_id) return args.p_envelope_id
  const { data } = await admin
    .from('recipient_tokens')
    .select('recipient:recipients (envelope_id)')
    .eq('token_hash', args.p_token_hash)
    .maybeSingle()
  // deno-lint-ignore no-explicit-any
  return (data?.recipient as any)?.envelope_id ?? null
}
