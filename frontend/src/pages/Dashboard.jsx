import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import * as api from '../api.js'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonTicketList } from '../components/Skeleton.jsx'
import { smartTime, isOverdue, dueLabel, fullTimestamp } from '../utils/dates.js'

const STATUS_OPTIONS   = ['Open', 'In Progress', 'Closed']
const PRIORITY_OPTIONS = ['Low', 'Medium', 'High']
const PRANK = { High: 0, Medium: 1, Low: 2 }
const SRANK = { Open: 0, 'In Progress': 1, Closed: 2 }

const SEEN_KEY = 'ticketsLastSeen'

function fmtId(id) { return `TKT-${String(id).padStart(3, '0')}` }

function prioClass(t) {
  if (isOverdue(t))          return 'overdue'
  if (t.priority === 'High') return 'prio-high'
  if (t.priority === 'Low')  return 'prio-low'
  return 'prio-medium'
}

function sortList(list, key, asc) {
  return [...list].sort((a, b) => {
    let av, bv
    if      (key === 'id')        { av = a.id;                      bv = b.id }
    else if (key === 'status')    { av = SRANK[a.status] ?? 9;       bv = SRANK[b.status] ?? 9 }
    else if (key === 'priority')  { av = PRANK[a.priority] ?? 9;     bv = PRANK[b.priority] ?? 9 }
    else if (key === 'due_date')  { av = a.due_date || '9999';       bv = b.due_date || '9999' }
    else if (key === 'stale')     { av = a.updated_at || '';         bv = b.updated_at || '' }
    else                          { av = a[key];                     bv = b[key] }
    if (av < bv) return asc ? -1 : 1
    if (av > bv) return asc ? 1 : -1
    return 0
  })
}

/** Track which tickets changed since the user last opened them (local only). */
function loadSeen() {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {} }
  catch { return {} }
}
function markSeen(id, updatedAt) {
  try {
    const seen = loadSeen()
    seen[id] = updatedAt
    localStorage.setItem(SEEN_KEY, JSON.stringify(seen))
  } catch { /* private browsing */ }
}

/**
 * The ticket list.
 *
 * Creating a ticket lives at /new and opening one at /tickets/:id, so this
 * page does one thing: find the ticket you're after. That's what earns it the
 * full width — the list used to be squeezed into a 310px sidebar because a
 * blank creation form sat permanently beside it.
 */
