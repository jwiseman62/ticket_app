import { createContext, useContext, useState, useCallback } from 'react'
import * as api from '../api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')) } catch { return null }
  })

  /** Store a token response and become that user. */
  const adoptSession = useCallback((data) => {
    const userObj = { name: data.name, role: data.role }
    localStorage.setItem('token', data.access_token)
    localStorage.setItem('user', JSON.stringify(userObj))
    setUser(userObj)
    return userObj
  }, [])

  const doLogin = useCallback(async (username, password) => {
    const data = await api.login(username, password)
    return adoptSession(data)
  }, [adoptSession])

  const doLogout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, login: doLogin, logout: doLogout, adoptSession }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)