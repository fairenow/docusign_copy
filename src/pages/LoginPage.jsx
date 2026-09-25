import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ALLOWED_EMAIL_DOMAIN, isSupabaseConfigured } from '../lib/supabase'
import Brand from '../components/Brand'
import ErrorBanner from '../components/ErrorBanner'

// The post-login destination must be a plain in-app path ("/envelopes/…?x=y"): no "//host",
// backslashes, spaces or control characters, which browsers can turn into another site's address
function safeNext(value) {
  return value && /^\/(?![/\\])[\w\-./?=&%#~]*$/.test(value) ? value : '/'
}

const DOMAIN_ONLY = `Only @${ALLOWED_EMAIL_DOMAIN} email addresses can sign in.`

// The database rejects sign-ups from other domains with this generic Auth error
const friendly = (message) => /database error saving new user/i.test(message) ? DOMAIN_ONLY : message

// Supabase reports sign-in link failures (expired, already used) in the query string or hash
function linkError(searchParams) {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const description = searchParams.get('error_description') || hash.get('error_description')
  return description ? friendly(description) : null
}

export default function LoginPage() {
  const { user, isLoading, sendSignInLink } = useAuth()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState(() => linkError(searchParams))
  const [email, setEmail] = useState('')
  const [sentTo, setSentTo] = useState(null)
  const [busy, setBusy] = useState(false)
  const next = safeNext(searchParams.get('next'))

  if (!isLoading && user) return <Navigate to={next} replace />

  const handleSubmit = async (e) => {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    setError(null)
    if (!address.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
      setError(DOMAIN_ONLY)
      return
    }
    setBusy(true)
    try {
      await sendSignInLink(address, next)
      setSentTo(address)
    } catch (err) {
      setError(friendly(err.message))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-gray-100">
      {/* Large screens: the brand story beside the form */}
      <aside className="hidden lg:flex w-[46%] max-w-2xl relative overflow-hidden bg-gray-950 text-white p-12 flex-col justify-between">
        <div className="absolute inset-0 opacity-60 bg-[radial-gradient(60rem_40rem_at_-10%_-10%,theme(colors.blue.700/45%),transparent_60%),radial-gradient(40rem_30rem_at_110%_110%,theme(colors.blue.500/25%),transparent_60%)]" aria-hidden="true" />
        <div className="absolute inset-0 opacity-[0.07] bg-[linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] bg-[size:48px_48px]" aria-hidden="true" />
        <span className="relative inline-flex items-center gap-2 text-lg font-semibold">
          <img src="/flmlnk-logo.png" alt="FLMLNK" className="h-6 w-auto brightness-0 invert" />
          <span className="text-white/60 font-medium">Sign</span>
        </span>
        <div className="relative">
          <h2 className="page-title text-white text-6xl leading-[1.02]">Agreements,<br />signed with ease.</h2>
          <ul className="mt-10 space-y-4 text-white/75 text-[15px]">
            {[
              'Sign it yourself in seconds, or send it to anyone',
              'A certificate and full audit trail with every signature',
              'The signed PDF lands in everyone\u2019s inbox automatically'
            ].map(line => (
              <li key={line} className="flex items-start gap-3">
                <span className="mt-2 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" aria-hidden="true" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">FLMLNK, Inc. · Internal e-signature</p>
      </aside>

      <main className="flex-1 flex items-center justify-center px-5 py-10 sm:p-10">
        <div className="w-full max-w-[400px] animate-pop-in">
          <div className="lg:hidden mb-8 text-center">
            <Brand className="text-2xl" />
          </div>
          <div className="card p-6 sm:p-8">
            <h1 className="page-title text-3xl sm:text-4xl mb-2">Welcome back</h1>
            <p className="text-gray-500 text-sm mb-7">Send documents for signature and track them in one place.</p>

            <ErrorBanner>{error}</ErrorBanner>

            {sentTo ? (
              <div role="status">
                <h2 className="text-lg font-semibold text-gray-900 mb-2">Check your email</h2>
                <p className="text-sm text-gray-600">
                  We sent a sign-in link to <span className="text-gray-900 font-medium">{sentTo}</span>. Open it in this browser to continue.
                </p>
                <button onClick={() => setSentTo(null)} className="mt-6 text-sm font-medium text-blue-700 hover:underline">
                  Use a different email
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="text-left">
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">Work email</label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder={`you@${ALLOWED_EMAIL_DOMAIN}`}
                  className="w-full px-3.5 py-3 rounded-lg bg-white border border-gray-200 shadow-xs text-gray-900 placeholder-gray-400"
                />
                <button
                  type="submit"
                  disabled={busy || !isSupabaseConfigured}
                  className="btn-primary mt-4 w-full py-3 px-4 rounded-lg"
                >
                  {busy ? 'Sending…' : 'Email me a sign-in link'}
                </button>
              </form>
            )}
          </div>

          <p className="mt-6 text-center text-xs text-gray-500">
            Just need to sign something yourself? <Link to="/quick-sign" className="font-medium text-blue-700 hover:underline">Quick sign</Link> works without an account.
          </p>
        </div>
      </main>
    </div>
  )
}
