import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'
import { isSupabaseConfigured } from '../lib/supabase'
import FullPageMessage from '../components/FullPageMessage'

/** Render children only for signed-in users; otherwise send them to /login and back afterwards. */
export default function RequireAuth({ children }) {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (!isSupabaseConfigured) {
    return (
      <FullPageMessage title="Backend not configured">
        Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to use envelopes.
        You can still use <a className="text-blue-400 underline" href="/quick-sign">Quick sign</a>.
      </FullPageMessage>
    )
  }
  if (isLoading) return <FullPageMessage title="Loading…" />
  if (!user) {
    const next = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }
  return children
}
