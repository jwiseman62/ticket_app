import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import * as api from '../api.js'

// ── Sub-components ────────────────────────────────────────────────── //

function StatCard({ label, value, color, note }) {
  return (
    <div className="stat-card" style={{ borderTopColor: color }}>
      <div className="stat-value" style={{ color }}>{value}</div>
      <div className="stat-label">{label}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}

function BarChart({ data, colorMap }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div className="bar-chart">
      {data.map(({ label, value }) => (
        <div key={label} className="bar-row">
          <span className="bar-label">{label}</span>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{
                width:      `${(value / max) * 100}%`,
                background: colorMap[label] ?? '#2563eb',
              }}
            />
          </div>
          <span className="bar-count">{value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────── //

function fmtId(id) { return `TKT-${String(id).padStart(3, '0')}` }

const STATUS_COLORS   = { Open: '#2563eb', 'In Progress': '#d97706', Closed: '#64748b' }
const PRIORITY_COLORS = { High: '#dc2626', Medium: '#d97706', Low: '#16a34a' }

// ── Page ─────────────────────────────────────────────────────────── //

export default function Home() {
  const { user }              = useAuth()
  const [stats,   setStats]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    api.getStats()
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="page-loading">Loading…</div>
  if (error)   return <div className="alert alert-error page-error">{error}</div>

  const statusData   = Object.entries(stats.by_status).map(([label, value]) => ({ label, value }))
  const priorityData = Object.entries(stats.by_priority).map(([label, value]) => ({ label, value }))

  return (
    <div className="home-page">

      {/* Header */}
      <div className="home-header">
        <div>
          <h1 className="home-title">Welcome back, {user.name}</h1>
          <p className="home-subtitle">Here's what's happening with your tickets today.</p>
        </div>
        <Link to="/tickets" className="btn btn-primary">＋ New Ticket</Link>
      </div>

      {/* Stat cards */}
      <div className="stat-cards">
        <StatCard
          label="Total"       value={stats.total}
          color="#2563eb"
        />
        <StatCard
          label="Open"        value={stats.by_status.Open}
          color="#2563eb"
        />
        <StatCard
          label="In Progress" value={stats.by_status['In Progress']}
          color="#d97706"
        />
        <StatCard
          label="Closed"      value={stats.by_status.Closed}
          color="#64748b"
        />
        <StatCard
          label="Overdue"     value={stats.overdue}
          color={stats.overdue > 0 ? '#dc2626' : '#16a34a'}
          note={stats.overdue > 0 ? 'needs attention' : 'all good ✓'}
        />
      </div>

      {/* Charts */}
      <div className="charts-row">
        <div className="chart-card">
          <h2 className="chart-title">By Status</h2>
          <BarChart data={statusData} colorMap={STATUS_COLORS} />
        </div>
        <div className="chart-card">
          <h2 className="chart-title">By Priority</h2>
          <BarChart data={priorityData} colorMap={PRIORITY_COLORS} />
        </div>
      </div>

      {/* Recent tickets */}
      <div className="recent-card">
        <div className="recent-header">
          <h2 className="chart-title">Recent Tickets</h2>
          <Link to="/tickets" className="btn btn-secondary btn-sm">View All →</Link>
        </div>

        {stats.recent.length === 0 ? (
          <p className="list-placeholder">
            No tickets yet. <Link to="/tickets">Create one.</Link>
          </p>
        ) : (
          <>
            {/* Desktop table */}
            <table className="recent-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Requester</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link to="/tickets" className="ticket-link">{fmtId(t.id)}</Link>
                    </td>
                    <td className="recent-title">{t.title}</td>
                    <td>
                      <span className={`badge badge-status-${t.status.replace(' ', '-').toLowerCase()}`}>
                        {t.status}
                      </span>
                    </td>
                    <td>
                      <span className={`badge badge-prio-${t.priority.toLowerCase()}`}>
                        {t.priority}
                      </span>
                    </td>
                    <td>{t.requester}</td>
                    <td className="text-muted">{t.updated_at?.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile cards */}
            <div className="recent-mobile">
              {stats.recent.map((t) => (
                <Link to="/tickets" key={t.id} className="recent-mobile-card">
                  <div className="recent-mobile-top">
                    <span className="ticket-id">{fmtId(t.id)}</span>
                    <span className={`badge badge-prio-${t.priority.toLowerCase()}`}>{t.priority}</span>
                    <span className={`badge badge-status-${t.status.replace(' ', '-').toLowerCase()}`}>{t.status}</span>
                  </div>
                  <div className="recent-mobile-title">{t.title}</div>
                  <div className="recent-mobile-meta">
                    {t.requester} · {t.updated_at?.slice(0, 10)}
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
