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

export async function audit(envelopeId: string, action: string, details: Record<string, unknown>, recipientId: string | null = null) {
  const { error } = await admin.from('audit_events').insert({ envelope_id: envelopeId, recipient_id: recipientId, action, details })
  if (error) console.error('Could not write audit event:', error)
}
