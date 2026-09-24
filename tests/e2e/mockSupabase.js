/**
 * In-memory stand-in for the Supabase REST, Storage and Auth APIs, installed with
 * Playwright request interception. It implements only what the app uses and mirrors
 * the database rules that matter to the UI (drafts only, owner only, atomic saves).
 * Row level security itself is verified against the real database, not here.
 */
import { randomUUID } from 'node:crypto'

export const SUPABASE_URL = 'https://e2e-test.supabase.co'
export const STORAGE_KEY = 'sb-e2e-test-auth-token'

export const ALICE = { id: '11111111-1111-4111-8111-111111111111', email: 'alice@flmlnk.com', name: 'Alice Owner' }

export function fakeSession(user = ALICE) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const exp = Math.floor(Date.now() / 1000) + 3600
  const accessToken = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp })}.sig`
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'refresh-token',
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'google' }, user_metadata: { full_name: user.name } }
  }
}

export function createMockDb() {
  return {
    profiles: [{ id: ALICE.id, email: ALICE.email, full_name: ALICE.name, role: 'admin' }],
    envelopes: [],
    recipients: [],
    fields: [],
    files: new Map(),
    calls: []
  }
}

const now = () => new Date().toISOString()

function withChildren(db, envelope) {
  return {
    ...envelope,
    recipients: db.recipients.filter(r => r.envelope_id === envelope.id),
    fields: db.fields.filter(f => f.envelope_id === envelope.id)
  }
}

// Supports the `col=eq.value` filters the app sends
function applyFilters(rows, params) {
  return rows.filter(row => {
    for (const [key, value] of params) {
      if (['select', 'order', 'limit', 'offset'].includes(key)) continue
      const match = /^eq\.(.*)$/.exec(value)
      if (match && String(row[key]) !== match[1]) return false
    }
    return true
  })
}

function json(route, status, body, headers = {}) {
  return route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', ...headers }, body: body === undefined ? '' : JSON.stringify(body) })
}

export async function installMockSupabase(page, db) {
  // CORS preflights
  await page.route(`${SUPABASE_URL}/**`, async (route, request) => {
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })
    }
    return route.fallback()
  })

  // Auth: the OAuth redirect is captured, logout accepted
  await page.route(`${SUPABASE_URL}/auth/v1/**`, async (route, request) => {
    const url = new URL(request.url())
    db.calls.push({ type: 'auth', method: request.method(), path: url.pathname, url: request.url() })
    if (url.pathname.endsWith('/authorize')) {
      return route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Google sign-in (mock)</h1>' })
    }
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    return json(route, 404, { message: 'not mocked' })
  })

  await page.route(`${SUPABASE_URL}/rest/v1/**`, async (route, request) => {
    const url = new URL(request.url())
    const table = url.pathname.replace('/rest/v1/', '')
    const method = request.method()
    const params = [...url.searchParams.entries()]
    const wantsObject = (request.headers()['accept'] || '').includes('vnd.pgrst.object')
    const body = request.postData() ? JSON.parse(request.postData()) : undefined
    db.calls.push({ type: 'rest', method, table, params: Object.fromEntries(params), body })

    const respond = (rows) => json(route, 200, wantsObject ? rows[0] ?? null : rows)

    if (table === 'rpc/save_envelope_draft') {
      const env = db.envelopes.find(e => e.id === body.p_envelope_id && e.status === 'draft' && e.owner_id === ALICE.id)
      if (!env) return json(route, 400, { code: 'P0002', message: 'Envelope not found or no longer a draft' })
      const emails = body.p_recipients.map(r => r.email.toLowerCase())
      if (new Set(emails).size !== emails.length) {
        return json(route, 409, { code: '23505', message: 'duplicate key value violates unique constraint "recipients_envelope_email_key"' })
      }
      Object.assign(env, { title: body.p_title, message: body.p_message, signing_order: body.p_signing_order, updated_at: now() })
      db.recipients = db.recipients.filter(r => r.envelope_id !== env.id)
        .concat(body.p_recipients.map(r => ({ status: 'pending', signed_at: null, ...r, envelope_id: env.id })))
      db.fields = db.fields.filter(f => f.envelope_id !== env.id)
        .concat(body.p_fields.map(f => ({ ...f, envelope_id: env.id })))
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    }

    if (table === 'rpc/void_envelope') {
      const env = db.envelopes.find(e => e.id === body.envelope_id)
      if (!env || env.status !== 'sent') return json(route, 400, { message: 'Only envelopes that are out for signature can be voided' })
      Object.assign(env, { status: 'voided', void_reason: body.reason, voided_at: now(), updated_at: now() })
      return json(route, 200, env)
    }

    if (table === 'profiles' && method === 'GET') return respond(applyFilters(db.profiles, params))

    if (table === 'envelopes') {
      if (method === 'GET') {
        const rows = applyFilters(db.envelopes, params)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .map(e => withChildren(db, e))
        return respond(rows)
      }
      if (method === 'POST') {
        const created = (Array.isArray(body) ? body : [body]).map(row => ({
          id: randomUUID(), owner_id: ALICE.id, status: 'draft', signing_order: 'sequential', message: null,
          original_path: null, created_at: now(), updated_at: now(), ...row
        }))
        db.envelopes.push(...created)
        return respond(created)
      }
      if (method === 'PATCH') {
        for (const env of applyFilters(db.envelopes, params)) Object.assign(env, body, { updated_at: now() })
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      }
      if (method === 'DELETE') {
        const doomed = new Set(applyFilters(db.envelopes, params).map(e => e.id))
        db.envelopes = db.envelopes.filter(e => !doomed.has(e.id))
        db.recipients = db.recipients.filter(r => !doomed.has(r.envelope_id))
        db.fields = db.fields.filter(f => !doomed.has(f.envelope_id))
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      }
    }
    return json(route, 404, { message: `not mocked: ${method} ${table}` })
  })

  await page.route(`${SUPABASE_URL}/storage/v1/**`, async (route, request) => {
    const url = new URL(request.url())
    const method = request.method()
    const objectPath = url.pathname.replace(/^\/storage\/v1\/object\/(authenticated\/)?/, '')
    db.calls.push({ type: 'storage', method, path: objectPath })

    if (method === 'POST') {
      db.files.set(objectPath, request.postDataBuffer())
      return json(route, 200, { Key: objectPath })
    }
    if (method === 'GET') {
      const file = db.files.get(objectPath)
      if (!file) return json(route, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' })
      return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: file })
    }
    if (method === 'DELETE') {
      const { prefixes } = JSON.parse(request.postData())
      for (const p of prefixes) db.files.delete(`${objectPath}/${p}`)
      return json(route, 200, prefixes.map(name => ({ name })))
    }
    return json(route, 404, { message: 'not mocked' })
  })

  // Realtime is not needed for these flows; refuse the socket quickly
  await page.routeWebSocket(/e2e-test\.supabase\.co/, ws => ws.close())
}

/** Seed an envelope directly (e.g. one that is already out for signature). */
export function seedEnvelope(db, { pdf, status = 'sent', recipients = [], fields = [], ...rest }) {
  const id = randomUUID()
  db.envelopes.push({
    id, owner_id: ALICE.id, title: 'Seeded', message: null, status, signing_order: 'sequential',
    original_filename: 'seed.pdf', original_path: `${id}/original.pdf`, page_count: 1,
    created_at: now(), updated_at: now(), ...rest
  })
  db.files.set(`documents/${id}/original.pdf`, pdf)
  for (const r of recipients) db.recipients.push({ id: randomUUID(), envelope_id: id, role: 'signer', routing_order: 1, status: 'sent', color: '#2563eb', signed_at: null, ...r })
  for (const f of fields) db.fields.push({ id: randomUUID(), envelope_id: id, ...f })
  return id
}
