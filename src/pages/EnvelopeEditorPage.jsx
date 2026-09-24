import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, PenLine, RotateCw, Save, Send } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import {
  downloadDocument, downloadSignedPdf, fetchEnvelope, listAuditEvents, resendSigningLink, retryFinalize, saveDraft, sendEnvelope,
  subscribeToEnvelopeChanges
} from '../lib/api'
import {
  draftFromEnvelope, moveRecipient, newField, newRecipient, renumberRecipients,
  validateForSave, validateForSend, canEdit, canVoid, envelopeGroup, RECIPIENT_COLORS, STATUS_LABELS
} from '../lib/envelopeModel'
import { nextFieldY } from '../lib/fields'
import { usePdf } from '../hooks/usePdf'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import DocumentViewer from '../components/DocumentViewer'
import PageControls from '../components/PageControls'
import PlaceholderField from '../components/envelope/PlaceholderField'
import FullPageMessage from '../components/FullPageMessage'
import RecipientsPanel from '../components/envelope/RecipientsPanel'
import FieldRail from '../components/envelope/FieldRail'
import FieldProperties from '../components/envelope/FieldProperties'
import SendChecklist from '../components/envelope/SendChecklist'
import ActivityPanel from '../components/envelope/ActivityPanel'
import ErrorBanner from '../components/ErrorBanner'

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
  const [tab, setTab] = useState('recipients') // right panel: 'recipients' | 'field'
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [events, setEvents] = useState([])
  const [action, setAction] = useState({ busy: null, error: null }) // busy: 'send' | 'finalize' | recipientId
  const { doc: pdfDoc, pageSizes, error: pdfError } = usePdf(pdfBytes)

  // (Re)load the envelope and, once sent, its activity. The document itself is loaded once.
  const reload = useCallback(async () => {
    // Drafts have no activity yet; the query simply returns their "created" event
    const [loaded, activity] = await Promise.all([fetchEnvelope(envelopeId), listAuditEvents(envelopeId)])
    const next = draftFromEnvelope(loaded)
    setEnvelope(loaded)
    setDraft(next)
    setSavedDraft(next)
    setEvents(activity)
    return loaded
  }, [envelopeId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const loaded = await reload()
        if (cancelled) return
        setActiveRecipientId(loaded.recipients.find(r => r.role === 'signer')?.id ?? null)
        if (!loaded.original_path) throw new Error('This envelope has no document.')
        const bytes = await downloadDocument(loaded.original_path)
        if (!cancelled) setPdfBytes(bytes)
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      }
    })()
    return () => { cancelled = true }
  }, [reload])

  // Keep a sent envelope's progress live as signers view and sign
  const isSent = envelope ? envelope.status !== 'draft' : false
  useEffect(() => {
    if (!isSent) return
    let timer = null
    const unsubscribe = subscribeToEnvelopeChanges(() => {
      clearTimeout(timer)
      timer = setTimeout(() => reload().catch(() => {}), 500)
    }, envelopeId)
    return () => {
      clearTimeout(timer)
      unsubscribe()
    }
  }, [isSent, reload, envelopeId])

  const editable = Boolean(envelope) && canEdit(envelope, user)
  const dirty = useMemo(
    () => editable && draft !== savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [editable, draft, savedDraft]
  )
  const sendProblems = useMemo(() => (draft ? validateForSend(draft) : []), [draft])
  const mySigningTurn = Boolean(envelope && user) && envelopeGroup(envelope, user) === 'action'
  // Everyone signed but the final PDF was not produced (e.g. a failed background step)
  const awaitingFinalize = Boolean(envelope) && envelope.status === 'sent' && canVoid(envelope, user) &&
    envelope.recipients.every(r => r.role !== 'signer' || r.status === 'signed')

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
    // Highlight the new field but stay on the current tab, so several can be placed in a row
    setSelectedFieldId(field.id)
  }

  // Clicking a field opens its settings; clearing the selection goes back to recipients
  const selectField = useCallback((id) => {
    setSelectedFieldId(id)
    setTab(id ? 'field' : 'recipients')
  }, [])

  const updateField = useCallback((id, patch) => {
    setDraft(d => ({ ...d, fields: d.fields.map(f => (f.id === id ? { ...f, ...patch } : f)) }))
  }, [])

  const deleteField = useCallback((id) => {
    setDraft(d => ({ ...d, fields: d.fields.filter(f => f.id !== id) }))
    setSelectedFieldId(current => (current === id ? null : current))
  }, [])

  // Saving -------------------------------------------------------------------
  // Returns true once the current draft is stored
  const save = useCallback(async () => {
    if (!editable || saveState.saving) return false
    const problems = validateForSave(draft)
    if (problems.length) {
      setSaveState({ saving: false, problems, error: null })
      return false
    }
    setSaveState({ saving: true, problems: [], error: null })
    try {
      await saveDraft(envelopeId, draft)
      setSavedDraft(draft)
      setSaveState({ saving: false, problems: [], error: null })
      return true
    } catch (err) {
      setSaveState({ saving: false, problems: [], error: err.message })
      return false
    }
  }, [editable, saveState.saving, draft, envelopeId])

  // Sending ------------------------------------------------------------------
  const runAction = async (busy, fn) => {
    setAction({ busy, error: null })
    try {
      await fn()
      setAction({ busy: null, error: null })
    } catch (err) {
      setAction({ busy: null, error: err.message })
    }
  }

  const handleSend = () => {
    if (sendProblems.length) return
    const signers = draft.recipients.filter(r => r.role === 'signer')
    const first = draft.signingOrder === 'sequential' ? signers.slice(0, 1) : signers
    const who = first.map(r => r.name).join(', ')
    if (!window.confirm(`Send "${draft.title}" for signature?\n\n${who} will be emailed a signing link${draft.signingOrder === 'sequential' && signers.length > 1 ? ' first; the others follow in order' : ''}.`)) return
    runAction('send', async () => {
      if (dirty && !(await save())) throw new Error('Fix the problems above, then send again.')
      const result = await sendEnvelope(envelopeId)
      await reload()
      if (result.failed?.length) throw new Error(`Sent, but the email to ${result.failed.join(', ')} could not be delivered. Use the resend button next to their name.`)
    })
  }

  const handleResend = (recipient) => runAction(recipient.id, async () => {
    await resendSigningLink(envelopeId, recipient.id)
    await reload()
  })

  const handleRetryFinalize = () => runAction('finalize', async () => {
    await retryFinalize(envelopeId)
    await reload()
  })

  const handleDownloadSigned = () => runAction('download', async () => {
    await downloadSignedPdf(envelope)
  })

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
        {loadError} <Link to="/" className="text-blue-600 underline">Back to envelopes</Link>
      </FullPageMessage>
    )
  }
  if (!draft) return <FullPageMessage title="Loading…" />

  const activeRecipient = draft.recipients.find(r => r.id === activeRecipientId && r.role === 'signer')
  const selectedField = editable ? draft.fields.find(f => f.id === selectedFieldId) : null
  const saveStatus = saveState.saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'
  const panelTab = selectedField ? tab : 'recipients'

  return (
    <div className="h-screen flex flex-col bg-gray-100">
      {/* Title bar */}
      <header className="h-16 px-4 bg-white border-b border-gray-200 flex items-center gap-3 flex-shrink-0">
        <Link to="/" className="p-2 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100" title="Back to envelopes">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1 min-w-0">
          {editable ? (
            <input
              value={draft.title}
              onChange={(e) => update({ title: e.target.value })}
              maxLength={200}
              className="w-full max-w-xl bg-transparent text-base text-gray-900 font-semibold outline-none rounded px-1 -mx-1 hover:bg-gray-50 focus:bg-gray-50"
              aria-label="Envelope title"
            />
          ) : (
            <h1 className="text-base text-gray-900 font-semibold truncate">{draft.title}</h1>
          )}
          <p className="text-xs text-gray-500 truncate">
            {editable
              ? <span className={dirty ? 'text-amber-700' : undefined} data-testid="save-status">{saveStatus}</span>
              : <span data-testid="envelope-status">{STATUS_LABELS[envelope.status]}</span>}
            {envelope.original_filename && <> · {envelope.original_filename}</>}
          </p>
        </div>
        {editable ? (
          <>
            <button
              onClick={save}
              disabled={!dirty || saveState.saving}
              className="btn-secondary px-4 py-2 rounded-md text-sm flex items-center gap-2"
            >
              <Save size={16} /> Save
            </button>
            <button
              onClick={handleSend}
              disabled={sendProblems.length > 0 || action.busy === 'send'}
              title={sendProblems.length ? 'Fix the items under "Ready to send?" first' : 'Email signing links'}
              className="btn-primary px-5 py-2 rounded-md text-sm flex items-center gap-2"
            >
              <Send size={16} /> {action.busy === 'send' ? 'Sending…' : 'Send'}
            </button>
          </>
        ) : (
          <>
            {mySigningTurn && (
              <Link to={`/envelopes/${envelopeId}/sign`} className="btn-primary px-5 py-2 rounded-md text-sm flex items-center gap-2">
                <PenLine size={16} /> Sign now
              </Link>
            )}
            {awaitingFinalize && (
              <button
                onClick={handleRetryFinalize}
                disabled={action.busy === 'finalize'}
                className="btn-secondary px-4 py-2 rounded-md text-sm flex items-center gap-2"
                title="Everyone has signed; build the final PDF and email copies"
              >
                <RotateCw size={16} className={action.busy === 'finalize' ? 'animate-spin' : ''} /> Finish document
              </button>
            )}
            {envelope.status === 'completed' && envelope.final_path && (
              <button onClick={handleDownloadSigned} className="btn-primary px-5 py-2 rounded-md text-sm flex items-center gap-2">
                <Download size={16} /> Download signed PDF
              </button>
            )}
          </>
        )}
      </header>

      {/* Toolbar */}
      <div className="h-11 px-4 bg-white border-b border-gray-200 flex items-center flex-shrink-0">
        <PageControls
          currentPage={currentPage}
          totalPages={pageSizes.length}
          zoom={zoom}
          onPageChange={setCurrentPage}
          onZoomChange={setZoom}
        />
      </div>

      {action.error && <ErrorBanner className="mx-4 mt-3">{action.error}</ErrorBanner>}
      {(saveState.problems.length > 0 || saveState.error) && (
        <div role="alert" className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          {saveState.error ? `Could not save: ${saveState.error}` : saveState.problems.join(' ')}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {editable && <FieldRail recipient={activeRecipient} documentReady={pageSizes.length > 0} onAdd={addField} />}

        {/* Document */}
        {pdfError ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-1">Could not open the document</h2>
              <p className="text-sm text-gray-500">{pdfError.message}</p>
            </div>
          </div>
        ) : (
          <DocumentViewer
            pdfDoc={pdfDoc}
            pageSizes={pageSizes}
            elements={draft.fields}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            zoom={zoom}
            renderField={renderField}
            readOnly={!editable}
            selectedId={selectedFieldId}
            onSelectedIdChange={selectField}
            onUpdateElement={updateField}
            onDeleteElement={deleteField}
          />
        )}

        {/* Right panel */}
        <aside className="w-80 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col min-h-0">
          {editable ? (
            <>
              <div role="tablist" className="flex gap-6 px-4 border-b border-gray-200 flex-shrink-0">
                {[['recipients', 'Recipients'], ['field', 'Field']].map(([id, label]) => (
                  <button
                    key={id}
                    role="tab"
                    aria-selected={panelTab === id}
                    onClick={() => setTab(id)}
                    className={`py-3 text-sm border-b-2 -mb-px ${panelTab === id ? 'border-blue-600 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {panelTab === 'field' && selectedField ? (
                  <FieldProperties
                    field={selectedField}
                    recipients={draft.recipients}
                    onChange={(patch) => updateField(selectedField.id, patch)}
                    onDelete={() => deleteField(selectedField.id)}
                    onClose={() => selectField(null)}
                  />
                ) : panelTab === 'field' ? (
                  <p className="text-sm text-gray-500">Select a field on the document to change who fills it in, its label, or whether it is required.</p>
                ) : (
                  <>
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
                    <p className="text-xs text-gray-500">
                      {activeRecipient
                        ? <>Adding to the current page for <span className="font-medium" style={{ color: activeRecipient.color }}>{activeRecipient.name || 'this signer'}</span>. Pick a field on the left.</>
                        : 'Add a signer, then pick fields on the left to place them.'}
                    </p>
                    <MessageField value={draft.message} onChange={(message) => update({ message })} />
                  </>
                )}
              </div>
              <div className="border-t border-gray-200 p-4 flex-shrink-0">
                <SendChecklist problems={sendProblems} />
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              <ActivityPanel
                recipients={draft.recipients}
                events={events}
                canResend={canVoid(envelope, user)}
                onResend={handleResend}
                resendingId={action.busy}
              />
              <section>
                <h2 className="section-heading mb-2">Message to recipients</h2>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{draft.message || 'No message.'}</p>
              </section>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

function MessageField({ value, onChange }) {
  return (
    <section>
      <h2 className="section-heading mb-2">Message to recipients</h2>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={5000}
        rows={4}
        placeholder="Optional note included in the email"
        className="w-full bg-white border border-gray-300 rounded-md p-2 text-sm text-gray-900 placeholder-gray-400 resize-y focus:outline-none focus:border-blue-500"
      />
    </section>
  )
}
