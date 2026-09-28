import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import * as api from '../api.js'

/**
 * Where a technician lands after scanning the QR.
 *
 * The code arrives as ?code=TECH-XXXX-XXXX. If they're signed in we redeem
 * straight away; if not, we send them to sign in and bring them back here
 * with the code intact.
 */
export default function Redeem() {
  const [params]  = useSearchParams()
  const { user }  = useAuth()
  const toast     = useToast()
  const navigate  = useNavigate()

  const urlCode = params.get('code') || ''
  const [code,    setCode]    = useState(urlCode)
  const [busy,    setBusy]    = useState(false)
  const [result,  setResult]  = useState(null)
  const [error,   setError]   = useState('')

  // Auto-submit when arriving from a scan while already signed in
  useEffect(() => {
    if (urlCode && user && !result && !busy) {
      handleRedeem(urlCode)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlCode, user])

  async function handleRedeem(value) {
    const submitted = (value ?? code).trim()
    if (!submitted) { setError('Enter the code from your administrator.'); return }

    setBusy(true)
    setError('')
    try {
      const updated = await api.redeemInvite(submitted)
      setResult(updated)
      toast.success(`You are now a ${updated.role}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // Not signed in — park the code and send them to login
  if (!user) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1 className="auth-title">🎫 IT Ticket System</h1>
          <h2 className="auth-subtitle">Access Code</h2>
          <div className="alert alert-info-soft">
            Sign in first, then this code will unlock your technician access.
          </div>
          {urlCode && (
            <div className="redeem-code-display">{urlCode}</div>
          )}
          <Link
            to="/login"
            state={{ message: 'Sign in, then your access code will be applied.' }}
            className="btn btn-primary btn-block"
          >
            Sign in
          </Link>
          <p className="auth-footer">
            No account yet? <Link to="/register">Create one</Link>
          </p>
        </div>
      </div>
    )
  }

  // Done
  if (result) {
    return (
      <div className="wizard-page">
        <div className="wizard-panel wizard-done">
          <div className="wizard-done-icon">🔓</div>
          <h1 className="wizard-title">You're a {result.role}</h1>
          <p className="wizard-sub">
            Your access has been upgraded. <strong>Sign out and back in</strong> to
            load your new permissions — your current session still carries the old
            role.
          </p>
          <div className="wizard-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                localStorage.removeItem('token')
                localStorage.removeItem('user')
                window.location.href = '/login'
              }}
            >
              Sign out and back in
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/')}>
              Later
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Entry form
  return (
    <div className="wizard-page">
      <div className="wizard-panel">
        <h1 className="wizard-title">Enter your access code</h1>
        <p className="wizard-sub">
          Your administrator will have sent you a code or a QR code. Entering it
          here unlocks technician tools on your account.
        </p>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="form-group">
          <label htmlFor="code">Access code</label>
          <input
            id="code"
            type="text"
            className="redeem-input"
            value={code}
            autoFocus
            placeholder="TECH-XXXX-XXXX"
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRedeem()}
          />
          <span className="field-hint">
            Dashes and capitals don't matter — type it however it's easiest.
          </span>
        </div>

        <div className="wizard-actions">
          <button
            className="btn btn-primary"
            disabled={busy || !code.trim()}
            onClick={() => handleRedeem()}
          >
            {busy ? 'Checking…' : 'Redeem code'}
          </button>
          <button className="btn btn-ghost" onClick={() => navigate('/')}>
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}