import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/useAuth'
import { ALLOWED_EMAIL_DOMAIN, isSupabaseConfigured } from '../lib/supabase'

// Only allow same-site relative paths as the post-login destination
function safeNext(value) {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

// Supabase reports OAuth failures in the query string or hash of the redirect
function oauthError(searchParams) {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const description = searchParams.get('error_description') || hash.get('error_description')
  if (!description) return null
  if (/database error saving new user/i.test(description)) {
    return `Only @${ALLOWED_EMAIL_DOMAIN} Google accounts can sign in.`
  }
  return description
}

export default function LoginPage() {
  const { user, isLoading, signInWithGoogle } = useAuth()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState(() => oauthError(searchParams))
  const [busy, setBusy] = useState(false)
  const next = safeNext(searchParams.get('next'))

  if (!isLoading && user) return <Navigate to={next} replace />

  const handleSignIn = async () => {
    setBusy(true)
    setError(null)
    try {
      await signInWithGoogle(next)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900 p-8">
      <div className="w-full max-w-sm bg-dark-800 border border-dark-700 rounded-2xl p-8 text-center">
        <h1 className="text-2xl font-bold gradient-text mb-2">📝 DocSign</h1>
        <p className="text-dark-400 text-sm mb-8">Send documents for signature and track them in one place.</p>

        {error && (
          <p role="alert" className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</p>
        )}

        <button
          onClick={handleSignIn}
          disabled={busy || !isSupabaseConfigured}
          className="w-full py-3 px-4 rounded-lg bg-white text-gray-800 font-medium flex items-center justify-center gap-3 hover:bg-gray-100 disabled:opacity-60"
        >
          <GoogleLogo />
          {busy ? 'Redirecting…' : 'Sign in with Google'}
        </button>
        <p className="mt-4 text-xs text-dark-500">Use your @{ALLOWED_EMAIL_DOMAIN} account.</p>

        <p className="mt-8 text-xs text-dark-500">
          Just need to sign something yourself? <a href="/quick-sign" className="text-blue-400 hover:underline">Quick sign</a> works without an account.
        </p>
      </div>
    </div>
  )
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
