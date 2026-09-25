import { createContext, useContext } from 'react'

export const AuthContext = createContext(null)

/** The current session, user and profile, plus sendSignInLink / signOut (see AuthProvider). */
export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
