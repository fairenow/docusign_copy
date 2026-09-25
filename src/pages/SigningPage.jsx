import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ChevronRight, CheckCircle2, XCircle, Clock, PenLine } from 'lucide-react'
import { declineSigning, getSigningSession, submitSigning } from '../lib/api'
import { usePdf } from '../hooks/usePdf'
import { fitWidthZoom } from '../lib/viewer'
import { preloadPdfViewer } from '../lib/documents'
import { sameEmail } from '../lib/envelopeModel'
import { useFeedback } from '../components/feedback/useFeedback'
import { useSavedSignatures } from '../hooks/useSavedSignatures'
import { useAuth } from '../auth/useAuth'
import { isFieldComplete, validateSigningValues, signingDate, initialsOf, fieldLabel, limitAdjustment, signerCanMove } from '../../supabase/functions/_shared/signing.js'
import DocumentViewer from '../components/DocumentViewer'
import PageControls from '../components/PageControls'
import FillField from '../components/FillField'
import FullPageMessage from '../components/FullPageMessage'
import SigningDone from '../components/signing/SigningDone'
import { DocumentScreenSkeleton } from '../components/Skeleton'
import ErrorBanner from '../components/ErrorBanner'
import Modal from '../components/Modal'
import AdoptSignature from '../components/AdoptSignature'
import Brand from '../components/Brand'

const STATE_MESSAGES = {
  signed: { icon: CheckCircle2, title: 'You have already signed', body: 'Everyone will receive the completed document by email once all signers have finished.' },
  waiting: { icon: Clock, title: 'It is not your turn yet', body: 'This document is signed in order. We will email you when it is your turn.' },
  declined: { icon: XCircle, title: 'This envelope was declined', body: 'A recipient declined to sign, so it is closed.' },
  voided: { icon: XCircle, title: 'This envelope was voided', body: 'The sender cancelled it. Contact them if you think this is a mistake.' },
  closed: { icon: CheckCircle2, title: 'This envelope is closed', body: 'It is no longer open for signing.' }
}

/**
 * Sign an envelope: consent, fill in your fields (guided), adopt a signature, finish or decline.
 * Reached from an emailed link (/sign/:token) or, for team members, /envelopes/:envelopeId/sign.
 */
