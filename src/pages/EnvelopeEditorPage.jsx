import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download, LayoutTemplate, PenLine, RotateCw, Save, Send, Sparkles } from 'lucide-react'
import { useAuth } from '../auth/useAuth'
import {
  downloadDocument, downloadSignedPdf, fetchEnvelope, listAuditEvents, resendSigningLink, retryFinalize, saveAsTemplate, saveDraft,
  sendEnvelope, subscribeToEnvelopeChanges
} from '../lib/api'
import {
  addSelfAsSigner, draftFromEnvelope, moveRecipient, newField, newRecipient, recipientByEmail, renumberRecipients,
  validateForSave, validateForSend, canEdit, canVoid, envelopeGroup, RECIPIENT_COLORS, STATUS_LABELS
} from '../lib/envelopeModel'
import { FIELD_LABELS, nextFieldY, placeField } from '../lib/fields'
import { assignSuggestions, companyFromEmail, snapToLine, suggestFields } from '../lib/fieldSuggestions'
import { usePageLayouts } from '../hooks/usePageLayouts'
import { fitWidthZoom } from '../lib/viewer'
import { usePdf } from '../hooks/usePdf'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import DocumentViewer from '../components/DocumentViewer'
import PageControls from '../components/PageControls'
import PlaceholderField from '../components/envelope/PlaceholderField'
import PrefillField from '../components/envelope/PrefillField'
import SuggestedField from '../components/envelope/SuggestedField'
import SuggestionsPanel from '../components/envelope/SuggestionsPanel'
import FullPageMessage from '../components/FullPageMessage'
import RecipientsPanel from '../components/envelope/RecipientsPanel'
import FieldRail from '../components/envelope/FieldRail'
import FieldProperties from '../components/envelope/FieldProperties'
import SendChecklist from '../components/envelope/SendChecklist'
import ActivityPanel from '../components/envelope/ActivityPanel'
import ReminderSettings from '../components/envelope/ReminderSettings'
import SaveTemplateDialog from '../components/templates/SaveTemplateDialog'
import SignerAdjustmentSetting from '../components/envelope/SignerAdjustmentSetting'
import ErrorBanner from '../components/ErrorBanner'

// Drafts save themselves this long after the last change
const AUTOSAVE_DELAY_MS = 1500

/**
 * Prepare a draft envelope: recipients, signing order, message, and fields
 * assigned to each signer. Envelopes that are not editable open read-only.
 */
