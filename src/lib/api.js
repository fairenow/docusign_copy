/**
 * All Supabase access for envelopes lives here. Functions throw an Error with a
 * readable message on failure; callers decide how to show it.
 */
import { supabase } from './supabase'
import { fileToPdfBytes, stripExtension } from './documents'
import { fieldToRow, recipientToRow } from './envelopeModel'

const BUCKET = 'documents'

function client() {
  if (!supabase) throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.')
  return supabase
}

function unwrap({ data, error }) {
  if (error) throw toError(error)
  return data
}

function toError(error) {
  const message = error.message || String(error)
  // Surface constraint violations in plain language
  if (error.code === '23505' && /recipients_envelope_email_key/.test(message)) {
    return new Error('Each recipient needs a different email address.')
  }
  if (error.code === 'P0002') return new Error('This envelope no longer exists or can no longer be edited.')
  return new Error(message)
}

const originalPath = (envelopeId) => `${envelopeId}/original.pdf`

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function fetchProfile(userId) {
  return unwrap(await client().from('profiles').select('id, email, full_name, role').eq('id', userId).maybeSingle())
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

const LIST_COLUMNS = 'id, owner_id, title, status, signing_order, original_filename, page_count, final_path, sent_at, completed_at, updated_at, created_at, ' +
  'recipients (id, name, email, role, routing_order, status, signed_at)'

export async function listEnvelopes() {
  return unwrap(await client().from('envelopes').select(LIST_COLUMNS).order('updated_at', { ascending: false }).limit(500))
}

export async function fetchEnvelope(id) {
  const envelope = unwrap(await client()
    .from('envelopes')
    .select('*, recipients (*), fields (*)')
    .eq('id', id)
    .maybeSingle())
  if (!envelope) throw new Error('Envelope not found, or you do not have access to it.')
  return envelope
}

/**
 * Create a draft envelope from an uploaded file: validate and convert it first,
 * then create the row and upload the PDF. The row is removed if the upload fails.
 * @returns {Promise<string>} the new envelope id
 */
export async function createEnvelopeFromFile(file) {
  const { bytes } = await fileToPdfBytes(file)
  // Only the page count is needed here; opening validates the PDF
  const { loadPdfDocument } = await import('./pdfjs')
  const doc = await loadPdfDocument(bytes)
  const pageCount = doc.numPages
  doc.destroy()

  const db = client()
  const { id } = unwrap(await db
    .from('envelopes')
    .insert({ title: stripExtension(file.name).slice(0, 200) || 'Untitled', original_filename: file.name.slice(0, 255), page_count: pageCount })
    .select('id')
    .single())

  try {
    unwrap(await db.storage.from(BUCKET).upload(originalPath(id), new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: false }))
    unwrap(await db.from('envelopes').update({ original_path: originalPath(id) }).eq('id', id))
  } catch (err) {
    await db.storage.from(BUCKET).remove([originalPath(id)])
    await db.from('envelopes').delete().eq('id', id)
    throw err
  }
  return id
}

export async function downloadDocument(path) {
  const blob = unwrap(await client().storage.from(BUCKET).download(path))
  return new Uint8Array(await blob.arrayBuffer())
}

/** Save title, message, signing order, recipients and fields in one transaction. */
export async function saveDraft(envelopeId, draft) {
  unwrap(await client().rpc('save_envelope_draft', {
    p_envelope_id: envelopeId,
    p_title: draft.title.trim(),
    p_message: draft.message.trim() || null,
    p_signing_order: draft.signingOrder,
    p_recipients: draft.recipients.map(recipientToRow),
    p_fields: draft.fields.map(fieldToRow)
  }))
}

/** Delete a draft and its stored document. Storage goes first: its policy needs the draft row. */
export async function deleteDraft(envelope) {
  const db = client()
  // Removing a file that was never uploaded is not an error
  unwrap(await db.storage.from(BUCKET).remove([originalPath(envelope.id)]))
  unwrap(await db.from('envelopes').delete().eq('id', envelope.id).eq('status', 'draft'))
}

