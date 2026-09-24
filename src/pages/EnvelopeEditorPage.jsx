import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Save, Send } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import { downloadDocument, fetchEnvelope, saveDraft } from '../lib/api'
import {
  draftFromEnvelope, moveRecipient, newField, newRecipient, renumberRecipients,
  validateForSave, validateForSend, canEdit, RECIPIENT_COLORS, STATUS_LABELS
} from '../lib/envelopeModel'
import { nextFieldY } from '../lib/fields'
import { usePdf } from '../hooks/usePdf'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import DocumentViewer from '../components/DocumentViewer'
import PageControls from '../components/PageControls'
import PlaceholderField from '../components/envelope/PlaceholderField'
import FullPageMessage from '../components/FullPageMessage'
import RecipientsPanel from '../components/envelope/RecipientsPanel'
import FieldPalette from '../components/envelope/FieldPalette'
import FieldProperties from '../components/envelope/FieldProperties'
import SendChecklist from '../components/envelope/SendChecklist'

/**
 * Prepare a draft envelope: recipients, signing order, message, and fields
 * assigned to each signer. Envelopes that are not editable open read-only.
 */
export default function EnvelopeEditorPage() {
  const { envelopeId } = useParams()
  const { user } = useAuth()

  const [envelope, setEnvelope] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [pdfBytes, setPdfBytes] = useState(null)
  const [draft, setDraft] = useState(null)
  const [savedDraft, setSavedDraft] = useState(null)
  const [saveState, setSaveState] = useState({ saving: false, problems: [], error: null })
  const [activeRecipientId, setActiveRecipientId] = useState(null)
  const [selectedFieldId, setSelectedFieldId] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const { doc: pdfDoc, pageSizes, error: pdfError } = usePdf(pdfBytes)

  // Load the envelope and its document
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await fetchEnvelope(envelopeId)
        if (cancelled) return
        const initial = draftFromEnvelope(loaded)
        setEnvelope(loaded)
        setDraft(initial)
        setSavedDraft(initial)
        setActiveRecipientId(initial.recipients.find(r => r.role === 'signer')?.id ?? null)
        if (!loaded.original_path) throw new Error('This envelope has no document.')
        const bytes = await downloadDocument(loaded.original_path)
        if (!cancelled) setPdfBytes(bytes)
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      }
    })()
    return () => { cancelled = true }
  }, [envelopeId])

  const editable = Boolean(envelope) && canEdit(envelope, user)
  const dirty = useMemo(
    () => editable && draft !== savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [editable, draft, savedDraft]
  )
  const sendProblems = useMemo(() => (draft ? validateForSend(draft) : []), [draft])

  useUnsavedChangesWarning(dirty)

  const update = useCallback((patch) => setDraft(d => ({ ...d, ...patch })), [])

  // Editing clears the previous save's error banner
  useEffect(() => {
    setSaveState(s => (s.problems.length || s.error ? { ...s, problems: [], error: null } : s))
  }, [draft])

  // Recipients ---------------------------------------------------------------
  const addRecipient = () => {
    const recipient = newRecipient(draft.recipients)
    update({ recipients: [...draft.recipients, recipient] })
    setActiveRecipientId(recipient.id)
  }

  const changeRecipient = (id, patch) => {
    setDraft(d => {
      const recipients = d.recipients.map(r => (r.id === id ? { ...r, ...patch } : r))
      // CC recipients receive a copy only, so their fields are removed
      const fields = patch.role === 'cc' ? d.fields.filter(f => f.recipientId !== id) : d.fields
      return { ...d, recipients, fields }
    })
    if (patch.role === 'cc' && activeRecipientId === id) setActiveRecipientId(null)
  }

  const removeRecipient = (id) => {
    const count = draft.fields.filter(f => f.recipientId === id).length
    if (count && !window.confirm(`Remove this recipient and their ${count} field${count > 1 ? 's' : ''}?`)) return
    setDraft(d => ({
      ...d,
      recipients: renumberRecipients(d.recipients.filter(r => r.id !== id)),
      fields: d.fields.filter(f => f.recipientId !== id)
    }))
    if (activeRecipientId === id) setActiveRecipientId(null)
  }

  // Fields -------------------------------------------------------------------
  const addField = (type) => {
    const pageSize = pageSizes[currentPage - 1]
    if (!pageSize || !activeRecipientId) return
    const field = newField(type, { page: currentPage, pageSize }, activeRecipientId, { y: nextFieldY(draft.fields, currentPage) })
    update({ fields: [...draft.fields, field] })
    setSelectedFieldId(field.id)
  }

  const updateField = useCallback((id, patch) => {
    setDraft(d => ({ ...d, fields: d.fields.map(f => (f.id === id ? { ...f, ...patch } : f)) }))
  }, [])

  const deleteField = useCallback((id) => {
    setDraft(d => ({ ...d, fields: d.fields.filter(f => f.id !== id) }))
    setSelectedFieldId(current => (current === id ? null : current))
  }, [])

  // Saving -------------------------------------------------------------------
  const save = useCallback(async () => {
    if (!editable || saveState.saving) return
    const problems = validateForSave(draft)
    if (problems.length) {
      setSaveState({ saving: false, problems, error: null })
      return
    }
    setSaveState({ saving: true, problems: [], error: null })
    try {
      await saveDraft(envelopeId, draft)
      setSavedDraft(draft)
      setSaveState({ saving: false, problems: [], error: null })
    } catch (err) {
      setSaveState({ saving: false, problems: [], error: err.message })
    }
  }, [editable, saveState.saving, draft, envelopeId])

  // Ctrl/Cmd+S saves
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [save])

  const recipientsById = useMemo(
    () => new Map((draft?.recipients ?? []).map(r => [r.id, r])),
    [draft?.recipients]
  )
  const renderField = useCallback((field) => {
    const r = recipientsById.get(field.recipientId)
    return <PlaceholderField field={field} color={r?.color ?? RECIPIENT_COLORS[0]} assignee={r?.name || r?.email || 'Unassigned'} />
  }, [recipientsById])

  if (loadError) {
    return (
      <FullPageMessage title="Could not open envelope">
        {loadError} <Link to="/" className="text-blue-400 underline">Back to envelopes</Link>
      </FullPageMessage>
    )
  }
  if (!draft) return <FullPageMessage title="Loading…" />

  const activeRecipient = draft.recipients.find(r => r.id === activeRecipientId && r.role === 'signer')
  const selectedField = editable ? draft.fields.find(f => f.id === selectedFieldId) : null
  const saveStatus = saveState.saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar */}
      <div className="px-5 py-3 bg-dark-800 border-b border-dark-700 flex items-center gap-4">
        <Link to="/" className="p-1.5 rounded-lg text-dark-400 hover:text-white hover:bg-dark-700" title="Back to envelopes">
          <ArrowLeft size={18} />
        </Link>
        {editable ? (
          <input
            value={draft.title}
            onChange={(e) => update({ title: e.target.value })}
            maxLength={200}
            className="flex-1 min-w-0 bg-transparent text-lg text-gray-100 font-medium outline-none border-b border-transparent focus:border-dark-500"
            aria-label="Envelope title"
          />
        ) : (
          <h1 className="flex-1 min-w-0 text-lg text-gray-100 font-medium truncate">{draft.title}</h1>
        )}
        {editable ? (
          <>
            <span className={`text-xs whitespace-nowrap ${dirty ? 'text-amber-300' : 'text-dark-400'}`} data-testid="save-status">{saveStatus}</span>
            <button
              onClick={save}
              disabled={!dirty || saveState.saving}
              className="px-4 py-2 rounded-lg bg-dark-700 border border-dark-600 text-gray-100 text-sm flex items-center gap-2 hover:bg-dark-600 disabled:opacity-50"
            >
              <Save size={16} /> Save
            </button>
            <button
              disabled
              title="Sending by email arrives in the next update"
              className="px-4 py-2 btn-gradient rounded-lg text-white text-sm flex items-center gap-2 opacity-50 cursor-not-allowed"
            >
              <Send size={16} /> Send
            </button>
          </>
        ) : (
          <span className="text-xs text-dark-400 whitespace-nowrap">{STATUS_LABELS[envelope.status]} · read only</span>
        )}
      </div>

      {(saveState.problems.length > 0 || saveState.error) && (
        <div role="alert" className="px-5 py-2 bg-red-500/10 border-b border-red-500/30 text-sm text-red-300">
          {saveState.error ? `Could not save: ${saveState.error}` : saveState.problems.join(' ')}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Left panel */}
        <aside className="w-80 flex-shrink-0 bg-dark-800 border-r border-dark-700 p-4 space-y-6 overflow-y-auto">
          <RecipientsPanel
            recipients={draft.recipients}
            signingOrder={draft.signingOrder}
            activeRecipientId={activeRecipientId}
            readOnly={!editable}
            onActivate={setActiveRecipientId}
            onAdd={addRecipient}
            onChange={changeRecipient}
            onRemove={removeRecipient}
            onMove={(id, delta) => update({ recipients: moveRecipient(draft.recipients, id, delta) })}
            onSigningOrderChange={(signingOrder) => update({ signingOrder })}
          />

          {editable && <FieldPalette recipient={activeRecipient} documentReady={pageSizes.length > 0} onAdd={addField} />}

          <section>
            <h2 className="section-heading mb-2">Message to recipients</h2>
            {editable ? (
              <textarea
                value={draft.message}
                onChange={(e) => update({ message: e.target.value })}
                maxLength={5000}
                rows={4}
                placeholder="Optional note included in the email"
                className="w-full bg-dark-700 border border-dark-600 rounded-lg p-2 text-sm text-gray-100 placeholder-dark-500 resize-y"
              />
            ) : (
              <p className="text-sm text-dark-400 whitespace-pre-wrap">{draft.message || 'No message.'}</p>
            )}
          </section>

          {editable && <SendChecklist problems={sendProblems} />}
        </aside>

        {/* Document */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-5 py-2 bg-dark-800 border-b border-dark-700 flex items-center justify-between">
            <PageControls
              currentPage={currentPage}
              totalPages={pageSizes.length}
              zoom={zoom}
              onPageChange={setCurrentPage}
              onZoomChange={setZoom}
            />
            <span className="text-xs text-dark-500">{envelope.original_filename}</span>
          </div>
          {pdfError ? (
            <FullPageMessage title="Could not open the document">{pdfError.message}</FullPageMessage>
          ) : (
            <DocumentViewer
              pdfDoc={pdfDoc}
              pageSizes={pageSizes}
              elements={draft.fields}
              currentPage={currentPage}
              zoom={zoom}
              renderField={renderField}
              readOnly={!editable}
              selectedId={selectedFieldId}
              onSelectedIdChange={setSelectedFieldId}
              onUpdateElement={updateField}
              onDeleteElement={deleteField}
            />
          )}
        </div>

        {selectedField && (
          <FieldProperties
            field={selectedField}
            recipients={draft.recipients}
            onChange={(patch) => updateField(selectedField.id, patch)}
            onDelete={() => deleteField(selectedField.id)}
            onClose={() => setSelectedFieldId(null)}
          />
        )}
      </div>
    </div>
  )
}
