import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, ALLOWED_EMAIL_DOMAIN } from '../lib/supabase'
import { fetchProfile } from '../lib/api'
import { AuthContext } from './useAuth'

/**
 * Provides the Supabase session and the signed-in user's profile.
 * session is `undefined` while the initial session is being restored.
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(supabase ? undefined : null)
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    // Do not call other Supabase methods inside this callback (it can deadlock the auth client)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  useEffect(() => {
    if (!userId) {
      setProfile(null)
      return
    }
    let cancelled = false
    fetchProfile(userId)
      .then(p => { if (!cancelled) setProfile(p) })
      .catch(err => console.error('Could not load profile:', err))
    return () => { cancelled = true }
  }, [userId])

  const signInWithGoogle = useCallback(async (returnTo = '/') => {
    // Come back to /login: it forwards to `returnTo` on success and shows OAuth errors otherwise
    const redirectTo = new URL('/login', window.location.origin)
    redirectTo.searchParams.set('next', returnTo)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo.href,
        // hd limits Google's account picker to the Workspace domain; the database enforces it
        queryParams: { hd: ALLOWED_EMAIL_DOMAIN, prompt: 'select_account' }
      }
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut()
  }, [])

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    isLoading: session === undefined,
    signInWithGoogle,
    signOut
  }), [session, profile, signInWithGoogle, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