export async function voidEnvelope(envelopeId, reason) {
  return unwrap(await client().rpc('void_envelope', { envelope_id: envelopeId, reason: reason?.trim() || null }))
}

/**
 * Call `onChange` whenever envelopes or recipients visible to the user change.
 * Realtime respects RLS, so only rows the user may see are delivered.
 * @returns {() => void} unsubscribe
 */
export function subscribeToEnvelopeChanges(onChange, envelopeId = null) {
  if (!supabase) return () => {}
  // With an envelope id, only changes to that envelope and its recipients are delivered
  const envelopeFilter = envelopeId ? { filter: `id=eq.${envelopeId}` } : {}
  const recipientFilter = envelopeId ? { filter: `envelope_id=eq.${envelopeId}` } : {}
  const channel = supabase
    // Unique per subscription: channel() returns an existing channel with the same topic, and a
    // remount (StrictMode, quick navigation) would otherwise reuse one that is still leaving
    .channel(`envelope-changes-${crypto.randomUUID()}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'envelopes', ...envelopeFilter }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'recipients', ...recipientFilter }, onChange)
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}

// ---------------------------------------------------------------------------
// Signing workflow (Edge Function "signing-api")
// ---------------------------------------------------------------------------

/**
 * Call a signing-api route. Works both for signed-in team members (their session is sent)
 * and for external signers using a link (identified by the token in the body).
 */
// FunctionsHttpError carries the response; surface the server's message
async function functionError(error) {
  const message = await error.context?.json?.().then(b => b?.error).catch(() => null)
  return new Error(message || error.message)
}

async function signingApi(route, body) {
  const { data, error } = await client().functions.invoke(`signing-api/${route}`, { body })
  if (error) throw await functionError(error)
  return data
}

/**
 * Convert a Word/OpenDocument/RTF file to PDF on the server (LibreOffice), so the pages
 * look exactly like the original. Team members only.
 */
export async function convertDocumentToPdf(file) {
  const { data: { session } } = await client().auth.getSession()
  if (!session) throw new Error('Sign in to upload Word documents, or upload a PDF instead.')
  const { data, error } = await client().functions.invoke(`convert-document?name=${encodeURIComponent(file.name)}`, { body: file })
  if (error) throw await functionError(error)
  return new Uint8Array(await data.arrayBuffer())
}

/** A signer is identified by their link token, or (team members) by envelope id + session. */
export const getSigningSession = (identity) => signingApi('session', identity)
export const submitSigning = (identity, values, consent) => signingApi('submit', { ...identity, values, consent })
export const declineSigning = (identity, reason) => signingApi('decline', { ...identity, reason })

export const sendEnvelope = (envelopeId) => signingApi('send', { envelopeId })
export const resendSigningLink = (envelopeId, recipientId) => signingApi('resend', { envelopeId, recipientId })
export const retryFinalize = (envelopeId) => signingApi('finalize', { envelopeId })

/** Save the completed envelope's signed PDF to the user's computer. */
export async function downloadSignedPdf(envelope) {
  const { downloadPdf } = await import('./exportPdf')
  downloadPdf(await downloadDocument(envelope.final_path), envelope.title)
}

export async function listAuditEvents(envelopeId) {
  return unwrap(await client()
    .from('audit_events')
    .select('id, created_at, action, recipient_id, actor_user_id, ip, details')
    .eq('envelope_id', envelopeId)
    .order('id'))
}

// ---------------------------------------------------------------------------
// Saved signatures (private to the signed-in user)
// ---------------------------------------------------------------------------

const SAVED_COLUMNS = 'id, kind, image, created_at'

export async function listSavedSignatures() {
  return unwrap(await client().from('saved_signatures').select(SAVED_COLUMNS).order('created_at', { ascending: false }))
}

/** kind: 'signature' | 'initials'; image: PNG data URL */
export async function saveSignature(kind, image) {
  return unwrap(await client().from('saved_signatures').insert({ kind, image }).select(SAVED_COLUMNS).single())
}

export async function deleteSavedSignature(id) {
  unwrap(await client().from('saved_signatures').delete().eq('id', id))
}
