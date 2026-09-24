/**
 * In-memory stand-in for the Supabase REST, Storage and Auth APIs, installed with
 * Playwright request interception. It implements only what the app uses and mirrors
 * the database rules that matter to the UI (drafts only, owner only, atomic saves).
 * Row level security itself is verified against the real database, not here.
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

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
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: { full_name: user.name } }
  }
}

export const BOB = { id: '22222222-2222-4222-8222-222222222222', email: 'bob@flmlnk.com', name: 'Bob Teammate' }

export function createMockDb() {
  return {
    profiles: [
      { id: ALICE.id, email: ALICE.email, full_name: ALICE.name, role: 'admin' },
      { id: BOB.id, email: BOB.email, full_name: BOB.name, role: 'member' }
    ],
    envelopes: [],
    recipients: [],
    fields: [],
    audit: [],
    tokens: new Map(), // raw token -> recipient id
    emails: [],
    savedSignatures: [],
    templates: [],
    templateRoles: [],
    templateFields: [],
    files: new Map(),
    calls: []
  }
}

/** The user a request is made as, from the fake JWT in its Authorization header. */
function requestUser(request) {
  const token = (request.headers()['authorization'] || '').replace(/^Bearer /, '')
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return { id: payload.sub, email: payload.email }
  } catch {
    return null
  }
}

const now = () => new Date().toISOString()

