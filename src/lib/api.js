/**
 * All Supabase access for envelopes lives here. Functions throw an Error with a
 * readable message on failure; callers decide how to show it.
 */
import { supabase } from './supabase'
import { fileToPdfBytes, openPdf, stripExtension } from './documents'
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

export const originalPath = (envelopeId) => `${envelopeId}/original.pdf`

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function fetchProfile(userId) {
  return unwrap(await client().from('profiles').select('id, email, full_name, role').eq('id', userId).maybeSingle())
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

const LIST_COLUMNS = 'id, owner_id, title, status, signing_order, original_filename, page_count, sent_at, completed_at, updated_at, created_at, ' +
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
  const { doc, pageSizes } = await openPdf(bytes)
  doc.destroy()

  const db = client()
  const { id } = unwrap(await db
    .from('envelopes')
    .insert({ title: stripExtension(file.name).slice(0, 200) || 'Untitled', original_filename: file.name.slice(0, 255), page_count: pageSizes.length })
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
export function subscribeToEnvelopeChanges(onChange) {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('envelope-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'envelopes' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'recipients' }, onChange)
    .subscribe()
  return () => { supabase.removeChannel(channel) }
}
