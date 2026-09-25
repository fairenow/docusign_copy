import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import {
  cancelTemplateEdit, downloadDocument, downloadSignedPdf, fetchEnvelope, finishTemplateEdit, listAuditEvents, resendSigningLink,
  originalPath, retryFinalize, saveAsTemplate, saveDraft, sendEnvelope, subscribeToEnvelopeChanges
} from '../lib/api'
import {
  addSelfAsSigner, draftFromEnvelope, moveRecipient, newField, newRecipient, recipientByEmail, renumberRecipients,
  validateForSave, validateForSend, canEdit, canVoid, envelopeGroup, isOwner, RECIPIENT_COLORS
} from '../lib/envelopeModel'
import { FIELD_LABELS, nextFieldY, placeField } from '../lib/fields'
import { assignSuggestions, companyFromEmail, snapToLine, suggestFields } from '../lib/fieldSuggestions'
import { usePageLayouts } from '../hooks/usePageLayouts'
import { fitWidthZoom } from '../lib/viewer'
import { usePdf } from '../hooks/usePdf'
import { useUndoable } from '../hooks/useUndoable'
import { useEditorShortcuts } from '../hooks/useEditorShortcuts'
import { useFeedback } from '../components/feedback/useFeedback'
import { preloadPdfViewer } from '../lib/documents'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import DocumentViewer from '../components/DocumentViewer'
import PlaceholderField from '../components/envelope/PlaceholderField'
import PrefillField from '../components/envelope/PrefillField'
import SuggestedField from '../components/envelope/SuggestedField'
import SuggestionsPanel from '../components/envelope/SuggestionsPanel'
import FullPageMessage from '../components/FullPageMessage'
import { DocumentScreenSkeleton } from '../components/Skeleton'
import RecipientsPanel from '../components/envelope/RecipientsPanel'
import FieldRail from '../components/envelope/FieldRail'
import FieldProperties from '../components/envelope/FieldProperties'
import SendChecklist from '../components/envelope/SendChecklist'
import GettingStarted from '../components/envelope/GettingStarted'
import EditorHeader from '../components/envelope/EditorHeader'
import EditorToolbar from '../components/envelope/EditorToolbar'
import ActivityPanel from '../components/envelope/ActivityPanel'
import ReminderSettings from '../components/envelope/ReminderSettings'
import SaveTemplateDialog from '../components/templates/SaveTemplateDialog'
import SignerAdjustmentSetting from '../components/envelope/SignerAdjustmentSetting'
import ErrorBanner from '../components/ErrorBanner'

// Drafts save themselves this long after the last change
const AUTOSAVE_DELAY_MS = 1500
// saving: a save is running; problems / error: shown in a banner; waiting: why autosave is holding off
const SAVE_IDLE = { saving: false, problems: [], error: null, waiting: null }

// Undo steps: a burst of changes to one field or one recipient box is one step
const fieldStep = (id) => `field:${id}`
const recipientStep = (id, patch) => `recipient:${id}:${Object.keys(patch).join()}`

/**
 * Prepare a draft envelope: recipients, signing order, message, and fields
 * assigned to each signer. Envelopes that are not editable open read-only.
 * A template opens here too, as a working copy whose recipients are its roles.
 */
