/**
 * All Supabase access for envelopes lives here. Functions throw an Error with a
 * readable message on failure; callers decide how to show it.
 */
import { supabase } from './supabase'
import { fileToPdfBytes, stripExtension } from './documents'
import { fieldToRow, recipientToRow } from './envelopeModel'
import { peopleToRows, templateRolesToRows } from './templateModel'

const BUCKET = 'documents'
const TEMPLATE_BUCKET = 'templates'

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
  if (error.code === '23505' && /template_roles_template_name_key/.test(message)) {
    return new Error('Each role needs a different name.')
  }
  if (error.code === 'P0002' && /template/i.test(message)) return new Error('This template no longer exists or is not shared with you.')
  if (error.code === 'P0002') return new Error('This envelope no longer exists or can no longer be edited.')
  return new Error(message)
}

// Envelopes and templates store their document as <id>/original.pdf in their bucket
export const originalPath = (id) => `${id}/original.pdf`
const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' })
const PDF_UPLOAD = { contentType: 'application/pdf', upsert: false }

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export async function fetchProfile(userId) {
  return unwrap(await client().from('profiles').select('id, email, full_name, role').eq('id', userId).maybeSingle())
}

// ---------------------------------------------------------------------------
// Envelopes
// ---------------------------------------------------------------------------

const OWNER_COLUMNS = 'owner:profiles!envelopes_owner_id_fkey (full_name, email)'
const LIST_COLUMNS = 'id, owner_id, title, status, signing_order, original_filename, page_count, final_path, sent_at, completed_at, expires_at, updated_at, created_at, ' +
  `recipients (id, name, email, role, routing_order, status, signed_at), ${OWNER_COLUMNS}`

export async function listEnvelopes() {
  // Working copies used to edit a template are not envelopes to the user
  return unwrap(await client().from('envelopes').select(LIST_COLUMNS).is('editing_template_id', null)
    .order('updated_at', { ascending: false }).limit(500))
}

