import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../api.js'

const ROLES = ['Requester', 'Technician', 'Both']

export default function Register() {
  const navigate = useNavigate()
  const [form,    setForm]    = useState({ name: '', password: '', confirm: '', role: 'Requester' })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const set = (field) => (e) => setForm((p) => ({ ...p, [field]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.password !== form.confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    try {
      await api.register(form.name, form.password, form.role)
      navigate('/login')
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

          <div className="form-group">
            <label htmlFor="name">Name</label>
            <input id="name" type="text" value={form.name} onChange={set('name')} required autoFocus />
          </div>

          <div className="form-group">
            <label htmlFor="role">Role</label>
            <select id="role" value={form.role} onChange={set('role')}>
              {ROLES.map((r) => <option key={r}>{r}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="pw">Password</label>
            <input id="pw" type="password" value={form.password} onChange={set('password')} required />
          </div>

          <div className="form-group">
            <label htmlFor="pw2">Confirm Password</label>
            <input id="pw2" type="password" value={form.confirm} onChange={set('confirm')} required />
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