export default function EnvelopeEditorPage() {
  const { envelopeId } = useParams()
  const { user, profile, isAdmin } = useAuth()

  const [envelope, setEnvelope] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [pdfBytes, setPdfBytes] = useState(null)
  // The draft being edited, with undo/redo (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y)
  const [draft, setDraft, { undo, redo, reset: resetDraft, canUndo, canRedo }] = useUndoable(null)
  const { confirm, notify } = useFeedback()
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft }, [draft])
  const [savedDraft, setSavedDraft] = useState(null)
  const [saveState, setSaveState] = useState(SAVE_IDLE)
  const [activeRecipientId, setActiveRecipientId] = useState(null)
  const [selectedFieldId, setSelectedFieldId] = useState(null)
  const [tab, setTab] = useState('recipients') // right panel: 'recipients' | 'field'
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  // Phones show the document or the side panel, one at a time
  const [mobileView, setMobileView] = useState('document') // 'document' | 'panel'
  const [events, setEvents] = useState([])
  const [action, setAction] = useState({ busy: null, error: null }) // busy: 'send' | 'finalize' | recipientId
  const [templateDialog, setTemplateDialog] = useState(null) // Save as template: null | 'open' | 'saved'
  const { doc: pdfDoc, pageSizes, error: pdfError } = usePdf(pdfBytes)
  const { getLayout, getAllLayouts } = usePageLayouts(pdfDoc)
  // Fields found on the document, waiting to be reviewed and added
  const [suggestions, setSuggestions] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestNotice, setSuggestNotice] = useState(null)
  // Field type picked up from the toolbar, waiting to be clicked onto the page
  const [placingType, setPlacingType] = useState(null)
  const [layouts, setLayouts] = useState([])
  // Set while a template copy is being saved back or discarded: nothing more is edited or saved
  const [leaving, setLeaving] = useState(false)
  const navigate = useNavigate()

  // (Re)load the envelope and, once sent, its activity. The document itself is loaded once.
  const reload = useCallback(async () => {
    // Drafts have no activity yet; the query simply returns their "created" event
    const [loaded, activity] = await Promise.all([fetchEnvelope(envelopeId), listAuditEvents(envelopeId)])
    const next = draftFromEnvelope(loaded)
    setEnvelope(loaded)
    resetDraft(next)
    setSavedDraft(next)
    setEvents(activity)
    return loaded
  }, [envelopeId, resetDraft])

  useEffect(() => {
    let cancelled = false
    preloadPdfViewer()
    // The document is always stored at <id>/original.pdf, so it downloads alongside the details
    const download = downloadDocument(originalPath(envelopeId))
    download.catch(() => {}) // reported below, once we know whether the envelope exists
    ;(async () => {
      try {
        const loaded = await reload()
        if (cancelled) return
        setActiveRecipientId(loaded.recipients.find(r => r.role === 'signer')?.id ?? null)
        if (!loaded.original_path) throw new Error('This envelope has no document.')
        const bytes = await download
        if (!cancelled) setPdfBytes(bytes)
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      }
    })()
    return () => { cancelled = true }
  }, [reload, envelopeId])

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
  // While a template copy is being saved back or discarded, nothing more is edited or saved
  const canEditNow = editable && !leaving
  // Admins can resend or finish anyone's envelope
  const canManage = Boolean(envelope) && canVoid(envelope, user, isAdmin)
  const editingTemplate = Boolean(envelope?.editing_template_id)

  // Phones and narrow windows: fit the page to the screen (beside the field toolbar)
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current || !pageSizes.length || window.innerWidth >= 768) return
    fittedRef.current = true
    setZoom(fitWidthZoom(pageSizes, window.innerWidth - (editable ? 76 : 0)))
  }, [pageSizes, editable])
  const ownsEnvelope = isOwner(envelope, user)
  const dirty = useMemo(
    () => canEditNow && draft !== savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [canEditNow, draft, savedDraft]
  )
  const sendProblems = useMemo(() => (draft ? validateForSend(draft) : []), [draft])
  const mySigningTurn = Boolean(envelope && user) && envelopeGroup(envelope, user) === 'action'
  // Everyone signed but the final PDF was not produced (e.g. a failed background step)
  const awaitingFinalize = Boolean(envelope) && canManage &&
    envelope.recipients.every(r => r.role !== 'signer' || r.status === 'signed')

  useUnsavedChangesWarning(dirty)

  // `coalesce` makes a burst of changes (typing in one box) a single undo step
  const update = useCallback((patch, coalesce) => setDraft(d => ({ ...d, ...patch }), { coalesce }), [setDraft])

  // Editing clears the previous save's error banner
  useEffect(() => {
    setSaveState(s => (s.problems.length || s.error || s.waiting ? { ...SAVE_IDLE, saving: s.saving } : s))
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
    }, { coalesce: patch.role ? undefined : recipientStep(id, patch) })
    if (patch.role === 'cc' && activeRecipientId === id) setActiveRecipientId(null)
  }

  // No "are you sure?": removing is one undo away, and the message offers it
  const removeRecipient = (id) => {
    const recipient = draft.recipients.find(r => r.id === id)
    const count = draft.fields.filter(f => f.recipientId === id).length
    const next = {
      ...draft,
      recipients: renumberRecipients(draft.recipients.filter(r => r.id !== id)),
      fields: draft.fields.filter(f => f.recipientId !== id)
    }
    setDraft(next)
    if (activeRecipientId === id) setActiveRecipientId(null)
    if (count) {
      notify(`Removed ${recipient?.name || 'the recipient'} and their ${count} field${count > 1 ? 's' : ''}.`, {
        // Only while nothing else has changed; otherwise Undo would take back something else
        action: { label: 'Undo', onClick: () => { if (draftRef.current === next) undo() } }
      })
    }
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

  // Dragging, resizing or typing into one field is one undo step
  const updateField = useCallback((id, patch) => {
    setDraft(d => ({ ...d, fields: d.fields.map(f => (f.id === id ? { ...f, ...patch } : f)) }), { coalesce: fieldStep(id) })
  }, [setDraft])

  // A field dropped near a line sits on it (hold Alt to place it freely)
  const snapField = useCallback(async (element, kind, event) => {
    if (kind !== 'move' || event?.altKey || element.suggestion || element.type === 'checkbox') return
    const layout = await getLayout(element.page)
    if (!layout) return
    setDraft(d => {
      const field = d.fields.find(f => f.id === element.id)
      const patch = field && snapToLine(field, layout)
      return patch ? { ...d, fields: d.fields.map(f => (f.id === field.id ? { ...f, ...patch } : f)) } : d
    }, { coalesce: fieldStep(element.id) }) // part of the move that ended here
  }, [getLayout, setDraft])

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
  }, [setDraft])

  // Saving -------------------------------------------------------------------
  // Returns true once the current draft is stored. Autosave is quiet: something that cannot be
  // saved yet (e.g. an email still being typed) is shown in the status line, not as an error.
  const save = useCallback(async ({ quiet = false } = {}) => {
    if (!canEditNow || saveState.saving) return false
    const problems = validateForSave(draft)
    if (problems.length) {
      setSaveState(quiet ? { ...SAVE_IDLE, waiting: problems[0] } : { ...SAVE_IDLE, problems })
      return false
    }
    setSaveState({ ...SAVE_IDLE, saving: true })
    try {
      await saveDraft(envelopeId, draft)
      setSavedDraft(draft)
      setSaveState(SAVE_IDLE)
      return true
    } catch (err) {
      setSaveState({ ...SAVE_IDLE, error: err.message })
      return false
    }
  }, [canEditNow, saveState.saving, draft, envelopeId])

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

  const handleSend = async () => {
    if (sendProblems.length) return
    const signers = draft.recipients.filter(r => r.role === 'signer')
    const first = draft.signingOrder === 'sequential' ? signers.slice(0, 1) : signers
    const who = first.map(r => r.name).join(', ')
    const sure = await confirm({
      title: `Send "${draft.title}" for signature?`,
      message: `${who} will be emailed a signing link${draft.signingOrder === 'sequential' && signers.length > 1 ? ' first; the others follow in order' : ''}.`,
      confirmLabel: 'Send'
    })
    if (!sure) return
    runAction('send', async () => {
      if (dirty && !(await save())) throw new Error('Fix the problems above, then send again.')
      const result = await sendEnvelope(envelopeId)
      await reload()
      if (result.failed?.length) throw new Error(`Sent, but the email to ${result.failed.join(', ')} could not be delivered. Use the resend button next to their name.`)
      notify(`Sent. ${who} ${first.length > 1 ? 'have' : 'has'} been emailed a signing link.`)
    })
  }

  const handleResend = (recipient) => runAction(recipient.id, async () => {
    await resendSigningLink(envelopeId, recipient.id)
    await reload()
    notify(`Emailed ${recipient.name} a new signing link.`)
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
    setTemplateDialog('saved')
  }

  // Template copies: save back to the template, or discard the copy. Editing stops meanwhile.
  const leaveTemplateWith = async (finish) => {
    setLeaving(true)
    try {
      await finish(envelope)
    } catch (err) {
      setLeaving(false)
      throw err
    }
    navigate('/templates')
  }

  const handleFinishTemplate = () => runAction('template', async () => {
    if (!draft.recipients.some(r => r.role === 'signer')) throw new Error('Add at least one signer before saving the template.')
    if (saveState.saving) throw new Error('Still saving your last change. Try again in a moment.')
    if (dirty && !(await save())) throw new Error('Fix the problems shown above the document first.')
    await leaveTemplateWith(finishTemplateEdit)
  })

  const handleCancelTemplate = async () => {
    const sure = await confirm({
      title: 'Discard your changes?',
      message: 'The template stays as it was before you opened it.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      danger: true
    })
    if (!sure) return
    runAction('template', () => leaveTemplateWith(cancelTemplateEdit))
  }

  useEditorShortcuts({
    enabled: canEditNow,
    onSave: save,
    onUndo: undo,
    onRedo: redo,
    // Esc puts back a field type that was picked up
    onEscape: placingType ? () => setPlacingType(null) : undefined
  })

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
  if (!draft) return <DocumentScreenSkeleton />

  const activeRecipient = draft.recipients.find(r => r.id === activeRecipientId && r.role === 'signer')
  const firstSigner = draft.recipients.find(r => r.role === 'signer')
  // A picked-up field shows where it would go, in its signer's color, until clicked into place
  const placingFor = activeRecipient ?? firstSigner
  const placing = placingType && editable ? {
    rectAt: (pageNumber, x, y) => placementRect(placingType, pageNumber, x, y),
    render: () => (
      <PlaceholderField
        field={{ type: placingType, required: placingType !== 'checkbox' }}
        {...(placingType === 'prefill'
          ? { color: '#475569', assignee: 'you, now' }
          : { color: placingFor?.color ?? newRecipient(draft.recipients).color, assignee: placingFor?.name || 'a signer' })}
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
      <EditorHeader
        envelope={envelope}
        draft={draft}
        editable={editable}
        editingTemplate={editingTemplate}
        ownsEnvelope={ownsEnvelope}
        dirty={dirty}
        saveStatus={saveStatus}
        saving={saveState.saving}
        busy={action.busy}
        sendProblems={sendProblems}
        mySigningTurn={mySigningTurn}
        awaitingFinalize={awaitingFinalize}
        onTitleChange={(title) => update({ title }, 'title')}
        onSave={() => save()}
        onSend={handleSend}
        onSaveAsTemplate={() => setTemplateDialog('open')}
        onFinishTemplate={handleFinishTemplate}
        onCancelTemplate={handleCancelTemplate}
        onRetryFinalize={handleRetryFinalize}
        onDownloadSigned={handleDownloadSigned}
      />
      <EditorToolbar
        pages={{ currentPage, totalPages: pageSizes.length, zoom, onPageChange: setCurrentPage, onZoomChange: setZoom }}
        editing={canEditNow}
        history={{ undo, redo, canUndo, canRedo }}
        suggest={{ run: suggest, ready: Boolean(pdfDoc), busy: suggesting }}
      />

      {placing && (
        <p role="status" className="px-4 py-2 bg-blue-50 border-b border-blue-200 text-sm text-blue-900">
          Click on the page to place the {FIELD_LABELS[placingType].toLowerCase()} field. Press Esc to cancel.
        </p>
      )}
      {action.error && <ErrorBanner className="mx-4 mt-3">{action.error}</ErrorBanner>}
      {templateDialog === 'saved' && (
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
            placeholderPages={envelope.page_count || 1}
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
                    {!editingTemplate && <GettingStarted draft={draft} />}
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
                    {editingTemplate && (
                      <p className="text-xs text-gray-600 bg-violet-50 border border-violet-200 rounded-md p-2">
                        Each recipient is a role, such as Client. Leave the email empty to enter the person each time the
                        template is used; add one for someone who signs every time.
                      </p>
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
                    <MessageField value={draft.message} onChange={(message) => update({ message }, 'message')} />
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
              {!editingTemplate && (
                <div className="border-t border-gray-200 p-4 flex-shrink-0">
                  <SendChecklist problems={sendProblems} />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              <ActivityPanel
                recipients={draft.recipients}
                events={events}
                canResend={canManage}
                ownerId={envelope.owner_id}
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
            {view === 'panel' && editable && !editingTemplate && sendProblems.length > 0 && (
              <span className="min-w-[1.25rem] px-1 rounded-full bg-amber-100 text-amber-800 text-xs">{sendProblems.length}</span>
            )}
          </button>
        ))}
      </nav>

      {templateDialog === 'open' && (
        <SaveTemplateDialog
          title={draft.title}
          recipients={draft.recipients}
          myEmail={user?.email}
          onSave={handleSaveTemplate}
          onClose={() => setTemplateDialog(null)}
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
