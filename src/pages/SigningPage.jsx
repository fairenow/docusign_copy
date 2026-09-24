import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ChevronRight, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { declineSigning, getSigningSession, submitSigning } from '../lib/api'
import { usePdf } from '../hooks/usePdf'
import { isFieldComplete, validateSigningValues, signingDate, initialsOf, fieldLabel } from '../../supabase/functions/_shared/signing.js'
import DocumentViewer from '../components/DocumentViewer'
import PageControls from '../components/PageControls'
import FillField from '../components/FillField'
import FullPageMessage from '../components/FullPageMessage'
import ErrorBanner from '../components/ErrorBanner'
import Modal from '../components/Modal'
import SignaturePanel from '../components/SignaturePanel'
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
  const [adopted, setAdopted] = useState({ signature: null, initials: null })
  const [adopting, setAdopting] = useState(null) // { type, fieldId }
  const [selectedId, setSelectedId] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [done, setDone] = useState(null) // 'signed' | 'declined'
  const { doc: pdfDoc, pageSizes, error: pdfError } = usePdf(pdfBytes)

  useEffect(() => {
    let cancelled = false
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
  // Required fields still to fill in, in document order ("Date signed" fills itself)
  const remaining = useMemo(() => fields.filter(f => !isFieldComplete(f, values[f.id])), [fields, values])
  const incompleteIds = useMemo(() => new Set(remaining.map(f => f.id)), [remaining])

  // Elements for the shared field renderer, with this signer's current values
  const elements = useMemo(() => fields.map(f => ({
    ...f,
    fontSize: f.font_size,
    data: f.type === 'signature' || f.type === 'initials' ? values[f.id] ?? null : undefined,
    text: f.type === 'date' ? signingDate() : f.type === 'text' ? values[f.id] ?? '' : undefined,
    // "Date signed" is filled in by the server when you finish
    locked: f.type === 'date',
    checked: f.type === 'checkbox' ? values[f.id] === 'true' : undefined
  })), [fields, values])

  const setValue = useCallback((id, value) => setValues(v => ({ ...v, [id]: value })), [])

  const goToField = useCallback((field) => {
    setCurrentPage(field.page)
    setSelectedId(field.id)
    // Wait for the page to render, then bring the field into view
    setTimeout(() => document.querySelector(`[data-field-id="${field.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
  }, [])

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
      if (adopted[element.type]) setValue(element.id, adopted[element.type])
      else setAdopting({ type: element.type, fieldId: element.id })
    }
  }, [adopted, setValue])

  const handleAdopt = ({ data }) => {
    setAdopted(a => ({ ...a, [adopting.type]: data }))
    setValue(adopting.fieldId, data)
    setAdopting(null)
  }

  const renderField = useCallback((element, ctx) => {
    const incomplete = incompleteIds.has(element.id)
    return (
      <div
        className={`w-full h-full ${incomplete ? 'ring-2 ring-amber-400' : ''}`}
        title={`${fieldLabel(element)}${element.required ? ' (required)' : ''}`}
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
      await submitSigning(identity, clean, true)
      setDone('signed')
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  const handleDecline = async () => {
    const reason = window.prompt('Decline to sign? The sender will be notified and the envelope will be closed.\n\nReason (optional):')
    if (reason === null) return
    setBusy(true)
    setError(null)
    try {
      await declineSigning(identity, reason)
      setDone('declined')
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
  if (!session) return <FullPageMessage title="Loading…" />

  if (done) {
    return (
      <FullPageMessage title={done === 'signed' ? 'Thank you, you are done' : 'You declined to sign'}>
        {done === 'signed'
          ? 'Your signature has been recorded. Everyone will receive the completed document by email once all signers have finished.'
          : 'The sender has been notified.'}
        {envelopeId && <p className="mt-4"><Link to="/" className="text-blue-400 underline">Back to envelopes</Link></p>}
      </FullPageMessage>
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

  return (
    <div className="h-screen flex flex-col bg-dark-900">
      <header className="px-5 py-3 bg-dark-800 border-b border-dark-700 flex items-center gap-4">
        <Brand />
        <div className="flex-1 min-w-0">
          <p className="text-gray-100 font-medium truncate">{session.envelope.title}</p>
          <p className="text-xs text-dark-400 truncate">From {session.envelope.sender} · signing as {session.recipient.name}</p>
        </div>
        <button onClick={handleDecline} disabled={busy} className="px-3 py-2 rounded-lg text-sm text-dark-400 hover:text-red-300 disabled:opacity-50">
          Decline
        </button>
        <button
          onClick={handleFinish}
          disabled={busy || remaining.length > 0}
          className="px-5 py-2 btn-gradient rounded-lg text-white text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Finishing…' : 'Finish'}
        </button>
      </header>

      <div className="px-5 py-2 bg-dark-800 border-b border-dark-700 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {remaining.length > 0 ? (
            <>
              <span className="text-sm text-amber-300" data-testid="remaining">
                {remaining.length} required field{remaining.length > 1 ? 's' : ''} left
              </span>
              <button onClick={goToNext} className="px-3 py-1.5 rounded-lg bg-amber-400 text-gray-900 text-sm font-medium flex items-center gap-1">
                Next <ChevronRight size={14} />
              </button>
            </>
          ) : (
            <span className="text-sm text-green-300 flex items-center gap-2"><CheckCircle2 size={14} /> All required fields are complete. Click Finish.</span>
          )}
        </div>
        <PageControls currentPage={currentPage} totalPages={pageSizes.length} zoom={zoom} onPageChange={setCurrentPage} onZoomChange={setZoom} />
      </div>

      {error && <ErrorBanner className="mx-5 mt-3">{error}</ErrorBanner>}

      {pdfError ? (
        <FullPageMessage title="Could not open the document">{pdfError.message}</FullPageMessage>
      ) : (
        <DocumentViewer
          pdfDoc={pdfDoc}
          pageSizes={pageSizes}
          elements={elements}
          currentPage={currentPage}
          zoom={zoom}
          readOnly
          renderField={renderField}
          selectedId={selectedId}
          onSelectedIdChange={setSelectedId}
          onActivateElement={handleActivate}
        />
      )}

      {adopting && (
        <Modal title={adopting.type === 'signature' ? 'Adopt your signature' : 'Adopt your initials'} onClose={() => setAdopting(null)}>
          <p className="text-sm text-dark-400 mb-3">
            {adopting.type === 'signature'
              ? 'Draw or type your signature. It will be placed wherever you click a signature field.'
              : 'Draw or type your initials.'}
          </p>
          <SignaturePanel
            onApply={handleAdopt}
            defaultTypedName={adopting.type === 'signature' ? session.recipient.name : initialsOf(session.recipient.name)}
            applyLabel="Adopt and sign"
          />
        </Modal>
      )}
    </div>
  )
}

function ConsentScreen({ session, onContinue, onDecline, busy, error }) {
  const [agreed, setAgreed] = useState(false)
  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900 p-6">
      <div className="w-full max-w-lg bg-dark-800 border border-dark-700 rounded-2xl p-8">
        <Brand className="text-xl" />
        <h1 className="text-xl text-gray-100 font-semibold mt-6 mb-1">{session.envelope.title}</h1>
        <p className="text-sm text-dark-400 mb-4">{session.envelope.sender} has asked you, {session.recipient.name}, to review and sign this document.</p>
        {session.envelope.message && (
          <p className="text-sm text-gray-200 whitespace-pre-wrap border-l-2 border-dark-600 pl-3 mb-6">{session.envelope.message}</p>
        )}

        <div className="bg-dark-700 rounded-lg p-4 text-xs text-dark-400 leading-relaxed mb-4">
          <p className="font-semibold text-gray-200 mb-1">Electronic record and signature disclosure</p>
          By continuing you agree to receive this document electronically and to sign it with an electronic signature,
          which has the same legal effect as a handwritten signature. You can decline to sign instead, or ask the sender
          for a paper copy. Your name, email, IP address, browser and the time of each step are recorded in a certificate
          of completion attached to the final document.
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-200 mb-6 cursor-pointer">
          <input type="checkbox" className="mt-1" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          I agree to use electronic records and signatures.
        </label>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex justify-between">
          <button onClick={onDecline} disabled={busy} className="px-3 py-2 text-sm text-dark-400 hover:text-red-300">Decline to sign</button>
          <button onClick={onContinue} disabled={!agreed} className="px-5 py-2 btn-gradient rounded-lg text-white text-sm font-medium disabled:opacity-50">
            Continue
          </button>
        </div>
      </div>
    </div>
  )
}