export default function SigningPage() {
  const { token, envelopeId } = useParams()
  const identity = useMemo(() => (token ? { token } : { envelopeId }), [token, envelopeId])

  const [session, setSession] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [pdfBytes, setPdfBytes] = useState(null)
  const [consented, setConsented] = useState(false)
  const [values, setValues] = useState({})
  // Where the signer moved or resized their fields: { [fieldId]: { x, y, w, h } }
  const [positions, setPositions] = useState({})
  const [adopted, setAdopted] = useState({ signature: null, initials: null })
  const [adopting, setAdopting] = useState(null) // { type, fieldId }
  const [selectedId, setSelectedId] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null) // { kind: 'signed' | 'declined', complete }
  const { doc: pdfDoc, pageSizes, error: pdfError } = usePdf(pdfBytes)
  // Team members signing as themselves can reuse and save signatures
  const { user } = useAuth()
  const { ask } = useFeedback()
  const canSaveSignatures = sameEmail(user?.email, session?.recipient?.email)
  const { saved: savedSignatures, save: saveSignature } = useSavedSignatures(canSaveSignatures)

  useEffect(() => {
    let cancelled = false
    preloadPdfViewer()
    ;(async () => {
      try {
        const s = await getSigningSession(identity)
        if (cancelled) return
        setSession(s)
        if (s.state === 'ready') {
          const res = await fetch(s.documentUrl)
          if (!res.ok) throw new Error('Could not download the document')
          const bytes = new Uint8Array(await res.arrayBuffer())
          if (!cancelled) setPdfBytes(bytes)
        }
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      }
    })()
    return () => { cancelled = true }
  }, [identity])

  const fields = useMemo(() => session?.fields ?? [], [session])
  const adjustable = session?.envelope?.allow_signer_adjustments === true
  // Text the sender filled in: part of the document, not something to sign
  const prefilled = useMemo(() => (session?.prefilled ?? []).map(p => ({
    ...p, type: 'prefill', fontSize: p.font_size, fixed: true, locked: true
  })), [session])
  // Required fields still to fill in, in document order ("Date signed" fills itself)
  const remaining = useMemo(() => fields.filter(f => !isFieldComplete(f, values[f.id])), [fields, values])
  const incompleteIds = useMemo(() => new Set(remaining.map(f => f.id)), [remaining])

  // Elements for the shared field renderer, with this signer's current values
  const elements = useMemo(() => fields.map(f => ({
    ...f,
    ...positions[f.id],
    fontSize: f.font_size,
    data: f.type === 'signature' || f.type === 'initials' ? values[f.id] ?? null : undefined,
    text: f.type === 'date' ? signingDate() : f.type === 'text' ? values[f.id] ?? '' : undefined,
    // "Date signed" is filled in by the server when you finish
    locked: f.type === 'date',
    fixed: !signerCanMove(f, adjustable),
    checked: f.type === 'checkbox' ? values[f.id] === 'true' : undefined
  })).concat(prefilled), [fields, values, positions, adjustable, prefilled])

  const setValue = useCallback((id, value) => setValues(v => ({ ...v, [id]: value })), [])

  const goToField = useCallback((field) => {
    setCurrentPage(field.page)
    setSelectedId(field.id)
    // Wait for the page to render, then bring the field into view
    setTimeout(() => document.querySelector(`[data-field-id="${field.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
  }, [])

  // Phones and narrow windows: show whole pages instead of scrolling sideways
  const fittedRef = useRef(false)
  useEffect(() => {
    if (fittedRef.current || !pageSizes.length) return
    fittedRef.current = true
    setZoom(fitWidthZoom(pageSizes, window.innerWidth))
  }, [pageSizes])

  // Start at the first field to fill in, like pressing "Start" in other e-sign tools
  const startedRef = useRef(false)
  useEffect(() => {
    if (startedRef.current || !consented || !pdfDoc || !pageSizes.length) return
    startedRef.current = true
    const first = remaining[0] ?? fields[0]
    if (first) goToField(first)
  }, [consented, pdfDoc, pageSizes.length, remaining, fields, goToField])

  // The next incomplete field after the selected one, in document order (fields come sorted by
  // page, y, x), wrapping around to the first
  const goToNext = () => {
    const position = fields.findIndex(f => f.id === selectedId)
    const next = remaining.find(f => (position >= 0 ? fields.indexOf(f) > position : f.page >= currentPage)) ?? remaining[0]
    if (next) goToField(next)
  }

  const handleActivate = useCallback((element) => {
    if (element.type === 'checkbox') {
      setValue(element.id, element.checked ? 'false' : 'true')
    } else if (element.type === 'signature' || element.type === 'initials') {
      // A signed field opens "change": adopt a new one or remove it from this field
      if (element.data) setAdopting({ type: element.type, fieldId: element.id, changing: true })
      else if (adopted[element.type]) setValue(element.id, adopted[element.type])
      else setAdopting({ type: element.type, fieldId: element.id })
    }
  }, [adopted, setValue])

  // Signers may nudge and resize their own fields a little (see limitAdjustment); only the
  // geometry is kept
  const moveField = useCallback((id, patch) => {
    const field = fields.find(f => f.id === id)
    if (!field || !signerCanMove(field, adjustable)) return
    setPositions(p => {
      const next = { x: field.x, y: field.y, w: field.w, h: field.h, ...p[id] }
      for (const key of ['x', 'y', 'w', 'h']) if (typeof patch[key] === 'number') next[key] = patch[key]
      return { ...p, [id]: limitAdjustment(field, next) }
    })
  }, [fields, adjustable])

  // While dragging, a field already stops at the limits it will be held to
  const constrainField = useCallback((element, rect) => {
    const field = fields.find(f => f.id === element.id)
    return field ? limitAdjustment(field, rect) : rect
  }, [fields])

  const clearValue = useCallback((id) => setValues(v => {
    const next = { ...v }
    delete next[id]
    return next
  }), [])

  const handleAdopt = (image, remember) => {
    const { type, fieldId } = adopting
    const previous = adopted[type]
    setAdopted(a => ({ ...a, [type]: image }))
    // A new signature replaces the old one everywhere it was used, so they all match
    setValues(v => {
      const next = { ...v, [fieldId]: image }
      if (previous) for (const f of fields) if (f.type === type && v[f.id] === previous) next[f.id] = image
      return next
    })
    setAdopting(null)
    if (remember) {
      saveSignature(type, image).catch(err => setError(`Your ${type} was added, but could not be saved for next time: ${err.message}`))
    }
  }

  const renderField = useCallback((element, ctx) => {
    const incomplete = incompleteIds.has(element.id)
    return (
      <div
        className={`w-full h-full ${incomplete ? 'ring-2 ring-amber-400' : ''}`}
        title={element.type === 'prefill' ? 'Filled in by the sender' : `${fieldLabel(element)}${element.required ? ' (required)' : ''}${element.data ? ' · click to change' : ''}`}
      >
        <FillField
          {...ctx}
          element={element}
          onUpdate={(patch) => { if ('text' in patch && element.type === 'text') setValue(element.id, patch.text) }}
        />
      </div>
    )
  }, [incompleteIds, setValue])

  const handleFinish = async () => {
    const { values: clean, problems } = validateSigningValues(fields, values)
    if (problems.length) {
      setError(problems[0])
      if (remaining[0]) goToField(remaining[0])
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await submitSigning(identity, clean, true, positions)
      setDone({ kind: 'signed', complete: Boolean(result?.complete) })
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  // The signer's own copy: the document with the fields they filled in (and the sender's text)
  const downloadCopy = async () => {
    const { buildSignedPdf, downloadPdf } = await import('../lib/exportPdf')
    downloadPdf(await buildSignedPdf(pdfBytes, elements), `${session.envelope.title}.pdf`)
  }

  const handleDecline = async () => {
    const reason = await ask({
      title: 'Decline to sign?',
      message: 'The sender will be told, and no one else will be able to sign this envelope.',
      label: 'Reason (optional)',
      placeholder: 'e.g. The dates in section 2 are wrong',
      confirmLabel: 'Decline',
      danger: true
    })
    if (reason === null) return
    setBusy(true)
    setError(null)
    try {
      await declineSigning(identity, reason)
      setDone({ kind: 'declined' })
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  if (loadError) {
    return (
      <FullPageMessage title="This link cannot be used">
        {loadError}. Signing links work once and expire with the envelope. If you already signed, you will receive
        the completed document by email; otherwise ask the sender for a new link.
      </FullPageMessage>
    )
  }
  if (!session) return <DocumentScreenSkeleton panel={false} />

  if (done) {
    return (
      <SigningDone
        kind={done.kind}
        complete={done.complete}
        session={session}
        backToApp={Boolean(envelopeId)}
        onDownload={downloadCopy}
      />
    )
  }

  if (session.state !== 'ready') {
    const message = STATE_MESSAGES[session.state] ?? STATE_MESSAGES.closed
    return <FullPageMessage title={message.title}>{message.body}</FullPageMessage>
  }

  if (!consented) {
    return (
      <ConsentScreen
        session={session}
        onContinue={() => setConsented(true)}
        onDecline={handleDecline}
        busy={busy}
        error={error}
      />
    )
  }

  // A selected, still-empty signature or initials field gets a big button (easier than a
  // small field on a phone)
  const selected = elements.find(e => e.id === selectedId)
  const signAction = selected && !selected.data && (selected.type === 'signature' || selected.type === 'initials')
    ? (selected.type === 'signature' ? 'Sign here' : 'Add initials')
    : null
  const finishButton = (className) => (
    <button
      onClick={handleFinish}
      disabled={busy || remaining.length > 0}
      className={`px-5 py-2.5 sm:py-2 btn-primary rounded-lg text-sm ${className}`}
    >
      {busy ? 'Finishing…' : 'Finish'}
    </button>
  )

  return (
    <div className="h-[100dvh] flex flex-col bg-gray-100">
      <header className="px-3 sm:px-5 py-2.5 sm:py-3 bg-white border-b border-gray-200/80 flex items-center gap-3 sm:gap-4">
        <Brand className="hidden sm:inline-flex text-lg pr-4 border-r border-gray-200" />
        <div className="flex-1 min-w-0">
          <p className="text-gray-900 font-semibold tracking-[-0.01em] truncate">{session.envelope.title}</p>
          <p className="text-xs text-gray-500 truncate">From {session.envelope.sender} · signing as {session.recipient.name}</p>
        </div>
        <button onClick={handleDecline} disabled={busy} className="px-2 sm:px-3 py-2 rounded-lg text-sm font-medium text-gray-500 hover:text-red-700 hover:bg-red-50 transition-colors disabled:opacity-50">
          Decline
        </button>
        {finishButton('hidden sm:block')}
      </header>

      {/* Progress: under the header on larger screens, a bottom bar within thumb reach on phones */}
      <div className="order-last sm:order-none px-3 sm:px-5 pt-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] sm:py-2 bg-white/95 backdrop-blur border-t sm:border-t-0 sm:border-b border-gray-200/80 shadow-[0_-4px_16px_-8px_rgba(15,21,35,0.12)] sm:shadow-none flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          {remaining.length > 0 ? (
            <>
              <span className="text-sm font-medium text-amber-700" data-testid="remaining">
                {remaining.length} required field{remaining.length > 1 ? 's' : ''} left
              </span>
              <button onClick={goToNext} className="px-3.5 py-2 sm:py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-gray-900 text-sm font-semibold shadow-sm flex items-center gap-1 transition-colors">
                Next <ChevronRight size={14} />
              </button>
            </>
          ) : (
            <span className="text-sm font-medium text-emerald-700 flex items-center gap-2">
              <CheckCircle2 size={14} className="flex-shrink-0" />
              <span>All required fields are complete<span className="hidden sm:inline">. Click Finish</span>.</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {signAction && (
            <button onClick={() => handleActivate(selected)} className="sm:hidden px-4 py-2.5 rounded-lg btn-primary text-sm flex items-center gap-1.5">
              <PenLine size={14} /> {signAction}
            </button>
          )}
          {remaining.length === 0 && finishButton('sm:hidden')}
          {adjustable && <span className="hidden md:inline text-xs text-gray-500">Drag a field to move it, or its corner to resize.</span>}
          <div className="hidden sm:block">
            <PageControls currentPage={currentPage} totalPages={pageSizes.length} zoom={zoom} onPageChange={setCurrentPage} onZoomChange={setZoom} />
          </div>
        </div>
      </div>

      {error && <ErrorBanner className="mx-3 sm:mx-5 mt-3">{error}</ErrorBanner>}

      {pdfError ? (
        <FullPageMessage title="Could not open the document">{pdfError.message}</FullPageMessage>
      ) : (
        <DocumentViewer
          pdfDoc={pdfDoc}
          pageSizes={pageSizes}
          elements={elements}
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          zoom={zoom}
          onUpdateElement={moveField}
          constrainElement={constrainField}
          renderField={renderField}
          selectedId={selectedId}
          onSelectedIdChange={setSelectedId}
          onActivateElement={handleActivate}
        />
      )}

      {adopting && (
        <Modal
          title={`${adopting.changing ? 'Change' : 'Adopt'} your ${adopting.type === 'signature' ? 'signature' : 'initials'}`}
          onClose={() => setAdopting(null)}
        >
          <p className="text-sm text-gray-500 mb-3">
            {adopting.type === 'signature'
              ? 'Draw or type your signature. It will be placed wherever you click a signature field.'
              : 'Draw or type your initials.'}
          </p>
          <AdoptSignature
            kind={adopting.type}
            defaultTypedName={adopting.type === 'signature' ? session.recipient.name : initialsOf(session.recipient.name)}
            saved={savedSignatures}
            canSave={canSaveSignatures}
            onAdopt={handleAdopt}
          />
          {adopting.changing && (
            <button
              onClick={() => { clearValue(adopting.fieldId); setAdopting(null) }}
              className="mt-4 w-full py-2.5 rounded-lg border border-gray-200 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Remove from this field
            </button>
          )}
        </Modal>
      )}
    </div>
  )
}

function ConsentScreen({ session, onContinue, onDecline, busy, error }) {
  const [agreed, setAgreed] = useState(false)
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gray-100 px-3 py-6 sm:p-6">
      <div className="w-full max-w-lg card p-5 sm:p-8 animate-pop-in">
        <Brand className="text-xl" />
        <p className="section-heading mt-7 mb-2">Signature requested</p>
        <h1 className="page-title text-[2rem] sm:text-4xl mb-2">{session.envelope.title}</h1>
        <p className="text-sm text-gray-500 mb-5">{session.envelope.sender} has asked you, {session.recipient.name}, to review and sign this document.</p>
        {session.envelope.message && (
          <p className="text-sm text-gray-800 whitespace-pre-wrap border-l-2 border-blue-300 pl-3 mb-6">{session.envelope.message}</p>
        )}

        <div className="bg-gray-50 ring-1 ring-inset ring-gray-200/80 rounded-xl p-4 text-xs text-gray-500 leading-relaxed mb-5">
          <p className="font-semibold text-gray-800 mb-1">Electronic record and signature disclosure</p>
          By continuing you agree to receive this document electronically and to sign it with an electronic signature,
          which has the same legal effect as a handwritten signature. You can decline to sign instead, or ask the sender
          for a paper copy. Your name, email, IP address, browser and the time of each step are recorded in a certificate
          of completion attached to the final document.
        </div>

        <label className="flex items-start gap-2.5 text-sm text-gray-800 mb-6 cursor-pointer">
          <input type="checkbox" className="mt-0.5 w-4 h-4 flex-shrink-0" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I agree to use electronic records and signatures.
        </label>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 sm:gap-3">
          <button onClick={onDecline} disabled={busy} className="px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:text-red-700 hover:bg-red-50 transition-colors">Decline to sign</button>
          <button onClick={onContinue} disabled={!agreed} className="px-6 py-3 sm:py-2.5 btn-primary rounded-lg text-sm">
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
