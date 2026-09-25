import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Download, XCircle } from 'lucide-react'

/**
 * What a signer sees after finishing or declining: that it worked, what happens next, and a
 * copy of what they signed to keep.
 */
export default function SigningDone({ kind, complete, session, onDownload, backToApp }) {
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState(null)
  const { envelope, recipient } = session
  const firstName = recipient.name?.split(' ')[0] || recipient.name
  const signed = kind === 'signed'

  const download = async () => {
    setDownloading(true)
    setDownloadError(null)
    try {
      await onDownload()
    } catch (err) {
      setDownloadError(`Could not create the copy: ${err.message}`)
    }
    setDownloading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4 sm:p-8">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl p-6 sm:p-8 text-center shadow-sm">
        {signed
          ? <CheckCircle2 size={48} className="mx-auto text-green-600" aria-hidden="true" />
          : <XCircle size={48} className="mx-auto text-gray-400" aria-hidden="true" />}
        <h1 className="text-xl text-gray-900 font-semibold mt-4 mb-1">
          {signed ? `You're done, ${firstName}` : 'You declined to sign'}
        </h1>
        <p className="text-sm text-gray-500 mb-5">{envelope.title}</p>

        <div className="text-sm text-gray-700 leading-relaxed space-y-2 text-left bg-gray-50 rounded-lg p-4">
          {signed ? (
            complete ? (
              <p>Everyone has now signed. The completed document, with a certificate of completion, is on its way to <strong>{recipient.email}</strong>.</p>
            ) : (
              <>
                <p>Your signature has been recorded and {envelope.sender} has been told.</p>
                <p>When everyone has signed, the completed document is emailed to <strong>{recipient.email}</strong>.</p>
              </>
            )
          ) : (
            <p>{envelope.sender} has been told, with your reason if you gave one. Nobody else can sign this envelope now.</p>
          )}
        </div>

        {signed && (
          <div className="mt-5">
            <button
              onClick={download}
              disabled={downloading}
              className="btn-secondary w-full px-4 py-2.5 rounded-lg text-sm flex items-center justify-center gap-2"
            >
              <Download size={16} /> {downloading ? 'Preparing…' : 'Download a copy of what you signed'}
            </button>
            <p className="text-xs text-gray-500 mt-2">
              {complete ? 'The emailed copy includes the certificate of completion.' : 'Only your part is filled in; the emailed copy will have everyone\'s.'}
            </p>
            {downloadError && <p role="alert" className="text-xs text-red-700 mt-2">{downloadError}</p>}
          </div>
        )}

        {backToApp && (
          <p className="mt-6 text-sm"><Link to="/" className="text-blue-600 hover:underline">Back to envelopes</Link></p>
        )}
        <p className="mt-6 text-xs text-gray-400">You can close this page.</p>
      </div>
    </div>
  )
}