export default function Dashboard() {
  const { user } = useAuth()
  const toast    = useToast()
  const navigate = useNavigate()

  const defaultView = user.role === 'Requester'  ? 'My Tickets'
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
  const [loading,  setLoading]  = useState(true)
  const [claiming, setClaiming] = useState(null)
  const [seen,     setSeen]     = useState(loadSeen)

  const isTech = user.role !== 'Requester'

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    try {
      const [all, filtered] = await Promise.all([
        api.listTickets(),
        api.listTickets({
          search, status_filter: statusFilter,
          priority_filter: priorityFilter, view,
        }),
      ])
      setTotal(all.length)
      setTickets(sortList(filtered, sortKey, sortAsc))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [search, statusFilter, priorityFilter, view, sortKey, sortAsc, toast])

  useEffect(() => { fetchTickets() }, [fetchTickets])

  function handleSort(key) {
    const nextAsc = key === sortKey ? !sortAsc : key !== 'stale'
    setSortKey(key)
    setSortAsc(nextAsc)
    setTickets((prev) => sortList(prev, key, nextAsc))
  }

  function arrow(key) { return sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : '' }

  function openTicket(t) {
    markSeen(t.id, t.updated_at)
    setSeen((prev) => ({ ...prev, [t.id]: t.updated_at }))
    navigate(`/tickets/${t.id}`)
  }

  async function handleClaim(e, t) {
    e.stopPropagation()
    setClaiming(t.id)
    try {
      const updated = await api.claimTicket(t.id)
      toast.success(`${fmtId(t.id)} is yours — moved to In Progress.`)
      setTickets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      fetchTickets()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setClaiming(null)
    }
  }

  async function handleQuickStatus(e, t, status) {
    e.stopPropagation()
    try {
      const updated = await api.setTicketStatus(t.id, status)
      setTickets((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      toast.success(`${fmtId(t.id)} → ${status}`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function handleExport() {
    try {
      await api.exportCsv({
        search, status_filter: statusFilter,
        priority_filter: priorityFilter, view,
      })
      toast.success('Export downloaded.')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const viewOptions =
    user.role === 'Requester'  ? ['My Tickets', 'All Tickets'] :
    user.role === 'Technician' ? ['Assigned To Me', 'Unassigned', 'All Tickets'] :
                                  ['All Tickets', 'Unassigned', 'My Tickets', 'Assigned To Me']

  const filtersActive =
    search.trim() !== '' || statusFilter !== 'All' || priorityFilter !== 'All'

  function clearFilters() {
    setSearch(''); setStatusFilter('All'); setPriorityFilter('All')
  }

  /** Empty state depends on WHY the list is empty. */
  function renderEmpty() {
    if (filtersActive) {
      return (
        <EmptyState
          icon="🔍" title="Nothing matches those filters"
          body="Try a different search term, or clear the filters to see everything."
          action={
            <button className="btn btn-secondary" onClick={clearFilters}>
              Clear filters
            </button>
          }
        />
      )
    }
    if (view === 'Unassigned') {
      return (
        <EmptyState
          icon="🎉" title="Nothing waiting"
          body="Every ticket has someone on it. Nice work."
        />
      )
    }
    if (view === 'Assigned To Me') {
      return (
        <EmptyState
          icon="☕" title="Nothing assigned to you"
          body="Check the Unassigned queue to pick something up."
          action={
            <button className="btn btn-secondary"
                    onClick={() => setView('Unassigned')}>
              View unassigned
            </button>
          }
        />
      )
    }
    if (view === 'My Tickets') {
      return (
        <EmptyState
          icon="📭" title="You haven't filed any tickets"
          body="When something breaks, start here and we'll walk you through it."
          action={<Link to="/new" className="btn btn-primary">Get help</Link>}
        />
      )
    }
    return (
      <EmptyState
        icon="📋" title="No tickets yet"
        body="Once people start filing tickets, they'll show up here."
        action={<Link to="/new" className="btn btn-primary">File the first one</Link>}
      />
    )
  }

  return (
    <div className="tickets-page">
      <div className="admin-header">
        <div>
          <h1 className="home-title">Tickets</h1>
          <p className="home-subtitle">
            Signed in as {user.name} ({user.role})
          </p>
        </div>
        <Link to="/new" className="btn btn-primary">＋ New Ticket</Link>
      </div>

      {/* ── Filters ── */}
      <div className="tl-filters">
        <input
          className="tl-search" type="search"
          placeholder="Search titles, descriptions, people…"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <div className="tl-filter-row">
          <label className="tl-field">
            <span>Show</span>
            <select value={view} onChange={(e) => setView(e.target.value)}>
              {viewOptions.map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
          <label className="tl-field">
            <span>Status</span>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="All">All statuses</option>
              {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className="tl-field">
            <span>Priority</span>
            <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
              <option value="All">All priorities</option>
              {PRIORITY_OPTIONS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </label>
          {filtersActive && (
            <button type="button" className="btn btn-ghost btn-sm tl-clear"
                    onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── Count, sort, export ── */}
      <div className="tl-toolbar">
        <span className="tl-count">
          {loading ? 'Loading…' : <>Showing <strong>{tickets.length}</strong> of {total}</>}
        </span>
        <div className="tl-toolbar-right">
          <div className="sort-controls">
            {[['id','ID'],['priority','Pri'],['due_date','Due'],['stale','Oldest']]
              .map(([k,l]) => (
                <button
                  key={k} className={`sort-btn${sortKey===k?' active':''}`}
                  onClick={() => handleSort(k)}
                  title={k === 'stale' ? 'Longest without an update' : undefined}
                >{l}{arrow(k)}</button>
              ))}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={fetchTickets}>↺</button>
          <button className="btn btn-secondary btn-sm" onClick={handleExport}>↓ CSV</button>
        </div>
      </div>

      {/* ── List ── */}
      {loading ? (
        <SkeletonTicketList count={6} />
      ) : tickets.length === 0 ? (
        renderEmpty()
      ) : (
        <ul className="tl-list">
          {tickets.map((t) => {
            const unclaimed = !(t.technician || '').trim()
            const changed   = seen[t.id] && seen[t.id] !== t.updated_at
            return (
              <li
                key={t.id}
                className={`tl-row ${prioClass(t)}`}
                onClick={() => openTicket(t)}
              >
                <div className="tl-row-main">
                  <div className="tl-row-top">
                    <span className="ticket-id">{fmtId(t.id)}</span>
                    {changed && <span className="unread-dot" title="Updated since you last looked" />}
                    <span className={`badge badge-prio-${t.priority.toLowerCase()}`}>{t.priority}</span>
                    <span className={`badge badge-status-${t.status.replace(' ','-').toLowerCase()}`}>
                      {t.status}
                    </span>
                  </div>

                  {/* A real link, so the row can be opened in a new tab and
                      reached by keyboard. The row's onClick is a convenience
                      on top of it, not the only way in. */}
                  <Link
                    to={`/tickets/${t.id}`}
                    className="tl-row-title"
                    onClick={(e) => { e.stopPropagation(); markSeen(t.id, t.updated_at) }}
                  >
                    {t.title}
                  </Link>

                  <div className="tl-row-meta">
                    <span title={fullTimestamp(t.updated_at)}>{smartTime(t.updated_at)}</span>
                    {t.technician
                      ? <span>👤 {t.technician}</span>
                      : <span className="meta-unassigned">unassigned</span>}
                    {t.due_date && (
                      <span className={isOverdue(t) ? 'meta-overdue' : ''}>
                        📅 {dueLabel(t.due_date)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick actions — technicians only */}
                {isTech && (
                  <div className="tl-row-actions">
                    {unclaimed && (
                      <button
                        className="quick-btn quick-btn-claim"
                        disabled={claiming === t.id}
                        onClick={(e) => handleClaim(e, t)}
                      >
                        {claiming === t.id ? 'Claiming…' : '✋ Claim'}
                      </button>
                    )}
                    {t.status !== 'In Progress' && t.status !== 'Closed' && (
                      <button className="quick-btn"
                              onClick={(e) => handleQuickStatus(e, t, 'In Progress')}>
                        ▶ Start
                      </button>
                    )}
                    {t.status !== 'Closed' && (
                      <button className="quick-btn"
                              onClick={(e) => handleQuickStatus(e, t, 'Closed')}>
                        ✓ Close
                      </button>
                    )}
                    {t.status === 'Closed' && (
                      <button className="quick-btn"
                              onClick={(e) => handleQuickStatus(e, t, 'Open')}>
                        ↺ Reopen
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Closed tickets drop off this list after 24 hours. Saying where they
          went beats leaving someone to wonder if they were lost. */}
      <Link to="/archive" className="list-archive-hint">
        🗂 Looking for an older resolved ticket? It's in the Archive →
      </Link>
    </div>
  )
}