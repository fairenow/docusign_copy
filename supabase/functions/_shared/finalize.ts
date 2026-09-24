import { admin, audit, rpc } from './supabase.ts'
import { emailConfig } from './config.ts'
import { sendEmail } from './mail.ts'
import { sha256Hex, toBase64 } from './crypto.ts'
import { loadPdf, stampFields, elementsFromFieldRows } from './pdfStamp.js'
import { appendCertificate } from './certificate.js'
import { completedEmail } from './emails.js'

// Resend's attachment limit is 40 MB after base64 encoding
const MAX_ATTACHMENT_BYTES = 28 * 1024 * 1024

/**
 * Build the signed PDF (field values + certificate of completion), store it, mark the
 * envelope completed and email everyone a copy. Safe to retry: it only completes an
 * envelope that is fully signed and still 'sent'.
 */
export async function finalizeEnvelope(envelopeId: string) {
  const { data: envelope, error } = await admin
    .from('envelopes')
    .select('*, owner:profiles!envelopes_owner_id_fkey (full_name, email), recipients (*), fields (*)')
    .eq('id', envelopeId)
    .single()
  if (error) throw error
  if (envelope.status !== 'sent') return { status: envelope.status }

  const [{ data: events, error: eventsError }, { data: file, error: downloadError }] = await Promise.all([
    admin
      .from('audit_events')
      .select('created_at, action, ip, recipient_id, actor_user_id')
      .eq('envelope_id', envelopeId)
      .order('id'),
    admin.storage.from('documents').download(envelope.original_path)
  ])
  if (eventsError) throw eventsError
  if (downloadError) throw downloadError

  // deno-lint-ignore no-explicit-any
  const recipients = [...envelope.recipients].sort((a: any, b: any) => a.routing_order - b.routing_order)
  // deno-lint-ignore no-explicit-any
  const owner = envelope.owner as any
  const ownerName = owner?.full_name || owner?.email
  // deno-lint-ignore no-explicit-any
  const nameOf = (e: any) => recipients.find((r: any) => r.id === e.recipient_id)?.name ?? (e.actor_user_id === envelope.owner_id ? ownerName : '')

  const doc = await loadPdf(new Uint8Array(await file.arrayBuffer()))
  await stampFields(doc, elementsFromFieldRows(envelope.fields))
  await appendCertificate(doc, {
    envelope: { ...envelope, completed_at: new Date().toISOString() },
    sender: { name: ownerName, email: owner?.email },
    // deno-lint-ignore no-explicit-any
    recipients: recipients.map((r: any) => ({
      ...r,
      // deno-lint-ignore no-explicit-any
      signature: envelope.fields.find((f: any) => f.recipient_id === r.id && f.type === 'signature' && f.value)?.value
    })),
    // deno-lint-ignore no-explicit-any
    events: events.map((e: any) => ({ ...e, who: nameOf(e) }))
  })
  doc.setTitle(envelope.title)
  doc.setModificationDate(new Date())
  // Copy into a plain ArrayBuffer-backed array for hashing and upload
  let bytes = new Uint8Array(await doc.save())
  const signedPath = `${envelopeId}/signed.pdf`

  // Never overwrite: a concurrent finalize (background step + owner retry) could otherwise replace
  // the file after the other one recorded its hash. If a signed copy already exists (a concurrent
  // run, or an earlier run that stopped before completing), use that copy so file and hash agree.
  const { error: uploadError } = await admin.storage
    .from('documents')
    .upload(signedPath, new Blob([bytes], { type: 'application/pdf' }), { upsert: false, contentType: 'application/pdf' })
  if (uploadError) {
    const { status, statusCode } = uploadError as { status?: number; statusCode?: string }
    if (status !== 409 && statusCode !== '409') throw uploadError
    const { data: existing, error: existingError } = await admin.storage.from('documents').download(signedPath)
    if (existingError) throw existingError
    bytes = new Uint8Array(await existing.arrayBuffer())
  }
  const finalSha = await sha256Hex(bytes)

  try {
    await rpc('svc_mark_completed', { p_envelope_id: envelopeId, p_final_sha256: finalSha })
  } catch (err) {
    // Another request completed it first
    if ((err as { code?: string }).code === '55000') return { status: 'completed' }
    throw err
  }

  // Everyone gets a copy: signers, CC recipients and the sender
  let appUrl: string | null = null
  try {
    appUrl = emailConfig().appUrl
  } catch (err) {
    console.error(err)
  }
  const attachment = bytes.length <= MAX_ATTACHMENT_BYTES
    ? [{ filename: `${envelope.title.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'document'}_signed.pdf`, content: toBase64(bytes) }]
    : undefined
  // deno-lint-ignore no-explicit-any
  const people = new Map<string, { name: string; recipientId: string | null }>(recipients.map((r: any) => [r.email.toLowerCase(), { name: r.name, recipientId: r.id }]))
  if (owner?.email && !people.has(owner.email.toLowerCase())) people.set(owner.email.toLowerCase(), { name: ownerName, recipientId: null })

  for (const [email, person] of people) {
    const isOwner = email === owner?.email?.toLowerCase()
    try {
      if (!appUrl) throw new Error('Email is not configured')
      await sendEmail({
        to: email,
        ...completedEmail({ recipientName: person.name, title: envelope.title, link: isOwner ? `${appUrl}/envelopes/${envelopeId}` : null }),
        attachments: attachment
      })
    } catch (err) {
      console.error(err)
      await audit(envelopeId, 'email_failed', { email, kind: 'completed' }, person.recipientId)
    }
  }
  return { status: 'completed' }
}

/** Finalize, recording a failure in the audit trail so the sender can retry from the app. */
export async function finalizeOrRecordFailure(envelopeId: string) {
  try {
    return await finalizeEnvelope(envelopeId)
  } catch (err) {
    await audit(envelopeId, 'finalize_failed', { reason: (err as Error).message?.slice(0, 300) })
    throw err
  }
}
