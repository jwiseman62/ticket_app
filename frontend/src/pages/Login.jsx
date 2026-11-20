import { useState, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { DEMO_MODE, DEMO_ACCOUNTS, ping } from '../api.js'
import * as api from '../api.js'

/** How long the API may take before we explain the delay to the visitor. */
const WAKE_NOTICE_AFTER_MS = 2500

export default function Login() {
  const { login, adoptSession } = useAuth()
  const navigate     = useNavigate()
  const location     = useLocation()
  // Set by Register after a successful signup: "Account created. Please sign in."
  const notice       = location.state?.message
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [waking,   setWaking]   = useState(false)
  // Set when the API answers a correct password with "verify first".
  const [challenge, setChallenge] = useState(null)
  const [code,      setCode]      = useState('')
  const [resent,    setResent]    = useState(false)

  // A free-tier backend spins down when idle, so the first request after a
  // quiet spell can take the better part of a minute. Without an explanation
  // the page just looks broken, so ping the API on load and say what's
  // happening if it doesn't answer promptly.
  useEffect(() => {
    if (!DEMO_MODE) return
    let settled = false
    const timer = setTimeout(() => { if (!settled) setWaking(true) }, WAKE_NOTICE_AFTER_MS)
    ping().then(() => {
      settled = true
      clearTimeout(timer)
      setWaking(false)
    })
    return () => { settled = true; clearTimeout(timer) }
  }, [])

  async function signIn(user, pass) {
    setError('')
    setLoading(true)
    try {
      await login(user, pass)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      // A correct password can still be refused pending a code. That's not
      // a failure to report — it's the next step.
      if (err.detail?.code === 'verification_required') {
        setChallenge(err.detail)
        setCode('')
      } else {
        setError(err.message)
      }
    } finally {
      setLoading(false)
    }
  }

  async function submitCode(e) {
    e.preventDefault()
    if (code.trim().length !== 6) return
    setError('')
    setLoading(true)
    try {
      const data = await api.verifyCode(challenge.username, code.trim())
      adoptSession(data)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    setError('')
    try {
      await api.resendCode(challenge.username)
      setResent(true)
      setTimeout(() => setResent(false), 4000)
    } catch (err) {
      setError(err.message)
    }
  }

  function handleSubmit(e) {
    e.preventDefault()
    signIn(username, password)
  }

  function handleDemo(account) {
    setUsername(account.username)
    setPassword(account.password)
    signIn(account.username, account.password)
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="auth-brand">🎫 Tech Help</Link>
        <h2 className="auth-subtitle">Sign In</h2>

        {waking && (
          <div className="alert alert-info-soft wake-notice">
            <span className="wake-spinner" aria-hidden="true" />
            <span>
              <strong>Waking the demo server.</strong> It sleeps when idle to
              stay on the free tier — this takes up to a minute.
            </span>
          </div>
        )}

        {challenge ? (
          <div className="verify-panel">
            <p className="verify-lead">
              For your security, confirm it's you. We sent a 6-digit code to{' '}
              <strong>{challenge.email_hint}</strong>.
            </p>

            {error  && <div className="alert alert-error">{error}</div>}
            {resent && <div className="alert alert-success">A new code is on its way.</div>}

            <form onSubmit={submitCode} className="auth-form">
              <div className="form-group">
                <label htmlFor="code">Verification code</label>
                <input
                  id="code" type="text" inputMode="numeric" autoComplete="one-time-code"
                  // A six-box input looks nicer but fights paste and
                  // autofill, which is how most people enter these.
                  className="verify-code-input"
                  maxLength={6} autoFocus placeholder="000000"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              </div>

              <button type="submit" className="btn btn-primary btn-block"
                      disabled={loading || code.length !== 6}>
                {loading ? 'Checking…' : 'Verify and sign in'}
              </button>
            </form>

            <div className="verify-actions">
              <button type="button" className="btn btn-ghost btn-sm"
                      onClick={handleResend}>
                Send another code
              </button>
              <button type="button" className="btn btn-ghost btn-sm"
                      onClick={() => { setChallenge(null); setError(''); setCode('') }}>
                ← Back to sign in
              </button>
            </div>
          </div>
        ) : (
        <>
        {DEMO_MODE && (
          <div className="demo-panel">
            <div className="demo-panel-title">Try it instantly</div>
            <p className="demo-panel-sub">
              Pick a role — no signup needed. Data resets nightly, so feel free
              to change anything.
            </p>
            <div className="demo-accounts">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.username}
                  type="button"
                  className="demo-account"
                  disabled={loading}
                  onClick={() => handleDemo(a)}
                >
                  <span className="demo-account-role">{a.role}</span>
                  <span className="demo-account-blurb">{a.blurb}</span>
                  <span className="demo-account-user">{a.username}</span>
                </button>
              ))}
            </div>
            <div className="demo-divider"><span>or sign in manually</span></div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          {notice && <div className="alert alert-success">{notice}</div>}
          {error  && <div className="alert alert-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username" type="text" value={username} autoFocus autoComplete="username"
              onChange={(e) => setUsername(e.target.value)} required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password" type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign In'}
          </button>
        </form>

        </>
        )}

        <p className="auth-footer">
          No account? <Link to="/register">Register</Link>
          &nbsp;·&nbsp;
          <Link to="/">Back to Home</Link>
        </p>
      </div>
    </div>
  )
}