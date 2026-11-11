import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import * as api from '../api.js'

const MIN_PASSWORD = 8

const ROLE_BLURB = {
  Requester:  'You can file tickets and follow your own.',
  Technician: 'You can pick up, work, and close any ticket.',
  Both:       'Full admin — you manage users and the knowledge base.',
}

export default function Profile() {
  const { user }              = useAuth()
  const { theme, toggleTheme, useSystemTheme } = useTheme()
  const toast                 = useToast()

  const [me,      setMe]      = useState(null)
  const [loading, setLoading] = useState(true)

  // Email
  const [email,      setEmail]      = useState('')
  const [savingMail, setSavingMail] = useState(false)

  // Password
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  useEffect(() => {
    api.getMe()
      .then((u) => { setMe(u); setEmail(u.email || '') })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [toast])

  async function saveEmail(e) {
    e.preventDefault()
    if (!email.trim()) { toast.error('Email cannot be empty.'); return }
    setSavingMail(true)
    try {
      const updated = await api.updateUserEmail(me.id, email.trim())
      setMe(updated)
      toast.success('Email updated.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingMail(false)
    }
  }

  async function savePassword(e) {
    e.preventDefault()
    if (pw1.length < MIN_PASSWORD) {
      toast.error(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (pw1 !== pw2) {
      toast.error('Passwords do not match.')
      return
    }
    setSavingPw(true)
    try {
      await api.changeMyPassword(pw1)
      setPw1('')
      setPw2('')
      toast.success('Password changed. It applies next time you sign in.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingPw(false)
    }
  }

  if (loading) return <div className="page-loading">Loading your profile…</div>

  const pwTooShort = pw1.length > 0 && pw1.length < MIN_PASSWORD
  const mismatch   = pw2.length > 0 && pw1 !== pw2

  return (
    <div className="profile-page">
      <div className="profile-header">
        <div className="profile-avatar">{user.name.slice(0, 2).toUpperCase()}</div>
        <div>
          <h1 className="home-title">{user.name}</h1>
          <p className="home-subtitle">
            <span className="navbar-role-badge">{user.role}</span>
            {' '}{ROLE_BLURB[user.role]}
          </p>
        </div>
      </div>

      {/* Email */}
      <section className="profile-card">
        <h2 className="chart-title">Email</h2>
        <p className="profile-hint">
          Where ticket notifications are sent — new comments, status changes,
          and when someone picks up your ticket.
        </p>

        {!me?.email && (
          <div className="alert alert-warn">
            You have no email on file, so you are not receiving any
            notifications. Add one below.
          </div>
        )}

        <form onSubmit={saveEmail} className="profile-form">
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email" type="email" value={email}
              placeholder="name@example.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={savingMail}>
            {savingMail ? 'Saving…' : 'Save Email'}
          </button>
        </form>
      </section>

      {/* Password */}
      <section className="profile-card">
        <h2 className="chart-title">Change Password</h2>
        <p className="profile-hint">
          At least {MIN_PASSWORD} characters. You will stay signed in on this
          device.
        </p>

        <form onSubmit={savePassword} className="profile-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="pw1">New password</label>
              <input
                id="pw1" type="password" value={pw1} autoComplete="new-password"
                className={pwTooShort ? 'input-invalid' : ''}
                onChange={(e) => setPw1(e.target.value)}
              />
              {pwTooShort && (
                <span className="field-hint field-hint-warn">
                  Too short — {MIN_PASSWORD} characters minimum.
                </span>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="pw2">Confirm password</label>
              <input
                id="pw2" type="password" value={pw2} autoComplete="new-password"
                className={mismatch ? 'input-invalid' : ''}
                onChange={(e) => setPw2(e.target.value)}
              />
              {mismatch && (
                <span className="field-hint field-hint-warn">
                  Passwords do not match.
                </span>
              )}
            </div>
          </div>
          <button
            type="submit" className="btn btn-primary"
            disabled={savingPw || !pw1 || !pw2}
          >
            {savingPw ? 'Saving…' : 'Change Password'}
          </button>
        </form>
      </section>

      {/* Admin shortcut */}
      {user.role === 'Both' && (
        <section className="profile-card">
          <h2 className="chart-title">Administration</h2>
          <p className="profile-hint">
            Manage accounts and roles, approve technician requests, and issue
            access codes.
          </p>
          <Link to="/admin" className="btn btn-primary">Open admin page</Link>
        </section>
      )}

      {/* Appearance */}
      <section className="profile-card">
        <h2 className="chart-title">Appearance</h2>
        <p className="profile-hint">
          Currently using <strong>{theme}</strong> mode.
        </p>
        <div className="profile-form-actions">
          <button className="btn btn-secondary" onClick={toggleTheme}>
            Switch to {theme === 'dark' ? 'light' : 'dark'} mode
          </button>
          <button className="btn btn-ghost" onClick={useSystemTheme}>
            Follow system setting
          </button>
        </div>
      </section>
    </div>
  )
}