export default function EnvelopeEditorPage() {
  const { envelopeId } = useParams()
  const { user, profile } = useAuth()

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
  // Phones show the document or the side panel, one at a time
  const [mobileView, setMobileView] = useState('document') // 'document' | 'panel'
  const [events, setEvents] = useState([])
  const [action, setAction] = useState({ busy: null, error: null }) // busy: 'send' | 'finalize' | recipientId
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [templateSaved, setTemplateSaved] = useState(false)
  const { doc: pdfDoc, pageSizes, error: pdfError } = usePdf(pdfBytes)
  const { getLayout, getAllLayouts } = usePageLayouts(pdfDoc)
  // Fields found on the document, waiting to be reviewed and added
  const [suggestions, setSuggestions] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestNotice, setSuggestNotice] = useState(null)
  // Field type picked up from the toolbar, waiting to be clicked onto the page
  const [placingType, setPlacingType] = useState(null)
  const [layouts, setLayouts] = useState([])

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

  // Phones and narrow windows: fit the page to the screen (beside the field toolbar)
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current || !pageSizes.length || window.innerWidth >= 768) return
    fittedRef.current = true
    setZoom(fitWidthZoom(pageSizes, window.innerWidth - (editable ? 76 : 0)))
  }, [pageSizes, editable])
  const isOwner = Boolean(envelope && user) && envelope.owner_id === user.id
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
    setSaveState(s => (s.problems.length || s.error || s.waiting ? { ...s, problems: [], error: null, waiting: null } : s))
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

  // "I need to sign this document": you are a signer, first in order by default
  const me = draft ? recipientByEmail(draft.recipients, user?.email) : undefined
  const signingMyself = {
    checked: me?.role === 'signer',
    onChange: (checked) => {
      if (checked) {
        const recipients = addSelfAsSigner(draft.recipients, { name: profile?.full_name || user.email.split('@')[0], email: user.email })
        update({ recipients })
        setActiveRecipientId(recipientByEmail(recipients, user.email).id)
      } else if (me) {
        removeRecipient(me.id)
      }
    }
  }

  // Fields -------------------------------------------------------------------
  const insertField = (field) => {
    update({ fields: [...draft.fields, field] })
    // Highlight the new field but stay on the current tab, so several can be placed in a row.
    // "Fill in now" opens its settings, since it needs text straight away.
    if (field.type === 'prefill') selectField(field.id)
    else setSelectedFieldId(field.id)
  }

  // Who a new field is for: the selected signer, else the first signer, else a new signer to
  // be named later (fields can be placed before the people are known)
  const signerForNewField = (type) => {
    if (type === 'prefill') return null
    const signer = draft.recipients.find(r => r.id === activeRecipientId && r.role === 'signer') ??
      draft.recipients.find(r => r.role === 'signer')
    if (signer) {
      setActiveRecipientId(signer.id)
      return signer.id
    }
    const recipient = newRecipient(draft.recipients)
    update({ recipients: [...draft.recipients, recipient] })
    setActiveRecipientId(recipient.id)
    return recipient.id
  }

  // With a mouse, a field type is picked up and follows the pointer until it is clicked onto
  // the page (sitting on the line below it). Touch screens have no hover: it is added at once.
  const addField = (type) => {
    const pageSize = pageSizes[currentPage - 1]
    if (!pageSize) return
    if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
      setPlacingType(current => (current === type ? null : type))
      getAllLayouts().then(setLayouts)
      return
    }
    insertField(newField(type, { page: currentPage, pageSize }, signerForNewField(type), { y: nextFieldY(draft.fields, currentPage) }))
  }

  // The rectangle a field being placed would take with the pointer at (x, y): its left edge at
  // the pointer, centred vertically, then onto a line close below
  const placementRect = useCallback((type, pageNumber, x, y) => {
    const pageSize = pageSizes[pageNumber - 1]
    const { w, h } = placeField(type, { page: pageNumber, pageSize })
    const rect = { x: Math.min(Math.max(x, 0), 1 - w), y: Math.min(Math.max(y - h / 2, 0), 1 - h), w, h }
    const layout = layouts[pageNumber - 1]
    const snapped = layout && type !== 'checkbox' ? snapToLine(rect, layout) : null
    return snapped ? { ...rect, ...snapped } : rect
  }, [pageSizes, layouts])

  // Clicking a field opens its settings; clearing the selection goes back to recipients
  const selectField = useCallback((id) => {
    setSelectedFieldId(id)
    setTab(id ? 'field' : 'recipients')
  }, [])

  const updateField = useCallback((id, patch) => {
    setDraft(d => ({ ...d, fields: d.fields.map(f => (f.id === id ? { ...f, ...patch } : f)) }))
  }, [])

  // A field dropped near a line sits on it (hold Alt to place it freely)
  const snapField = useCallback(async (element, kind, event) => {
    if (kind !== 'move' || event?.altKey || element.suggestion || element.type === 'checkbox') return
    const layout = await getLayout(element.page)
    if (!layout) return
    setDraft(d => {
      const field = d.fields.find(f => f.id === element.id)
      const patch = field && snapToLine(field, layout)
      return patch ? { ...d, fields: d.fields.map(f => (f.id === field.id ? { ...f, ...patch } : f)) } : d
    })
  }, [getLayout])

  // Esc puts back a field type that was picked up
  useEffect(() => {
    if (!placingType) return
    const onKeyDown = (e) => { if (e.key === 'Escape') setPlacingType(null) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [placingType])

  // Suggest fields ------------------------------------------------------------
  const suggest = async () => {
    setSuggesting(true)
    setSuggestNotice(null)
    try {
      const layouts = await getAllLayouts()
      const found = suggestFields(layouts, draft.fields, { company: companyFromEmail(user?.email) })
      const me = recipientByEmail(draft.recipients, user?.email)
      setSuggestions(found.length ? assignSuggestions(found, draft.recipients, me) : null)
      if (!found.length) setSuggestNotice('No blank lines or placeholders found. Place fields from the left.')
      setTab('recipients')
      setMobileView('panel')
    } finally {
      setSuggesting(false)
    }
  }

  const changeSuggestion = (id, patch) => setSuggestions(list => list.map(s => (s.id === id ? { ...s, ...patch } : s)))
  const removeSuggestion = (id) => setSuggestions(list => {
    const rest = list.filter(s => s.id !== id)
    return rest.length ? rest : null
  })

  // Add the suggestions that say who fills them in; unclear ones stay for review
  const acceptSuggestions = () => {
    const signerIds = new Set(draft.recipients.filter(r => r.role === 'signer').map(r => r.id))
    const ready = suggestions.filter(s => s.type === 'prefill' || signerIds.has(s.recipientId))
    const added = ready.map(s => ({
      ...newField(s.type, { page: s.page, pageSize: pageSizes[s.page - 1] }, s.recipientId, { x: s.x, y: s.y, w: s.w, h: s.h, label: s.label }),
      ...(s.fontSize && { fontSize: s.fontSize })
    }))
    update({ fields: [...draft.fields, ...added] })
    const rest = suggestions.filter(s => !ready.includes(s))
    setSuggestions(rest.length ? rest : null)
  }

  const deleteField = useCallback((id) => {
    setDraft(d => ({ ...d, fields: d.fields.filter(f => f.id !== id) }))
    setSelectedFieldId(current => (current === id ? null : current))
  }, [])

  // Saving -------------------------------------------------------------------
  // Returns true once the current draft is stored
  // Returns true once the current draft is stored. Autosave is quiet: something that cannot be
  // saved yet (e.g. an email still being typed) is shown in the status line, not as an error.
  const save = useCallback(async ({ quiet = false } = {}) => {
    if (!editable || saveState.saving) return false
    const problems = validateForSave(draft)
    if (problems.length) {
      setSaveState(quiet ? { saving: false, problems: [], error: null, waiting: problems[0] } : { saving: false, problems, error: null })
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

  // Autosave: shortly after the last change (and again if more changes came in while saving)
  const saveRef = useRef(save)
  useEffect(() => { saveRef.current = save }, [save])
  useEffect(() => {
    if (!dirty) return
    const timer = setTimeout(() => saveRef.current({ quiet: true }), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [dirty, draft, savedDraft])

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

  // Templates are made from what is stored, so unsaved edits are saved first
  const handleSaveTemplate = async (name, roles) => {
    if (dirty && !(await save())) throw new Error('Fix the problems shown above the document first.')
    await saveAsTemplate(envelope, name, roles)
    setSavingTemplate(false)
    setTemplateSaved(true)
  }

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
  const renderField = useCallback((field, { scale }) => {
    if (field.suggestion) {
      const color = field.type === 'prefill' ? '#475569' : recipientsById.get(field.recipientId)?.color ?? '#7c3aed'
      return <SuggestedField suggestion={field} color={color} />
    }
    if (field.type === 'prefill') {
      return <PrefillField field={field} scale={scale} readOnly={!editable} onChange={(text) => updateField(field.id, { text })} />
    }
    const r = recipientsById.get(field.recipientId)
    return <PlaceholderField field={field} color={r?.color ?? RECIPIENT_COLORS[0]} assignee={r?.name || r?.email || 'Unassigned'} />
  }, [recipientsById, editable, updateField])

  // Suggestions show on the page as outlines until they are added
  const viewerElements = useMemo(() => {
    const fields = draft?.fields ?? []
    return suggestions ? [...fields, ...suggestions.map(s => ({ ...s, suggestion: true, fixed: true }))] : fields
  }, [draft?.fields, suggestions])

  if (loadError) {
    return (
      <FullPageMessage title="Could not open envelope">
        {loadError} <Link to="/" className="text-blue-600 underline">Back to envelopes</Link>
      </FullPageMessage>
    )
  }
  if (!draft) return <FullPageMessage title="Loading…" />

  const activeRecipient = draft.recipients.find(r => r.id === activeRecipientId && r.role === 'signer')
  const firstSigner = draft.recipients.find(r => r.role === 'signer')
  // A picked-up field shows where it would go, in its signer's color, until clicked into place
  const placing = placingType && editable ? {
    rectAt: (pageNumber, x, y) => placementRect(placingType, pageNumber, x, y),
    render: () => (
      <PlaceholderField
        field={{ type: placingType, required: placingType !== 'checkbox' }}
        color={placingType === 'prefill' ? '#475569' : (activeRecipient ?? firstSigner)?.color ?? newRecipient(draft.recipients).color}
        assignee={placingType === 'prefill' ? 'you, now' : (activeRecipient ?? firstSigner)?.name || 'a signer'}
      />
    ),
    onPlace: (pageNumber, rect) => {
      insertField(newField(placingType, { page: pageNumber, pageSize: pageSizes[pageNumber - 1] }, signerForNewField(placingType), rect))
      setPlacingType(null)
    }
  } : null
  const selectedField = editable ? draft.fields.find(f => f.id === selectedFieldId) : null
  const saveStatus = saveState.saving ? 'Saving…'
    : !dirty ? 'All changes saved'
      : saveState.waiting ? `Not saved yet: ${saveState.waiting}`
        : saveState.error ? 'Could not save' : 'Unsaved changes'
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
        {isOwner && (
          <button
            onClick={() => { setTemplateSaved(false); setSavingTemplate(true) }}
            disabled={!draft.recipients.length}
            title={draft.recipients.length ? 'Reuse this document and its fields' : 'Add recipients and fields first'}
            aria-label="Save as template"
            className="btn-secondary px-3 py-2 rounded-md text-sm flex items-center gap-2"
          >
            <LayoutTemplate size={16} /> <span className="hidden lg:inline">Save as template</span>
          </button>
        )}
        {editable ? (
          <>
            <button
              onClick={() => save()}
              aria-label="Save"
              disabled={!dirty || saveState.saving}
              className="btn-secondary px-4 py-2 rounded-md text-sm flex items-center gap-2"
            >
              <Save size={16} /> <span className="hidden sm:inline">Save</span>
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
      <div className="h-11 px-2 sm:px-4 bg-white border-b border-gray-200 flex items-center gap-3 flex-shrink-0 overflow-x-auto">
        <PageControls
          currentPage={currentPage}
          totalPages={pageSizes.length}
          zoom={zoom}
          onPageChange={setCurrentPage}
          onZoomChange={setZoom}
        />
        {editable && (
          <button
            onClick={suggest}
            disabled={!pdfDoc || suggesting}
            title="Find the blank lines and placeholders and suggest fields for them"
            className="ml-auto btn-secondary px-3 py-1.5 rounded-md text-sm flex items-center gap-2 whitespace-nowrap flex-shrink-0"
          >
            <Sparkles size={15} className="text-violet-600" />
            <span className="hidden sm:inline">{suggesting ? 'Reading the document…' : 'Suggest fields'}</span>
            <span className="sm:hidden">{suggesting ? 'Reading…' : 'Suggest'}</span>
          </button>
        )}
      </div>

      {placing && (
        <p role="status" className="px-4 py-2 bg-blue-50 border-b border-blue-200 text-sm text-blue-900">
          Click on the page to place the {FIELD_LABELS[placingType].toLowerCase()} field. Press Esc to cancel.
        </p>
      )}
      {action.error && <ErrorBanner className="mx-4 mt-3">{action.error}</ErrorBanner>}
      {templateSaved && (
        <p role="status" className="mx-4 mt-3 p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-800 text-sm">
          Saved as a template. Use it from <Link to="/templates" className="underline">Templates</Link>.
        </p>
      )}
      {(saveState.problems.length > 0 || saveState.error) && (
        <div role="alert" className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          {saveState.error ? `Could not save: ${saveState.error}` : saveState.problems.join(' ')}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        <div className={`flex-1 min-w-0 min-h-0 ${mobileView === 'panel' ? 'hidden md:flex' : 'flex'}`}>
        {editable && <FieldRail recipient={activeRecipient} documentReady={pageSizes.length > 0} onAdd={addField} activeType={placingType} />}

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
            elements={viewerElements}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            zoom={zoom}
            renderField={renderField}
            readOnly={!editable}
            selectedId={selectedFieldId}
            onSelectedIdChange={selectField}
            onUpdateElement={updateField}
            onDeleteElement={deleteField}
            onElementGestureEnd={snapField}
            placing={placing}
          />
        )}

        </div>

        {/* Right panel (on phones: its own view) */}
        <aside className={`${mobileView === 'document' ? 'hidden md:flex' : 'flex'} w-full md:w-80 flex-shrink-0 bg-white border-l border-gray-200 flex-col min-h-0`}>
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
                    {suggestNotice && <p role="status" className="text-sm text-gray-600">{suggestNotice}</p>}
                    {suggestions && (
                      <SuggestionsPanel
                        suggestions={suggestions}
                        recipients={draft.recipients}
                        onChange={changeSuggestion}
                        onRemove={removeSuggestion}
                        onAccept={acceptSuggestions}
                        onDismiss={() => setSuggestions(null)}
                      />
                    )}
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
                      signingMyself={signingMyself}
                    />
                    <p className="text-xs text-gray-500">
                      {activeRecipient
                        ? <>Adding to the current page for <span className="font-medium" style={{ color: activeRecipient.color }}>{activeRecipient.name || 'this signer'}</span>. Pick a field on the left.</>
                        : 'Pick a field on the left and click it onto the page. Say who signs here, now or after placing fields.'}
                      {' '}Fields snap onto the line you drop them on; hold Alt to place one freely.
                    </p>
                    <MessageField value={draft.message} onChange={(message) => update({ message })} />
                    <ReminderSettings
                      remindEveryDays={draft.remindEveryDays}
                      expireAfterDays={draft.expireAfterDays}
                      onChange={update}
                    />
                    <SignerAdjustmentSetting
                      checked={draft.allowSignerAdjustments}
                      onChange={(allowSignerAdjustments) => update({ allowSignerAdjustments })}
                    />
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
              <ReminderSettings readOnly remindEveryDays={draft.remindEveryDays} expiresAt={envelope.expires_at} />
              <SignerAdjustmentSetting readOnly checked={draft.allowSignerAdjustments} />
            </div>
          )}
        </aside>
      </div>

      {/* Phones: switch between the document and the panel */}
      <nav className="md:hidden flex border-t border-gray-200 bg-white flex-shrink-0 pb-[env(safe-area-inset-bottom)]" aria-label="View">
        {[
          ['document', 'Document'],
          ['panel', editable ? (selectedField ? 'Field settings' : 'Recipients & settings') : 'Status & activity']
        ].map(([view, label]) => (
          <button
            key={view}
            onClick={() => setMobileView(view)}
            aria-pressed={mobileView === view}
            className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 ${mobileView === view ? 'text-blue-600 border-t-2 border-blue-600 -mt-px' : 'text-gray-500'}`}
          >
            {label}
            {view === 'panel' && editable && sendProblems.length > 0 && (
              <span className="min-w-[1.25rem] px-1 rounded-full bg-amber-100 text-amber-800 text-xs">{sendProblems.length}</span>
            )}
          </button>
        ))}
      </nav>

      {savingTemplate && (
        <SaveTemplateDialog
          title={draft.title}
          recipients={draft.recipients}
          myEmail={user?.email}
          onSave={handleSaveTemplate}
          onClose={() => setSavingTemplate(false)}
        />
      )}
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
