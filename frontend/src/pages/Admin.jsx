import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import * as api from '../api.js'
import UserManagement from '../components/UserManagement.jsx'
import InviteManager  from '../components/InviteManager.jsx'

const TABS = [
  { id: 'users',   label: 'Users',        icon: '👥' },
  { id: 'invites', label: 'Access Codes', icon: '🎟' },
]

export default function Admin() {
  const { user } = useAuth()
  const [tab, setTab] = useState('users')

  // Small headline counts so the page says something at a glance
  const [counts, setCounts] = useState(null)

  useEffect(() => {
    Promise.all([api.listUsers(), api.listPendingRequests()])
      .then(([users, pending]) => setCounts({
        users:   users.length,
        techs:   users.filter((u) => u.role === 'Technician').length,
        admins:  users.filter((u) => u.role === 'Both').length,
        pending: pending.length,
      }))
      .catch(() => setCounts(null))
  }, [])

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h1 className="home-title">Administration</h1>
          <p className="home-subtitle">
            Manage accounts, roles, and technician access codes.
          </p>
        </div>
        <Link to="/tickets" className="btn btn-secondary">← Back to tickets</Link>
      </div>

      {counts && (
        <div className="admin-counts">
          <div className="admin-count">
            <span className="admin-count-value">{counts.users}</span>
            <span className="admin-count-label">Accounts</span>
          </div>
          <div className="admin-count">
            <span className="admin-count-value">{counts.techs}</span>
            <span className="admin-count-label">Technicians</span>
          </div>
          <div className="admin-count">
            <span className="admin-count-value">{counts.admins}</span>
            <span className="admin-count-label">Admins</span>
          </div>
          <div className={`admin-count ${counts.pending > 0 ? 'admin-count-alert' : ''}`}>
            <span className="admin-count-value">{counts.pending}</span>
            <span className="admin-count-label">Pending requests</span>
          </div>
        </div>
      )}

      <div className="tab-bar">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.icon} {t.label}
            {t.id === 'invites' && counts?.pending > 0 && (
              <span className="tab-badge">{counts.pending}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'users'   && <UserManagement currentUser={user} />}
      {tab === 'invites' && <InviteManager />}
    </div>
  )
}