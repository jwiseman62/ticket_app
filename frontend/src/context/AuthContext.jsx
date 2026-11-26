import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import * as api from '../api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  })

  /* Whether this account still owes acceptance of the current terms.
   *
   * Seeded from the stored session rather than defaulting to false, because
   * a false default would render the application for a moment on every
   * reload before flipping to the gate — and every request it fired in that
   * moment would come back 403. The value is then re-checked against the
   * server on mount, since the terms can change between visits. */
  const [termsRequired, setTermsRequired] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user'))?.termsRequired === true }
    catch { return false }
  })

  const persist = useCallback((userObj) => {
    localStorage.setItem('user', JSON.stringify(userObj))
    setUser(userObj)
    setTermsRequired(userObj.termsRequired === true)
    return userObj
  }, [])

  /** Store a token response and become that user. */
  const adoptSession = useCallback((data) => {
    localStorage.setItem('token', data.access_token)
    return persist({
      name: data.name,
      role: data.role,
      // Older tokens and any response that predates this field are treated
      // as "unknown, assume fine" — the mount check below corrects it.
      termsRequired: data.terms_required === true,
    })
  }, [persist])

  const doLogin = useCallback(async (username, password) => {
    const data = await api.login(username, password)
    return adoptSession(data)
  }, [adoptSession])

  const doLogout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
    setTermsRequired(false)
  }, [])

  /** Called by the gate once the server has recorded the acceptance. */
  const markTermsAccepted = useCallback(() => {
    setUser((prev) => {
      if (!prev) return prev
      const next = { ...prev, termsRequired: false }
      localStorage.setItem('user', JSON.stringify(next))
      return next
    })
    setTermsRequired(false)
  }, [])

  /* Re-check on load. The terms can be bumped while someone holds a valid
   * token, so the stored flag is a starting guess, not the truth. A failure
   * here is left alone: if the server is asleep or unreachable the backend
   * gate still refuses everything, so guessing "accepted" is safe. */
  useEffect(() => {
    if (!localStorage.getItem('token')) return undefined
    let cancelled = false
    api.termsStatus()
      .then((s) => {
        if (cancelled) return
        const owed = s.acceptance_required === true
        setTermsRequired(owed)
        setUser((prev) => {
          if (!prev || prev.termsRequired === owed) return prev
          const next = { ...prev, termsRequired: owed }
          localStorage.setItem('user', JSON.stringify(next))
          return next
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user?.name])

  return (
    <AuthContext.Provider value={{
      user,
      login: doLogin,
      logout: doLogout,
      adoptSession,
      termsRequired,
      markTermsAccepted,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)