export async function fetchEnvelope(id) {
  const envelope = unwrap(await client()
    .from('envelopes')
    .select(`*, recipients (*), fields (*), ${OWNER_COLUMNS}`)
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
  // pdf.js loads while a Word document is being converted
  const pdfjs = import('./pdfjs')
  const { bytes } = await fileToPdfBytes(file)
  // Only the page count is needed here; opening validates the PDF
  const { loadPdfDocument } = await pdfjs
  const doc = await loadPdfDocument(bytes)
  const pageCount = doc.numPages
  doc.destroy()

  const { id } = unwrap(await client()
    .from('envelopes')
    .insert({ title: stripExtension(file.name).slice(0, 200) || 'Untitled', original_filename: file.name.slice(0, 255), page_count: pageCount })
    .select('id')
    .single())
  await attachDocument(id, bytes)
  return id
}

/** Store a new draft's PDF and record its path. The draft is removed if that fails. */
async function attachDocument(envelopeId, bytes) {
  const db = client()
  try {
    unwrap(await db.storage.from(BUCKET).upload(originalPath(envelopeId), pdfBlob(bytes), PDF_UPLOAD))
    unwrap(await db.from('envelopes').update({ original_path: originalPath(envelopeId) }).eq('id', envelopeId))
    justUploaded.set(originalPath(envelopeId), bytes)
  } catch (err) {
    await db.storage.from(BUCKET).remove([originalPath(envelopeId)])
    await db.from('envelopes').delete().eq('id', envelopeId)
    throw err
  }
}

// A document this tab just uploaded, handed to the editor it opens next instead of downloading it
// again. Used once, then forgotten.
const justUploaded = new Map()

export async function downloadDocument(path, bucket = BUCKET) {
  if (bucket === BUCKET && justUploaded.has(path)) {
    const bytes = justUploaded.get(path)
    justUploaded.delete(path)
    return bytes
  }
  const blob = unwrap(await client().storage.from(bucket).download(path))
  return new Uint8Array(await blob.arrayBuffer())
}

/** Save title, message, signing order, recipients and fields in one transaction. */
export async function saveDraft(envelopeId, draft) {
  unwrap(await client().rpc('save_envelope_draft', {
    p_envelope_id: envelopeId,
    p_title: draft.title.trim(),
    p_message: draft.message.trim() || null,
    p_signing_order: draft.signingOrder,
    p_remind_every_days: draft.remindEveryDays,
    p_expire_after_days: draft.expireAfterDays,
    p_allow_signer_adjustments: draft.allowSignerAdjustments,
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
// Templates (shared with the team unless made private)
// ---------------------------------------------------------------------------

const TEMPLATE_COLUMNS = 'id, owner_id, name, original_filename, page_count, signing_order, shared, created_at, ' +
  'owner:profiles!templates_owner_id_fkey (full_name, email), ' +
  'template_roles (id, name, role, routing_order, color, default_name, default_email)'

export async function listTemplates() {
  return unwrap(await client().from('templates').select(TEMPLATE_COLUMNS).order('created_at', { ascending: false }))
}

/**
 * Save an envelope's document, settings and fields as a template.
 * roles: one per recipient ({ recipientId, name, keepRecipient }); returns the template id.
 */
export async function saveAsTemplate(envelope, name, roles) {
  const db = client()
  const id = unwrap(await db.rpc('create_template_from_envelope', {
    p_envelope_id: envelope.id,
    p_name: name.trim(),
    p_roles: templateRolesToRows(roles)
  }))
  try {
    const bytes = await downloadDocument(envelope.original_path)
    unwrap(await db.storage.from(TEMPLATE_BUCKET).upload(originalPath(id), pdfBlob(bytes), PDF_UPLOAD))
  } catch (err) {
    await db.from('templates').delete().eq('id', id)
    throw err
  }
  return id
}

/** Create a draft envelope from a template. people: { [roleId]: { name, email } }; returns the envelope id. */
export async function createEnvelopeFromTemplate(template, title, people) {
  const db = client()
  const id = unwrap(await db.rpc('create_envelope_from_template', {
    p_template_id: template.id,
    p_title: title.trim(),
    p_people: peopleToRows(people)
  }))
  await attachTemplateDocument(id, template.id)
  return id
}

/** Give a new draft a copy of the template's document. The draft is removed if that fails. */
async function attachTemplateDocument(envelopeId, templateId) {
  let bytes
  try {
    bytes = await downloadDocument(originalPath(templateId), TEMPLATE_BUCKET)
  } catch (err) {
    await client().from('envelopes').delete().eq('id', envelopeId)
    throw err
  }
  await attachDocument(envelopeId, bytes)
}

/**
 * Open a template in the editor: a private working copy (a draft envelope whose recipients
 * are the roles). Reopens your unfinished copy if there is one; returns the envelope id.
 */
export async function startTemplateEdit(template) {
  const { envelope_id: id, resumed } = unwrap(await client().rpc('start_template_edit', { p_template_id: template.id }))
  if (!resumed) await attachTemplateDocument(id, template.id)
  return id
}

/** Write the (saved) working copy back to its template, then discard the copy. */
export async function finishTemplateEdit(envelope) {
  unwrap(await client().rpc('finish_template_edit', { p_envelope_id: envelope.id }))
  await deleteDraft(envelope)
}

export const cancelTemplateEdit = deleteDraft

/** Delete a template and its document. Storage goes first: its policy needs the template row. */
export async function deleteTemplate(template) {
  const db = client()
  unwrap(await db.storage.from(TEMPLATE_BUCKET).remove([originalPath(template.id)]))
  unwrap(await db.from('templates').delete().eq('id', template.id))
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
export const submitSigning = (identity, values, consent, positions = {}) => signingApi('submit', { ...identity, values, consent, positions })
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
    .select('id, created_at, action, recipient_id, actor_user_id, ip, details, actor:profiles!audit_events_actor_user_id_fkey (full_name, email)')
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
