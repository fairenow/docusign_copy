import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import {
  cancelTemplateEdit, downloadDocument, downloadSignedPdf, fetchEnvelope, finishTemplateEdit, listAuditEvents, resendSigningLink,
  getSigningSession, listTeam, originalPath, retryFinalize, saveAsTemplate, saveDraft, sendEnvelope, shareEnvelope, submitSigning,
  subscribeToEnvelopeChanges, unshareEnvelope
} from '../lib/api'
import {
  addSelfAsSigner, draftFromEnvelope, moveRecipient, newField, newRecipient, recipientByEmail, renumberRecipients,
  validateForSave, validateForSend, canEdit, canVoid, envelopeGroup, isOwner, signsAlone, peopleWithAccess, commentThreads, RECIPIENT_COLORS
} from '../lib/envelopeModel'
import { FIELD_LABELS, DEFAULT_FONT_SIZE, canHover, clamp, nextFieldY, placementRect } from '../lib/fields'
import { assignSuggestions, companyFromEmail, suggestFields } from '../lib/fieldSuggestions'
import { usePageLayouts } from '../hooks/usePageLayouts'
import { fitWidthZoom } from '../lib/viewer'
import { usePdf } from '../hooks/usePdf'
import { useUndoable } from '../hooks/useUndoable'
import { useEditorShortcuts } from '../hooks/useEditorShortcuts'
import { useSelfSigning } from '../hooks/useSelfSigning'
import { useEnvelopeComments } from '../hooks/useEnvelopeComments'
import CommentsPanel from '../components/collab/CommentsPanel'
import SharePanel from '../components/collab/SharePanel'
import CommentPin from '../components/collab/CommentPin'
import { initialsOf } from '../../supabase/functions/_shared/signing.js'
import { useFeedback } from '../components/feedback/useFeedback'
import { preloadPdfViewer } from '../lib/documents'
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning'
import DocumentViewer from '../components/DocumentViewer'
import PlacementHint from '../components/PlacementHint'
import PlaceholderField from '../components/envelope/PlaceholderField'
import FillField from '../components/FillField'
import Modal from '../components/Modal'
import AdoptSignature from '../components/AdoptSignature'
import SelfSignMenu from '../components/envelope/SelfSignMenu'
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

