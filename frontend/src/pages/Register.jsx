import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../api.js'

const MIN_PASSWORD = 8

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '', email: '', password: '', confirm: '', accountType: 'Requester',
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }))

  const pwTooShort = form.password.length > 0 && form.password.length < MIN_PASSWORD
  const mismatch   = form.confirm.length > 0 && form.password !== form.confirm
  const wantsTech  = form.accountType === 'Technician'

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (form.password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await api.register(
        form.name, form.email, form.password,
        wantsTech ? 'Technician' : '',
      )
      navigate('/login', {
        state: {
          message: wantsTech
            ? 'Account created. Sign in to get started — an administrator will send you an access code to unlock Technician tools.'
            : 'Account created. Please sign in.',
        },
      })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1 className="auth-title">🎫 IT Ticket System</h1>
        <h2 className="auth-subtitle">Create Account</h2>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="alert alert-error">{error}</div>}

          {/* Account type */}
          <div className="form-group">
            <label>I'm signing up as…</label>
            <div className="account-type-choice">
              <button
                type="button"
                className={`account-type ${!wantsTech ? 'selected' : ''}`}
                onClick={() => setForm((p) => ({ ...p, accountType: 'Requester' }))}
              >
                <span className="account-type-icon">🙋</span>
                <span className="account-type-label">Requester</span>
                <span className="account-type-blurb">I need help with something</span>
              </button>
              <button
                type="button"
                className={`account-type ${wantsTech ? 'selected' : ''}`}
                onClick={() => setForm((p) => ({ ...p, accountType: 'Technician' }))}
              >
                <span className="account-type-icon">🔧</span>
                <span className="account-type-label">Technician</span>
                <span className="account-type-blurb">I fix things — needs approval</span>
              </button>
            </div>
          </div>

          {wantsTech && (
            <div className="alert alert-info-soft">
              <strong>Technician accounts need approval.</strong> You'll be able
              to sign in right away and file tickets. An administrator will send
              you an access code — scan it or enter it to unlock technician
              tools.
            </div>
          )}

          <div className="form-group">
            <label htmlFor="name">Name</label>
            <input
              id="name" type="text" value={form.name} onChange={set('name')}
              required autoFocus autoComplete="username" minLength={2}
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email" type="email" value={form.email} onChange={set('email')}
              required autoComplete="email"
            />
            <span className="field-hint">Ticket notifications are sent here.</span>
          </div>

          <div className="form-group">
            <label htmlFor="pw">Password</label>
            <input
              id="pw" type="password" value={form.password} onChange={set('password')}
              required autoComplete="new-password" minLength={MIN_PASSWORD}
              className={pwTooShort ? 'input-invalid' : ''}
            />
            <span className={`field-hint ${pwTooShort ? 'field-hint-warn' : ''}`}>
              At least {MIN_PASSWORD} characters.
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="pw2">Confirm Password</label>
            <input
              id="pw2" type="password" value={form.confirm} onChange={set('confirm')}
              required autoComplete="new-password"
              className={mismatch ? 'input-invalid' : ''}
            />
            {mismatch && (
              <span className="field-hint field-hint-warn">Passwords do not match.</span>
            )}
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
            {loading ? 'Creating…' : 'Create Account'}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}