// What a template keeps of a field (and gives back to a new envelope's field)
const pickFieldLayout = ({ page, type, x, y, w, h, required, label, font_size }) => ({ page, type, x, y, w, h, required, label, font_size })

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

  // Auth: sign-in link requests are captured, logout accepted
  await page.route(`${SUPABASE_URL}/auth/v1/**`, async (route, request) => {
    const url = new URL(request.url())
    db.calls.push({ type: 'auth', method: request.method(), path: url.pathname, url: request.url() })
    if (url.pathname.endsWith('/otp')) {
      const body = JSON.parse(request.postData() || '{}')
      db.calls.at(-1).body = body
      // Like the database trigger: other domains cannot sign up
      if (!body.email?.endsWith('@flmlnk.com')) return json(route, 500, { code: 500, error_code: 'unexpected_failure', msg: 'Database error saving new user' })
      db.emails.push({ to: body.email, kind: 'sign_in' })
      return json(route, 200, {})
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
      Object.assign(env, {
        title: body.p_title, message: body.p_message, signing_order: body.p_signing_order,
        remind_every_days: body.p_remind_every_days, expire_after_days: body.p_expire_after_days, updated_at: now()
      })
      db.recipients = db.recipients.filter(r => r.envelope_id !== env.id)
        .concat(body.p_recipients.map(r => ({ status: 'pending', signed_at: null, ...r, envelope_id: env.id })))
      db.fields = db.fields.filter(f => f.envelope_id !== env.id)
        .concat(body.p_fields.map(f => ({ ...f, envelope_id: env.id })))
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    }

    if (table === 'rpc/create_template_from_envelope') {
      const env = db.envelopes.find(e => e.id === body.p_envelope_id && e.owner_id === ALICE.id)
      if (!env) return json(route, 400, { code: 'P0002', message: 'Envelope not found' })
      const names = body.p_roles.map(r => r.name)
      if (new Set(names).size !== names.length) {
        return json(route, 409, { code: '23505', message: 'duplicate key value violates unique constraint "template_roles_template_name_key"' })
      }
      const id = randomUUID()
      db.templates.push({
        id, owner_id: ALICE.id, name: body.p_name, original_filename: env.original_filename, page_count: env.page_count,
        signing_order: env.signing_order, message: env.message, remind_every_days: env.remind_every_days,
        expire_after_days: env.expire_after_days, shared: true, created_at: now()
      })
      for (const spec of body.p_roles) {
        const r = db.recipients.find(x => x.id === spec.recipient_id)
        const roleId = randomUUID()
        db.templateRoles.push({
          id: roleId, template_id: id, name: spec.name, role: r.role, routing_order: r.routing_order, color: r.color,
          default_name: spec.keep_recipient ? r.name : null, default_email: spec.keep_recipient ? r.email : null
        })
        for (const f of db.fields.filter(x => x.recipient_id === r.id)) {
          db.templateFields.push({ ...pickFieldLayout(f), template_id: id, role_id: roleId })
        }
      }
      return json(route, 200, id)
    }

    if (table === 'rpc/create_envelope_from_template') {
      const t = db.templates.find(x => x.id === body.p_template_id)
      if (!t) return json(route, 400, { code: 'P0002', message: 'Template not found' })
      const id = randomUUID()
      db.envelopes.push({
        id, owner_id: ALICE.id, title: body.p_title || t.name, message: t.message, status: 'draft', signing_order: t.signing_order,
        original_filename: t.original_filename, original_path: null, page_count: t.page_count,
        remind_every_days: t.remind_every_days, expire_after_days: t.expire_after_days, created_at: now(), updated_at: now()
      })
      for (const role of db.templateRoles.filter(r => r.template_id === t.id)) {
        const person = body.p_people[role.id] ?? {}
        const recipientId = randomUUID()
        db.recipients.push({
          id: recipientId, envelope_id: id, name: person.name || role.default_name, email: person.email || role.default_email,
          role: role.role, routing_order: role.routing_order, color: role.color, status: 'pending', signed_at: null
        })
        for (const f of db.templateFields.filter(x => x.role_id === role.id)) {
          db.fields.push({ ...pickFieldLayout(f), id: randomUUID(), envelope_id: id, recipient_id: recipientId })
        }
      }
      return json(route, 200, id)
    }

    if (table === 'rpc/void_envelope') {
      const env = db.envelopes.find(e => e.id === body.envelope_id)
      if (!env || env.status !== 'sent') return json(route, 400, { message: 'Only envelopes that are out for signature can be voided' })
      Object.assign(env, { status: 'voided', void_reason: body.reason, voided_at: now(), updated_at: now() })
      return json(route, 200, env)
    }

    if (table === 'profiles' && method === 'GET') return respond(applyFilters(db.profiles, params))

    if (table === 'saved_signatures') {
      if (method === 'GET') return respond([...db.savedSignatures].sort((a, b) => b.created_at.localeCompare(a.created_at)))
      if (method === 'POST') {
        const row = { id: randomUUID(), kind: body.kind, image: body.image, created_at: now() }
        db.savedSignatures.push(row)
        return respond([row])
      }
      if (method === 'DELETE') {
        const doomed = new Set(applyFilters(db.savedSignatures, params).map(r => r.id))
        db.savedSignatures = db.savedSignatures.filter(r => !doomed.has(r.id))
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      }
    }
    if (table === 'audit_events' && method === 'GET') return respond(applyFilters(db.audit, params))

    if (table === 'templates') {
      if (method === 'GET') {
        const owner = (t) => db.profiles.find(p => p.id === t.owner_id)
        return respond(applyFilters(db.templates, params).map(t => ({
          ...t,
          owner: { full_name: owner(t)?.full_name, email: owner(t)?.email },
          template_roles: db.templateRoles.filter(r => r.template_id === t.id)
        })))
      }
      if (method === 'DELETE') {
        const doomed = new Set(applyFilters(db.templates, params).map(t => t.id))
        db.templates = db.templates.filter(t => !doomed.has(t.id))
        db.templateRoles = db.templateRoles.filter(r => !doomed.has(r.template_id))
        db.templateFields = db.templateFields.filter(f => !doomed.has(f.template_id))
        return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
      }
    }

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
          original_path: null, remind_every_days: 3, expire_after_days: 30, created_at: now(), updated_at: now(), ...row
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
    const objectPath = url.pathname.replace(/^\/storage\/v1\/object\/(authenticated\/|sign\/)?/, '')
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

  await installMockSigningApi(page, db)
  await installMockConverter(page, db)

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

// ---------------------------------------------------------------------------
// signing-api Edge Function (same rules as the database functions, simplified)
// ---------------------------------------------------------------------------

function addAudit(db, envelopeId, action, recipientId = null) {
  db.audit.push({ id: db.audit.length + 1, envelope_id: envelopeId, recipient_id: recipientId, actor_user_id: null, action, ip: '203.0.113.7', details: {}, created_at: now() })
}

function issueTokens(db, env) {
  const signers = db.recipients.filter(r => r.envelope_id === env.id && r.role === 'signer')
  const pending = signers.filter(r => r.status !== 'signed')
  const turn = Math.min(...pending.map(r => r.routing_order))
  for (const r of pending) {
    if (r.status !== 'pending' || (env.signing_order === 'sequential' && r.routing_order !== turn)) continue
    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 11)
    db.tokens.set(token, r.id)
    r.status = 'sent'
    db.emails.push({ to: r.email, kind: 'signing_request', link: `/sign/${token}`, token })
    addAudit(db, env.id, 'recipient_notified', r.id)
  }
}

function isTurn(db, r, env) {
  return env.signing_order === 'parallel' || !db.recipients.some(o =>
    o.envelope_id === env.id && o.role === 'signer' && o.status !== 'signed' && o.routing_order < r.routing_order)
}

// Stand-in for the convert-document function: returns what LibreOffice produced for the fixture
async function installMockConverter(page, db) {
  const converted = await readFile(new URL('./fixtures/consent.libreoffice.pdf', import.meta.url))
  await page.route(`${SUPABASE_URL}/functions/v1/convert-document*`, async (route, request) => {
    if (request.method() === 'OPTIONS') return route.fallback()
    const url = new URL(request.url())
    const user = requestUser(request)
    db.calls.push({ type: 'function', action: 'convert', name: url.searchParams.get('name'), user: user?.email, bytes: request.postDataBuffer()?.length ?? 0 })
    if (!user) return json(route, 401, { error: 'Please sign in' })
    return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'access-control-allow-origin': '*' }, body: converted })
  })
}