// A comment pin is an 18 pt bubble whose bottom-left corner is the spot it was pinned to
const PIN_SIZE_PT = 18
function pinRect(pageSize, x, y) {
  const w = PIN_SIZE_PT / pageSize.width
  const h = PIN_SIZE_PT / pageSize.height
  return { x: clamp(x, 0, 1 - w), y: clamp(y - h, 0, 1 - h), w, h }
}

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
  const [searchParams] = useSearchParams()
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
  // Right panel: 'recipients' | 'field' | 'comments' (a sent envelope: 'activity' | 'comments').
  // A link to a comment (from its email) opens on it.
  const [tab, setTab] = useState(() => (searchParams.get('comment') ? 'comments' : 'recipients'))
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  // Phones show the document or the side panel, one at a time
  // A link to a comment opens the comments, on phones too
  const [mobileView, setMobileView] = useState(() => (searchParams.get('comment') ? 'panel' : 'document')) // 'document' | 'panel'
  const [events, setEvents] = useState([])
  const [action, setAction] = useState({ busy: null, error: null }) // busy: 'send' | 'finalize' | recipientId
  const [templateDialog, setTemplateDialog] = useState(null) // Save as template: null | 'open' | 'saved'
  const { doc: pdfDoc, pageSizes, error: pdfError } = usePdf(pdfBytes)
  const { getAllLayouts } = usePageLayouts(pdfDoc)
  // Fields found on the document, waiting to be reviewed and added
  const [suggestions, setSuggestions] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestNotice, setSuggestNotice] = useState(null)
  // Field type picked up from the toolbar, waiting to be clicked onto the page
  const [placingType, setPlacingType] = useState(null)
  // Signing it yourself: the Sign menu, and the signature/initials pad (place: then pick it up)
  const [signMenuOpen, setSignMenuOpen] = useState(false)
  const [creating, setCreating] = useState(null) // null | { kind: 'signature' | 'initials', place: boolean }
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
    // On phones the field tools sit below the page, so the page gets the full width
    setZoom(fitWidthZoom(pageSizes, window.innerWidth))
  }, [pageSizes])
  const ownsEnvelope = isOwner(envelope, user)
  const dirty = useMemo(
    () => canEditNow && draft !== savedDraft && JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [canEditNow, draft, savedDraft]
  )
  const sendProblems = useMemo(() => (draft ? validateForSend(draft) : []), [draft])
  const selfSign = Boolean(draft && !editingTemplate) && signsAlone(draft, user)
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

  // Someone who is emailed the signed PDF (a "copy" recipient)
  const addCopyRecipient = () => update({ recipients: [...draft.recipients, { ...newRecipient(draft.recipients), role: 'cc' }] })

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

  // Signing it yourself: your fields show your signature, today's date and what you type
  const myFields = selfSign && me ? draft.fields.filter(f => f.recipientId === me.id) : []
  const selfSigning = useSelfSigning({ envelopeId, enabled: selfSign, myFields })
  const isMine = (field) => selfSign && Boolean(me) && field.recipientId === me.id
  // A field of yours as it will be signed, for FillField
  const signedLook = (field) => {
    const value = selfSigning.valueOf(field)
    return {
      ...field,
      fontSize: field.fontSize ?? DEFAULT_FONT_SIZE,
      data: field.type === 'signature' || field.type === 'initials' ? value : undefined,
      text: field.type === 'date' || field.type === 'text' ? value : undefined,
      checked: field.type === 'checkbox' ? value === 'true' : undefined,
      locked: field.type === 'date'
    }
  }

  // From the Sign menu: use this signature (or initials, or today's date) and pick it up
  const pickFromSignMenu = (type, image) => {
    if (image) selfSigning.adopt(type, image)
    setSignMenuOpen(false)
    setPlacingType(type)
  }

  const adoptCreated = (image, remember) => {
    selfSigning.adopt(creating.kind, image, { remember })
    if (creating.place) setPlacingType(creating.kind)
    setCreating(null)
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
  // the page. Touch screens have no hover: it is added at once.
  const addField = (type) => {
    const pageSize = pageSizes[currentPage - 1]
    if (!pageSize) return
    // Signing it yourself: Signature opens the Sign menu; Initials need yours first
    if (selfSign && type === 'signature') {
      setPlacingType(null)
      setSignMenuOpen(true)
      return
    }
    if (selfSign && type === 'initials' && !selfSigning.images.initials) {
      setCreating({ kind: 'initials', place: true })
      return
    }
    if (canHover()) {
      setPlacingType(current => (current === type ? null : type))
      return
    }
    insertField(newField(type, { page: currentPage, pageSize }, signerForNewField(type), { y: nextFieldY(draft.fields, currentPage) }))
  }

  // Clicking a field opens its settings; clearing the selection goes back to recipients
  const selectField = useCallback((id) => {
    if (id?.startsWith('pin:')) return // comment pins open their comment instead (activateField)
    setSelectedFieldId(id)
    setTab(current => (id ? 'field' : current === 'field' ? 'recipients' : current))
  }, [])

  // Dragging, resizing or typing into one field is one undo step
  const updateField = useCallback((id, patch) => {
    setDraft(d => ({ ...d, fields: d.fields.map(f => (f.id === id ? { ...f, ...patch } : f)) }), { coalesce: fieldStep(id) })
  }, [setDraft])

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

  // Only you sign, and you signed on the page: finish here. No email to yourself; the signed
  // PDF goes to you and your copy recipients.
  const handleSignNow = async () => {
    if (selfSigning.problems.length) {
      const missing = myFields.find(f => !(f.id in selfSigning.submission) && f.type !== 'date') ?? myFields[0]
      if (missing && (missing.type === 'signature' || missing.type === 'initials') && !selfSigning.images[missing.type]) {
        setCreating({ kind: missing.type, place: false })
      } else if (missing) {
        setCurrentPage(missing.page)
        selectField(missing.id)
      }
      setAction({ busy: null, error: selfSigning.problems[0] })
      return
    }
    const copies = draft.recipients.filter(r => r.role === 'cc').map(r => r.name || r.email)
    const sure = await confirm({
      title: `Sign and finish "${draft.title}"?`,
      message: `You agree to use electronic records and signatures, and your signature is applied as shown. The signed PDF is emailed to you${copies.length ? ` and to ${copies.join(', ')}` : ''}.`,
      confirmLabel: 'Sign and finish'
    })
    if (!sure) return
    runAction('send', async () => {
      if (dirty && !(await save())) throw new Error('Fix the problems above, then try again.')
      await sendEnvelope(envelopeId, { signNow: true })
      const identity = { envelopeId }
      try {
        await getSigningSession(identity) // records that you viewed it, for the certificate
        await submitSigning(identity, selfSigning.submission, true)
      } catch (err) {
        await reload()
        throw new Error(`Sent, but your signature was not recorded: ${err.message} Press Sign now to finish.`)
      }
      selfSigning.clear()
      await reload()
      notify(`Signed. The signed PDF is on its way to you${copies.length ? ` and ${copies.join(', ')}` : ''}.`)
    })
  }

  const handleSend = async () => {
    if (sendProblems.length) return
    if (selfSign) return handleSignNow()
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
  const renderField = (field, ctx) => {
    const { scale } = ctx
    if (field.pin) return <CommentPin number={field.number} active={focusCommentId === field.commentId} />
    if (isMine(field)) {
      return <FillField {...ctx} element={signedLook(field)} onUpdate={(patch) => { if ('text' in patch && field.type === 'text') selfSigning.setValue(field.id, patch.text) }} />
    }
    // Signed and sent: show what was filled in
    if (!editable && field.value) {
      return <FillField {...ctx} element={{ ...field, data: field.value, text: field.value, checked: field.value === 'true', locked: true }} onUpdate={() => {}} />
    }
    if (field.suggestion) {
      const color = field.type === 'prefill' ? '#475569' : recipientsById.get(field.recipientId)?.color ?? '#7c3aed'
      return <SuggestedField suggestion={field} color={color} />
    }
    if (field.type === 'prefill') {
      return <PrefillField field={field} scale={scale} readOnly={!editable} onChange={(text) => updateField(field.id, { text })} />
    }
    const r = recipientsById.get(field.recipientId)
    return <PlaceholderField field={field} color={r?.color ?? RECIPIENT_COLORS[0]} assignee={r?.name || r?.email || 'Unassigned'} />
  }

  // Collaboration -------------------------------------------------------------
  const [team, setTeam] = useState([])
  useEffect(() => { listTeam().then(setTeam).catch(err => console.error('Could not load the team:', err)) }, [])
  const { comments, post: postComment, resolve: resolveComment, remove: removeComment } = useEnvelopeComments(envelopeId, Boolean(envelope))
  const [focusCommentId, setFocusCommentId] = useState(() => searchParams.get('comment'))
  // Picking a spot on the page for a new comment, and the spot picked
  const [pinning, setPinning] = useState(false)
  const [pendingPin, setPendingPin] = useState(null)
  const canShare = Boolean(envelope) && !editingTemplate && (ownsEnvelope || isAdmin)
  const access = useMemo(() => (envelope ? peopleWithAccess(envelope, team) : new Set()), [envelope, team])
  // Open, pinned threads are numbered on the page in the order they were written
  const pins = useMemo(() => {
    const numbers = new Map()
    commentThreads(comments).filter(t => t.page && !t.resolved_at).forEach((t, i) => numbers.set(t.id, i + 1))
    return numbers
  }, [comments])

  const handleShare = async (userId) => {
    await shareEnvelope(envelopeId, userId)
    setEnvelope(e => ({ ...e, envelope_shares: [...(e.envelope_shares ?? []), { user_id: userId, shared_by: user.id, created_at: new Date().toISOString() }] }))
    notify(`Shared with ${team.find(p => p.id === userId)?.full_name || 'your teammate'}. They were emailed a link.`)
  }
  const handleUnshare = async (userId) => {
    await unshareEnvelope(envelopeId, userId)
    if (userId === user.id) return navigate('/')
    setEnvelope(e => ({ ...e, envelope_shares: (e.envelope_shares ?? []).filter(s => s.user_id !== userId) }))
  }
  // Mentioning a teammate who cannot see the envelope shares it with them first (owner/admin only)
  const handlePostComment = async (comment) => {
    for (const id of comment.mentions) if (!access.has(id) && canShare) await handleShare(id)
    const saved = await postComment(comment)
    if (!comment.parentId) setFocusCommentId(saved.id)
  }
  const showComment = (thread) => {
    setFocusCommentId(thread.id)
    if (thread.page) setCurrentPage(thread.page)
  }

  useEffect(() => {
    if (!pinning) return
    const onKeyDown = (e) => { if (e.key === 'Escape') setPinning(false) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [pinning])

  // Your own fields: a click ticks a checkbox, or asks for the signature they need. A pin opens its comment.
  const activateField = (field) => {
    if (field.pin) {
      setTab('comments')
      setFocusCommentId(field.commentId)
      setMobileView('panel')
      return
    }
    if (!isMine(field)) return
    if (field.type === 'checkbox') selfSigning.setValue(field.id, selfSigning.valueOf(field) === 'true' ? 'false' : 'true')
    if ((field.type === 'signature' || field.type === 'initials') && !selfSigning.images[field.type]) setCreating({ kind: field.type, place: false })
  }

  // Suggestions show on the page as outlines until they are added; open comments as pins
  const viewerElements = useMemo(() => {
    const fields = draft?.fields ?? []
    const suggested = suggestions ? suggestions.map(s => ({ ...s, suggestion: true, fixed: true })) : []
    const pinned = comments.filter(c => pins.has(c.id) && pageSizes[c.page - 1]).map(c => ({
      id: `pin:${c.id}`, commentId: c.id, number: pins.get(c.id), pin: true, fixed: true, type: 'comment', page: c.page,
      ...pinRect(pageSizes[c.page - 1], c.x, c.y)
    }))
    return [...fields, ...suggested, ...pinned]
  }, [draft?.fields, suggestions, comments, pins, pageSizes])

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
  const placing = pinning ? {
    rectAt: (pageNumber, x, y) => pinRect(pageSizes[pageNumber - 1], x, y),
    render: () => <CommentPin number="+" preview />,
    onPlace: (pageNumber, rect) => {
      setPendingPin({ page: pageNumber, x: rect.x, y: rect.y + rect.h })
      setPinning(false)
      setMobileView('panel') // phones: back to the comment being written
    }
  } : placingType && editable ? {
    rectAt: (pageNumber, x, y) => placementRect(placingType, pageSizes[pageNumber - 1], x, y),
    render: (rect, ctx) => selfSign && placingType !== 'prefill' ? (
      <FillField {...ctx} element={signedLook({ id: 'placing', type: placingType, ...rect })} onUpdate={() => {}} />
    ) : (
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
  const panelTab = editable
    ? (tab === 'comments' ? 'comments' : selectedField ? tab : 'recipients')
    : (tab === 'comments' ? 'comments' : 'activity')
  const openComments = comments.filter(c => !c.parent_id && !c.resolved_at).length
  const commentsPanel = (
    <>
      <SharePanel envelope={envelope} team={team} me={user} canShare={canShare} onShare={handleShare} onUnshare={handleUnshare} />
      <CommentsPanel
        comments={comments}
        team={team}
        me={user}
        canShare={canShare}
        hasAccess={(id) => access.has(id)}
        onPost={handlePostComment}
        onResolve={resolveComment}
        onDelete={removeComment}
        pins={pins}
        focusId={focusCommentId}
        onFocus={showComment}
        pinning={pinning}
        pendingPin={pendingPin}
        onPinStart={() => { setPinning(true); setMobileView('document') }}
        onPinClear={() => setPendingPin(null)}
        notify={notify}
      />
    </>
  )
  const tabButton = ([id, label]) => (
    <button
      key={id}
      role="tab"
      aria-selected={panelTab === id}
      onClick={() => setTab(id)}
      className={`py-3 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${panelTab === id ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-900'}`}
    >
      {label}
      {id === 'comments' && openComments > 0 && <span className="min-w-[1.125rem] px-1 rounded-full bg-blue-600 text-white text-[10px] leading-[1.125rem] text-center">{openComments}</span>}
    </button>
  )

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
        selfSign={selfSign}
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

      {pinning && (
        <p role="status" className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 pointer-events-none max-w-[90vw] rounded-full bg-gray-900/90 px-4 py-2 text-sm text-white shadow-lg">
          Click the spot on the page this comment is about. Press Esc to cancel.
        </p>
      )}
      {placing && !pinning && <PlacementHint what={selfSign && placingType === 'date' ? "today's date" : `${FIELD_LABELS[placingType].toLowerCase()}${selfSign ? '' : ' field'}`} />}
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
        <div className={`flex-1 min-w-0 min-h-0 flex-col md:flex-row ${mobileView === 'panel' ? 'hidden md:flex' : 'flex'}`}>
        {editable && (
          <div className="relative flex order-last md:order-none flex-shrink-0">
            <FieldRail recipient={activeRecipient} documentReady={pageSizes.length > 0} onAdd={addField} activeType={signMenuOpen ? 'signature' : placingType} />
            {signMenuOpen && (
              <SelfSignMenu
                saved={selfSigning.saved}
                current={selfSigning.images}
                onPick={pickFromSignMenu}
                onCreate={(kind) => { setSignMenuOpen(false); setCreating({ kind, place: true }) }}
                onClose={() => setSignMenuOpen(false)}
              />
            )}
          </div>
        )}

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
            onActivateElement={activateField}
            placing={placing}
          />
        )}

        </div>

        {/* Right panel (on phones: its own view) */}
        <aside className={`${mobileView === 'document' ? 'hidden md:flex' : 'flex'} w-full md:w-80 flex-shrink-0 bg-white border-l border-gray-200 flex-col min-h-0`}>
          {editable ? (
            <>
              <div role="tablist" className="flex gap-6 px-4 border-b border-gray-200 flex-shrink-0">
                {[['recipients', 'Recipients'], ['field', 'Field'], ...(editingTemplate ? [] : [['comments', 'Comments']])].map(tabButton)}
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-6">
                {panelTab === 'comments' ? commentsPanel : panelTab === 'field' && selectedField ? (
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
                    {!editingTemplate && <GettingStarted draft={draft} selfSign={selfSign} />}
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
                    {selfSign && (
                      <section className="rounded-lg border border-gray-200 p-3" data-testid="send-copy">
                        <h2 className="text-sm font-semibold text-gray-900">Send the signed copy to</h2>
                        <p className="text-xs text-gray-600 mt-0.5 mb-2">
                          You sign now; the moment you finish, the signed PDF is emailed to you
                          {draft.recipients.some(r => r.role === 'cc') ? ' and to everyone marked "Gets a copy" above' : ''}. No need to download and attach it.
                        </p>
                        <button onClick={addCopyRecipient} className="btn-secondary w-full px-3 py-2 rounded-md text-sm">
                          Add someone to email it to
                        </button>
                      </section>
                    )}
                    <p className="text-xs text-gray-500">
                      {activeRecipient
                        ? <>Adding to the current page for <span className="font-medium" style={{ color: activeRecipient.color }}>{activeRecipient.name || 'this signer'}</span>. Pick a field on the left.</>
                        : 'Pick a field on the left and click it onto the page. Say who signs here, now or after placing fields.'}
                      {' '}Drag a field to move it (Shift keeps it straight); arrow keys nudge it by one point.
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
            <>
            <div role="tablist" className="flex gap-6 px-4 border-b border-gray-200 flex-shrink-0">
              {[['activity', 'Activity'], ['comments', 'Comments']].map(tabButton)}
            </div>
            {panelTab === 'comments' ? (
              <div className="flex-1 overflow-y-auto p-4 space-y-6">{commentsPanel}</div>
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
            </>
          )}
        </aside>
      </div>

      {/* Phones: switch between the document and the panel */}
      <nav className="md:hidden px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] border-t border-gray-200/80 bg-white flex-shrink-0" aria-label="View">
        <div className="segmented w-full">
        {[
          ['document', 'Document'],
          ['panel', panelTab === 'comments' ? 'Comments' : editable ? (selectedField ? 'Field' : 'Recipients') : 'Activity']
        ].map(([view, label]) => (
          <button
            key={view}
            onClick={() => setMobileView(view)}
            aria-pressed={mobileView === view}
            className="segmented-item flex-1 py-2 flex items-center justify-center gap-2"
          >
            {label}
            {view === 'panel' && panelTab !== 'comments' && editable && !editingTemplate && sendProblems.length > 0 && (
              <span className="min-w-[1.25rem] px-1 rounded-full bg-amber-100 text-amber-800 text-xs">{sendProblems.length}</span>
            )}
          </button>
        ))}
        </div>
      </nav>

      {creating && (
        <Modal title={creating.kind === 'signature' ? 'Your signature' : 'Your initials'} onClose={() => setCreating(null)}>
          <AdoptSignature
            kind={creating.kind}
            saved={selfSigning.saved}
            canSave
            defaultTypedName={creating.kind === 'signature' ? me?.name : initialsOf(me?.name)}
            onAdopt={adoptCreated}
          />
        </Modal>
      )}

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
