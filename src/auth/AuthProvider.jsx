import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
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

  // Email a one-time sign-in link. It returns to /login, which forwards to `returnTo` on
  // success and shows link errors otherwise. With PKCE the link must be opened in this browser.
  const sendSignInLink = useCallback(async (email, returnTo = '/') => {
    const emailRedirectTo = new URL('/login', window.location.origin)
    emailRedirectTo.searchParams.set('next', returnTo)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: emailRedirectTo.href, shouldCreateUser: true }
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut()
  }, [])

  const value = useMemo(() => ({
    user: session?.user ?? null,
    profile,
    // Admins are decided in the database (private.admin_emails); this only chooses what to show
    isAdmin: profile?.role === 'admin',
    isLoading: session === undefined,
    sendSignInLink,
    signOut
  }), [session, profile, sendSignInLink, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