async function installMockSigningApi(page, db) {
  await page.route(`${SUPABASE_URL}/functions/v1/signing-api/*`, async (route, request) => {
    if (request.method() === 'OPTIONS') return route.fallback()
    const action = new URL(request.url()).pathname.split('/').pop()
    const body = JSON.parse(request.postData() || '{}')
    const user = requestUser(request)
    db.calls.push({ type: 'function', action, body })
    const fail = (status, error) => json(route, status, { error })

    // Owner actions
    if (action === 'send' || action === 'resend' || action === 'finalize') {
      if (!user) return fail(401, 'Please sign in')
      const env = db.envelopes.find(e => e.id === body.envelopeId && e.owner_id === user.id)
      if (!env) return fail(404, 'Envelope not found')
      if (action === 'send') {
        if (env.status !== 'draft') return fail(409, 'This envelope has already been sent')
        env.status = 'sent'
        env.sent_at = now()
        addAudit(db, env.id, 'envelope_sent')
        issueTokens(db, env)
        return json(route, 200, { notified: db.emails.length, failed: [] })
      }
      if (action === 'resend') {
        const r = db.recipients.find(x => x.id === body.recipientId && x.envelope_id === env.id)
        for (const [t, id] of db.tokens) if (id === r.id) db.tokens.delete(t)
        const token = 'resent' + randomUUID().replace(/-/g, '') + 'xxxxxx'
        db.tokens.set(token, r.id)
        db.emails.push({ to: r.email, kind: 'signing_request', link: `/sign/${token}`, token })
        addAudit(db, env.id, 'recipient_reminded', r.id)
        return json(route, 200, { resent: true })
      }
      env.status = 'completed'
      env.final_path = `${env.id}/signed.pdf`
      db.files.set(`documents/${env.final_path}`, db.files.get(`documents/${env.original_path}`))
      addAudit(db, env.id, 'envelope_completed')
      return json(route, 200, { status: 'completed' })
    }

    // Signer actions: by link token, or by signed-in team member for an envelope
    let recipient
    if (body.token) recipient = db.recipients.find(r => r.id === db.tokens.get(body.token))
    else if (user) recipient = db.recipients.find(r => r.envelope_id === body.envelopeId && r.role === 'signer' && r.email === user.email)
    if (!recipient) return fail(404, 'This signing link is invalid or has expired')
    const env = db.envelopes.find(e => e.id === recipient.envelope_id)
    const myFields = db.fields.filter(f => f.recipient_id === recipient.id)

    if (action === 'session') {
      const state = env.status === 'voided' ? 'voided' : env.status === 'declined' ? 'declined'
        : recipient.status === 'signed' ? 'signed' : env.status !== 'sent' ? 'closed'
          : !isTurn(db, recipient, env) ? 'waiting' : 'ready'
      if (state === 'ready' && recipient.status === 'sent') {
        recipient.status = 'viewed'
        addAudit(db, env.id, 'recipient_viewed', recipient.id)
      }
      return json(route, 200, {
        state,
        envelope: { id: env.id, title: env.title, message: env.message, sender: ALICE.name },
        recipient: { id: recipient.id, name: recipient.name, email: recipient.email },
        fields: state === 'ready' ? myFields : [],
        documentUrl: state === 'ready' ? `${SUPABASE_URL}/storage/v1/object/sign/documents/${env.original_path}?token=signed` : null
      })
    }

    if (env.status !== 'sent') return fail(409, 'This envelope is no longer open for signing')
    if (recipient.status === 'signed' || recipient.status === 'declined') return fail(409, 'You have already completed this envelope')

    if (action === 'decline') {
      recipient.status = 'declined'
      recipient.decline_reason = body.reason
      env.status = 'declined'
      for (const [t, id] of db.tokens) if (db.recipients.find(r => r.id === id)?.envelope_id === env.id) db.tokens.delete(t)
      addAudit(db, env.id, 'recipient_declined', recipient.id)
      return json(route, 200, { declined: true })
    }

    if (action === 'submit') {
      if (body.consent !== true) return fail(400, 'You must agree to sign electronically')
      const positions = body.positions ?? {}
      for (const key of [...Object.keys(body.values), ...Object.keys(positions)]) if (!myFields.some(f => f.id === key)) return fail(400, `Unknown field ${key}`)
      for (const [id, p] of Object.entries(positions)) {
        if (p.x < 0 || p.y < 0 || p.x + p.w > 1.000001 || p.y + p.h > 1.000001) return fail(400, 'Fields must stay on the page')
        Object.assign(myFields.find(f => f.id === id), { x: p.x, y: p.y, w: p.w, h: p.h })
      }
      if (Object.keys(positions).length) addAudit(db, env.id, 'fields_adjusted', recipient.id)
      for (const f of myFields) {
        const v = body.values[f.id]
        if (f.required && f.type !== 'date' && (v === undefined || v === '' || (f.type === 'checkbox' && v !== 'true'))) {
          return fail(400, `Please complete the required field: ${f.label || f.type}`)
        }
        f.value = f.type === 'date' ? '09/24/2026' : v ?? null
      }
      recipient.status = 'signed'
      recipient.signed_at = now()
      for (const [t, id] of db.tokens) if (id === recipient.id) db.tokens.delete(t)
      addAudit(db, env.id, 'recipient_signed', recipient.id)
      const complete = db.recipients.filter(r => r.envelope_id === env.id && r.role === 'signer').every(r => r.status === 'signed')
      if (complete) {
        env.status = 'completed'
        env.final_path = `${env.id}/signed.pdf`
        db.files.set(`documents/${env.final_path}`, db.files.get(`documents/${env.original_path}`))
        addAudit(db, env.id, 'envelope_completed')
      } else {
        issueTokens(db, env)
      }
      return json(route, 200, { complete })
    }
    return fail(404, 'Not found')
  })
}

/** Sign in as another team member in the same browser context. */
export function sessionFor(user) {
  return fakeSession(user)
}
