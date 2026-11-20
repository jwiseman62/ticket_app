import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useConfirm } from '../context/ConfirmContext.jsx'
import * as api from '../api.js'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonTicketList } from '../components/Skeleton.jsx'
import { CATEGORIES } from '../config/surveys.js'
import { formatDate, formatDateTime, smartTime, fullTimestamp } from '../utils/dates.js'
import { ticketRef } from '../utils/tickets.js'

/** Mirrors TRASH_RETENTION_DAYS in the backend. Display only. */
const RETENTION_DAYS = 30

const CATEGORY_LABEL = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.label])
)

function categoryLabel(id) {
  return CATEGORY_LABEL[id] || id || 'Uncategorised'
}

/** Local YYYY-MM-DD, n days before today — for the date-range presets. */
function daysAgoISO(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const RANGE_PRESETS = [
  { id: 'all',  label: 'All time',   from: () => '' },
  { id: '30',   label: 'Last 30 days', from: () => daysAgoISO(30) },
  { id: '90',   label: 'Last 90 days', from: () => daysAgoISO(90) },
  { id: '365',  label: 'Last year',  from: () => daysAgoISO(365) },
]

/**
 * How long a trashed ticket has left before it is removed for good.
 * Returns null when the date can't be read, so the caller can stay quiet
 * rather than printing "NaN days left".
 */
function retentionLeft(deletedAt) {
  if (!deletedAt) return null
  const d = new Date(deletedAt)
  if (Number.isNaN(d.getTime())) return null
  const expires = d.getTime() + RETENTION_DAYS * 86400000
  const days = Math.ceil((expires - Date.now()) / 86400000)
  return days < 0 ? 0 : days
}

export default function Archive() {
  const { user }  = useAuth()
  const toast     = useToast()
  const confirm   = useConfirm()

  const isTech  = user.role === 'Technician' || user.role === 'Both'
  const isAdmin = user.role === 'Both'

  const [tab, setTab] = useState('closed')

  // ── Archive (closed tickets) ──
  const [closed,   setClosed]   = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [category, setCategory] = useState('All')
  const [range,    setRange]    = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')

  // ── Trash ──
  const [trash,      setTrash]      = useState([])
  const [trashBusy,  setTrashBusy]  = useState(false)
  const [workingId,  setWorkingId]  = useState(null)

  const [expanded, setExpanded] = useState(null)

  // A preset and a hand-picked date are the same filter, so choosing one
  // clears the other rather than silently losing to it on the server.
  const effectiveFrom = range === 'all'
    ? dateFrom
    : (RANGE_PRESETS.find((p) => p.id === range)?.from() || '')

  const loadArchive = useCallback(() => {
    setLoading(true)
    const params = {}
    if (search.trim())      params.search    = search.trim()
    if (category !== 'All') params.category  = category
    if (effectiveFrom)      params.date_from = effectiveFrom
    if (dateTo)             params.date_to   = dateTo

    api.listArchive(params)
      .then(setClosed)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [search, category, effectiveFrom, dateTo, toast])

  const loadTrash = useCallback(() => {
    if (!isTech) return
    setTrashBusy(true)
    api.listTrash()
      .then(setTrash)
      .catch((err) => toast.error(err.message))
      .finally(() => setTrashBusy(false))
  }, [isTech, toast])

  // Typing in the search box shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(loadArchive, 250)
    return () => clearTimeout(timer)
  }, [loadArchive])

  useEffect(() => { loadTrash() }, [loadTrash])

  async function handleRestore(ticket) {
    setWorkingId(ticket.id)
    try {
      await api.restoreTicket(ticket.id)
      setTrash((list) => list.filter((t) => t.id !== ticket.id))
      toast.success(`${ticketRef(ticket)} restored`)
      loadArchive()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setWorkingId(null)
    }
  }

  async function handlePermanentDelete(ticket) {
    const ok = await confirm({
      title: 'Delete permanently?',
      message: `“${ticket.title}” will be removed along with its comments and attachments.`,
      detail: 'This cannot be undone.',
      confirmLabel: 'Delete forever',
      danger: true,
    })
    if (!ok) return

    setWorkingId(ticket.id)
    try {
      await api.deleteTicketPermanently(ticket.id)
      setTrash((list) => list.filter((t) => t.id !== ticket.id))
      toast.success(`${ticketRef(ticket)} deleted permanently`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setWorkingId(null)
    }
  }

  async function handleEmptyTrash() {
    const expired = trash.filter((t) => retentionLeft(t.deleted_at) === 0).length
    const ok = await confirm({
      title: `Remove ${expired} expired ticket${expired === 1 ? '' : 's'}?`,
      message: expired === 0
        ? 'Nothing in the trash has passed its retention window yet.'
        : `Tickets deleted more than ${RETENTION_DAYS} days ago will be removed for good.`,
      detail: expired === 0 ? '' : 'This cannot be undone.',
      confirmLabel: 'Remove them',
      danger: true,
    })
    if (!ok) return

    try {
      const res = await api.purgeDeletedTickets()
      toast.success(res.purged === 0
        ? 'Nothing had expired yet'
        : `Removed ${res.purged} expired ticket${res.purged === 1 ? '' : 's'}`)
      loadTrash()
    } catch (err) {
      toast.error(err.message)
    }
  }

  function resetFilters() {
    setSearch(''); setCategory('All'); setRange('all')
    setDateFrom(''); setDateTo('')
  }

  const filtersActive = Boolean(
    search.trim() || category !== 'All' || range !== 'all' || dateFrom || dateTo
  )

  // A count per category, so the filter tells you where the history is
  // before you pick one.
  const byCategory = useMemo(() => {
    const counts = {}
    for (const t of closed) {
      const key = t.category || 'other'
      counts[key] = (counts[key] || 0) + 1
    }
    return counts
  }, [closed])

  const expiringSoon = trash.filter((t) => {
    const left = retentionLeft(t.deleted_at)
    return left !== null && left <= 7
  }).length

  return (
    <div className="archive-page">
      <div className="admin-header">
        <div>
          <h1 className="home-title">Archive</h1>
          <p className="home-subtitle">
            Resolved tickets stay here for good, so you can look up how
            something was fixed last time. Deleted ones wait{' '}
            {RETENTION_DAYS} days before they go.
          </p>
        </div>
        <Link to="/tickets" className="btn btn-secondary">← Back to tickets</Link>
      </div>

      <div className="tab-bar">
        <button
          type="button"
          className={`tab ${tab === 'closed' ? 'active' : ''}`}
          onClick={() => setTab('closed')}
        >
          📁 Resolved
          {closed.length > 0 && (
            <span className="tab-badge tab-badge-neutral">{closed.length}</span>
          )}
        </button>
        {isTech && (
          <button
            type="button"
            className={`tab ${tab === 'trash' ? 'active' : ''}`}
            onClick={() => setTab('trash')}
          >
            🗑 Trash
            {trash.length > 0 && (
              <span className={`tab-badge ${expiringSoon > 0 ? '' : 'tab-badge-neutral'}`}>
                {trash.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* ── Resolved tickets ── */}
      {tab === 'closed' && (
        <>
          <div className="archive-filters">
            <input
              className="archive-search"
              type="search"
              placeholder="Search titles, descriptions, people…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <div className="archive-filter-row">
              <label className="archive-field">
                <span>Category</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  <option value="All">All categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}{byCategory[c.id] ? ` (${byCategory[c.id]})` : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="archive-field">
                <span>Closed within</span>
                <select
                  value={range}
                  onChange={(e) => {
                    setRange(e.target.value)
                    if (e.target.value !== 'all') { setDateFrom(''); setDateTo('') }
                  }}
                >
                  {RANGE_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </label>

              <label className="archive-field">
                <span>From</span>
                <input
                  type="date" value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setRange('all') }}
                />
              </label>

              <label className="archive-field">
                <span>To</span>
                <input
                  type="date" value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setRange('all') }}
                />
              </label>

              {filtersActive && (
                <button type="button" className="btn btn-ghost btn-sm archive-clear"
                        onClick={resetFilters}>
                  Clear filters
                </button>
              )}
            </div>
          </div>

          <div className="archive-summary">
            {loading
              ? 'Searching…'
              : `${closed.length} resolved ticket${closed.length === 1 ? '' : 's'}`}
          </div>

          {loading ? (
            <SkeletonTicketList count={5} />
          ) : closed.length === 0 ? (
            <EmptyState
              icon="📁"
              title={filtersActive ? 'Nothing matches those filters' : 'Nothing archived yet'}
              body={filtersActive
                ? 'Try a wider date range or a different category.'
                : 'Tickets appear here once they are closed. Nothing has been closed yet.'}
              action={filtersActive && (
                <button className="btn btn-secondary" onClick={resetFilters}>
                  Clear filters
                </button>
              )}
            />
          ) : (
            <ul className="archive-list">
              {closed.map((t) => {
                const open = expanded === t.id
                return (
                  <li key={t.id} className={`archive-item ${open ? 'expanded' : ''}`}>
                    <button
                      type="button"
                      className="archive-item-head"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : t.id)}
                    >
                      <span className="archive-item-main">
                        <span className="archive-item-title">{t.title}</span>
                        <span className="archive-item-meta">
                          <span className="ticket-id">{ticketRef(t)}</span>
                          <span className="badge badge-category">{categoryLabel(t.category)}</span>
                          <span title={fullTimestamp(t.closed_at || t.updated_at)}>
                            closed {formatDate(t.closed_at || t.updated_at)}
                          </span>
                          {t.technician && <span>👤 {t.technician}</span>}
                        </span>
                      </span>
                      <span className="archive-item-chevron" aria-hidden="true">
                        {open ? '▾' : '▸'}
                      </span>
                    </button>

                    {open && (
                      <div className="archive-item-body">
                        <p className="archive-item-description">{t.description}</p>
                        <dl className="archive-item-facts">
                          <div><dt>Requested by</dt><dd>{t.requester || '—'}</dd></div>
                          <div><dt>Resolved by</dt><dd>{t.technician || '—'}</dd></div>
                          <div><dt>Priority</dt><dd>{t.priority}</dd></div>
                          <div>
                            <dt>Opened</dt>
                            <dd title={fullTimestamp(t.created_at)}>{formatDate(t.created_at)}</dd>
                          </div>
                          <div>
                            <dt>Closed</dt>
                            <dd title={fullTimestamp(t.closed_at)}>
                              {t.closed_at ? formatDateTime(t.closed_at) : 'unknown'}
                            </dd>
                          </div>
                        </dl>
                        <Link to={`/tickets/${t.id}`} className="btn btn-secondary btn-sm">
                          Open full ticket →
                        </Link>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {/* ── Trash ── */}
      {tab === 'trash' && isTech && (
        <>
          <div className="archive-summary archive-summary-split">
            <span>
              {trashBusy
                ? 'Loading…'
                : `${trash.length} ticket${trash.length === 1 ? '' : 's'} in the trash`}
              {expiringSoon > 0 && (
                <span className="archive-warning"> · {expiringSoon} expiring within a week</span>
              )}
            </span>
            {isAdmin && trash.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm"
                      onClick={handleEmptyTrash}>
                Remove expired
              </button>
            )}
          </div>

          {trashBusy ? (
            <SkeletonTicketList count={3} />
          ) : trash.length === 0 ? (
            <EmptyState
              icon="🗑"
              title="The trash is empty"
              body={`Deleted tickets wait here for ${RETENTION_DAYS} days, so a ` +
                    'mistaken delete can always be undone.'}
            />
          ) : (
            <ul className="trash-list">
              {trash.map((t) => {
                const left = retentionLeft(t.deleted_at)
                const urgent = left !== null && left <= 7
                return (
                  <li key={t.id} className={`trash-item ${urgent ? 'urgent' : ''}`}>
                    <div className="trash-item-main">
                      <div className="trash-item-title">{t.title}</div>
                      <div className="archive-item-meta">
                        <span className="ticket-id">{ticketRef(t)}</span>
                        <span className="badge badge-category">{categoryLabel(t.category)}</span>
                        <span title={fullTimestamp(t.deleted_at)}>
                          deleted {smartTime(t.deleted_at)}
                        </span>
                        {t.deleted_by && <span>by {t.deleted_by}</span>}
                      </div>
                      {left !== null && (
                        <div className={`trash-countdown ${urgent ? 'urgent' : ''}`}>
                          {left === 0
                            ? 'Due to be removed'
                            : `${left} day${left === 1 ? '' : 's'} left before it is removed`}
                        </div>
                      )}
                    </div>

                    <div className="trash-item-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={workingId === t.id}
                        onClick={() => handleRestore(t)}
                      >
                        {workingId === t.id ? 'Working…' : '↩ Restore'}
                      </button>
                      {isAdmin && (
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          disabled={workingId === t.id}
                          onClick={() => handlePermanentDelete(t)}
                        >
                          Delete forever
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}