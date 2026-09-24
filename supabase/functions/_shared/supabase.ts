import { createClient } from '@supabase/supabase-js'
import { HttpError } from './http.ts'

/** Service-role client: bypasses RLS, so every use must enforce its own checks. */
export const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
})

export interface AuthUser {
  id: string
  email: string
}

/** The signed-in team member making the request, or null (e.g. an external signer). */
export async function getUser(req: Request): Promise<AuthUser | null> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  // Publishable/anon keys are not user sessions
  if (!token || token.startsWith('sb_')) return null
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user?.email) return null
  return { id: data.user.id, email: data.user.email }
}

export async function requireUser(req: Request): Promise<AuthUser> {
  const user = await getUser(req)
  if (!user) throw new HttpError(401, 'Please sign in')
  return user
}

/** Call a service function; Postgres errors keep their code so serve() can map them. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await admin.rpc(fn, args)
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  return data as T
}

/** Select fragment for an envelope's owner; use with ownerOf(). */
export const OWNER_SELECT = 'owner:profiles!envelopes_owner_id_fkey (full_name, email)'

/** The owner embedded by OWNER_SELECT, with a display name. */
export function ownerOf(envelope: { owner?: unknown }) {
  const owner = (envelope.owner ?? {}) as { full_name?: string | null; email?: string }
  return { email: owner.email ?? '', name: owner.full_name || owner.email || 'A FLMLNK team member' }
}

interface AuditEvent {
  envelopeId: string
  action: string
  details: Record<string, unknown>
  recipientId?: string | null
}

/** Append events to the audit trail (best effort: failures are logged, not thrown). */
export async function audit(...events: AuditEvent[]) {
  if (!events.length) return
  const { error } = await admin.from('audit_events').insert(events.map(e => ({
    envelope_id: e.envelopeId, recipient_id: e.recipientId ?? null, action: e.action, details: e.details
  })))
  if (error) console.error('Could not write audit event:', error)
}
