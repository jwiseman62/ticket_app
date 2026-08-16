import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import * as api from '../api.js'
import TicketForm      from '../components/TicketForm.jsx'
import UserManagement  from '../components/UserManagement.jsx'

const STATUS_OPTIONS   = ['Open', 'In Progress', 'Closed']
const PRIORITY_OPTIONS = ['Low', 'Medium', 'High']
const PRANK = { High: 0, Medium: 1, Low: 2 }
const SRANK = { Open: 0, 'In Progress': 1, Closed: 2 }

function fmtId(id) { return `TKT-${String(id).padStart(3, '0')}` }

function isOverdue(t) {
  if (!t.due_date || t.status === 'Closed') return false
  return t.due_date < new Date().toISOString().slice(0, 10)
}

function prioClass(t) {
  if (isOverdue(t))          return 'overdue'
  if (t.priority === 'High') return 'prio-high'
  if (t.priority === 'Low')  return 'prio-low'
  return 'prio-medium'
}

function sortList(list, key, asc) {
  return [...list].sort((a, b) => {
    let av, bv
    if      (key === 'id')         { av = a.id;                       bv = b.id }
    else if (key === 'title')      { av = a.title.toLowerCase();       bv = b.title.toLowerCase() }
    else if (key === 'status')     { av = SRANK[a.status] ?? 9;        bv = SRANK[b.status] ?? 9 }
    else if (key === 'priority')   { av = PRANK[a.priority] ?? 9;      bv = PRANK[b.priority] ?? 9 }
    else if (key === 'technician') { av = a.technician.toLowerCase();  bv = b.technician.toLowerCase() }
    else if (key === 'due_date')   { av = a.due_date || '9999';        bv = b.due_date || '9999' }
    else                           { av = a[key];                      bv = b[key] }
    if (av < bv) return asc ? -1 : 1
    if (av > bv) return asc ? 1 : -1
    return 0
  })
}

export default function Dashboard() {
  const { user } = useAuth()

  const defaultView = user.role === 'Requester' ? 'My Tickets'
                    : user.role === 'Technician' ? 'Assigned To Me'
                    : 'All Tickets'

  const [search,         setSearch]         = useState('')
  const [statusFilter,   setStatusFilter]   = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')
  const [view,           setView]           = useState(defaultView)
  const [sortKey,        setSortKey]        = useState('id')
  const [sortAsc,        setSortAsc]        = useState(true)

  const [tickets,  setTickets]  = useState([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(false)
  const [fetchErr, setFetchErr] = useState('')

  const [selectedId,   setSelectedId]   = useState(null)
  const [showUserMgmt, setShowUserMgmt] = useState(false)

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    setFetchErr('')
    try {
      const [all, filtered] = await Promise.all([
        api.listTickets(),
        api.listTickets({ search, status_filter: statusFilter, priority_filter: priorityFilter, view }),
      ])
      setTotal(all.length)
      setTickets(sortList(filtered, sortKey, sortAsc))
    } catch (err) {
      setFetchErr(err.message)
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, priorityFilter, view, sortKey, sortAsc])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  function handleSort(key) {
    const nextAsc = key === sortKey ? !sortAsc : true
    setSortKey(key)
    setSortAsc(nextAsc)
    setTickets((prev) => sortList(prev, key, nextAsc))
  }

  function arrow(key) { return sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '' }

  async function handleExport() {
    try {
      await api.exportCsv({ search, status_filter: statusFilter, priority_filter: priorityFilter, view })
    } catch (err) { alert(err.message) }
  }

  const viewOptions =
    user.role === 'Requester'  ? ['My Tickets', 'All Tickets'] :
    user.role === 'Technician' ? ['Assigned To Me', 'All Tickets'] :
                                  ['All Tickets', 'My Tickets', 'Assigned To Me']

  return (
    <div className="dashboard">

      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-heading">Tickets</div>
          <div className="user-badge">{user.name} <em>({user.role})</em></div>
        </div>

        {/* Filters */}
        <div className="filter-bar">
          <input
            className="filter-input" type="search" placeholder="Search titles, people…"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <div className="filter-row">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All Status</option>
              {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="All">All Priority</option>
              {PRIORITY_OPTIONS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <select value={view} onChange={(e) => setView(e.target.value)}>
            {viewOptions.map((v) => <option key={v}>{v}</option>)}
          </select>
        </div>

        {/* List header with sort */}
        <div className="ticket-list-header">
          <span>Showing <span className="ticket-count">{tickets.length}/{total}</span></span>
          <div className="sort-controls">
            {[['id','ID'],['priority','Pri'],['status','Status'],['due_date','Due']].map(([k,l]) => (
              <button key={k} className={`sort-btn${sortKey===k?' active':''}`} onClick={() => handleSort(k)}>
                {l}{arrow(k)}
              </button>
            ))}
          </div>
        </div>

        {fetchErr && <div className="alert alert-error" style={{margin:'0.5rem'}}>{fetchErr}</div>}

        <div className="ticket-list">
          {loading && <div className="list-placeholder">Loading…</div>}
          {!loading && tickets.length === 0 && <div className="list-placeholder">No tickets found.</div>}
          {!loading && tickets.map((t) => (
            <div
              key={t.id}
              className={`ticket-row ${selectedId === t.id ? 'selected' : ''} ${prioClass(t)}`}
              onClick={() => setSelectedId(t.id)}
            >
              <div className="ticket-row-top">
                <span className="ticket-id">{fmtId(t.id)}</span>
                <span className={`badge badge-prio-${t.priority.toLowerCase()}`}>{t.priority}</span>
                <span className={`badge badge-status-${t.status.replace(' ','-').toLowerCase()}`}>{t.status}</span>
              </div>
              <div className="ticket-title">{t.title}</div>
              {(t.technician || t.due_date) && (
                <div className="ticket-meta">
                  {t.technician && <span>👤 {t.technician}</span>}
                  {t.due_date   && <span>📅 {t.due_date}{isOverdue(t) ? ' ⚠' : ''}</span>}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="sidebar-actions">
          <button className="btn btn-primary"   onClick={() => setSelectedId(null)}>＋ New Ticket</button>
          <button className="btn btn-secondary" onClick={fetchTickets}>↺ Refresh</button>
          <button className="btn btn-secondary" onClick={handleExport}>↓ Export CSV</button>
          {user.role === 'Both' && (
            <button className="btn btn-secondary" onClick={() => setShowUserMgmt(true)}>⚙ Manage Users</button>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <main className="main-content">
        <TicketForm
          key={selectedId ?? 'new'}
          ticketId={selectedId}
          currentUser={user}
          onSaved={(id) => { setSelectedId(id); fetchTickets() }}
          onDeleted={() => { setSelectedId(null); fetchTickets() }}
        />
      </main>

      {showUserMgmt && (
        <UserManagement onClose={() => setShowUserMgmt(false)} currentUser={user} />
      )}
    </div>
  )
}
