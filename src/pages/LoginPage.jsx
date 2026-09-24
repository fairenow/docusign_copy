import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ALLOWED_EMAIL_DOMAIN, isSupabaseConfigured } from '../lib/supabase'
import Brand from '../components/Brand'
import ErrorBanner from '../components/ErrorBanner'

// Only allow same-site relative paths as the post-login destination.
// Browsers treat "\" like "/", so "/\evil.com" would be protocol-relative too.
function safeNext(value) {
  return value && value.startsWith('/') && !/^\/[/\\]/.test(value) ? value : '/'
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
    <div className="min-h-screen flex items-center justify-center bg-dark-900 p-8">
      <div className="w-full max-w-sm bg-dark-800 border border-dark-700 rounded-2xl p-8 text-center">
        <h1 className="mb-2"><Brand className="text-2xl" /></h1>
        <p className="text-dark-400 text-sm mb-8">Send documents for signature and track them in one place.</p>

        <ErrorBanner>{error}</ErrorBanner>

        {sentTo ? (
          <div role="status">
            <h2 className="text-lg font-semibold text-white mb-2">Check your email</h2>
            <p className="text-sm text-dark-300">
              We sent a sign-in link to <span className="text-white">{sentTo}</span>. Open it in this browser to continue.
            </p>
            <button onClick={() => setSentTo(null)} className="mt-6 text-sm text-blue-400 hover:underline">
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="text-left">
            <label htmlFor="email" className="block text-sm text-dark-300 mb-1">Work email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={`you@${ALLOWED_EMAIL_DOMAIN}`}
              className="w-full px-3 py-2.5 rounded-lg bg-dark-900 border border-dark-600 text-white placeholder-dark-500 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={busy || !isSupabaseConfigured}
              className="mt-4 w-full py-3 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Email me a sign-in link'}
            </button>
          </form>
        )}

        <p className="mt-8 text-xs text-dark-500">
          Just need to sign something yourself? <Link to="/quick-sign" className="text-blue-400 hover:underline">Quick sign</Link> works without an account.
        </p>
      </div>
    </div>
  )
}
