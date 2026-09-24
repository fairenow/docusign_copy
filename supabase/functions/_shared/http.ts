// Request/response helpers shared by all Edge Functions.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const MAX_BODY_BYTES = 2 * 1024 * 1024

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

// Postgres error codes raised by the svc_* functions, mapped to HTTP statuses
const PG_STATUS: Record<string, number> = { P0002: 404, '22023': 400, '55000': 409, '23505': 409 }

/** Wrap a POST handler with CORS, JSON errors and logging of unexpected failures. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    try {
      return await handler(req)
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status)
      const code = (err as { code?: string })?.code
      if (code && PG_STATUS[code]) return json({ error: (err as Error).message }, PG_STATUS[code])
      console.error(err)
      return json({ error: 'Something went wrong. Please try again.' }, 500)
    }
  })
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request is too large')
  try {
    const body = JSON.parse(text || '{}')
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error()
    return body
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function requireUuid(value: unknown, name: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new HttpError(400, `${name} must be a UUID`)
  return value
}

/** Caller IP for the audit trail; null unless it parses as an address Postgres accepts. */
export function clientIp(req: Request): string | null {
  const raw = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim()
  if (!raw) return null
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/
  const ipv6 = /^[0-9a-f:]+$/i
  return ipv4.test(raw) || (ipv6.test(raw) && raw.includes(':')) ? raw : null
}

export function userAgent(req: Request): string | null {
  return req.headers.get('user-agent')?.slice(0, 500) ?? null
}

/** Run work after the response is sent when the runtime supports it. */
export function runInBackground(promise: Promise<unknown>) {
  const logged = promise.catch(err => console.error('Background task failed:', err))
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime
  if (runtime?.waitUntil) runtime.waitUntil(logged)
}
