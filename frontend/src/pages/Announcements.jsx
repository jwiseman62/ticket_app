import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useConfirm } from '../context/ConfirmContext.jsx'
import * as api from '../api.js'
import EmptyState from '../components/EmptyState.jsx'
import { smartTime, fullTimestamp } from '../utils/dates.js'

const LEVELS = [
  { id: 'info',     label: 'Information', hint: 'General news — a new process, a reminder.' },
  { id: 'warning',  label: 'Heads-up',    hint: 'Planned disruption people should know about.' },
  { id: 'critical', label: 'Urgent',      hint: 'Something is broken right now.' },
]

const LEVEL_LABEL = Object.fromEntries(LEVELS.map((l) => [l.id, l.label]))
const BLANK = { title: '', body: '', level: 'info' }
const MAX_BODY = 4000

/**
 * Announcements: compose, and the history of what has been posted.
 *
 * One announcement is pinned to the dashboard at a time. Posting a new one
 * retires the previous automatically — the backend guarantees that, so this
 * page never has to reason about two being pinned at once.
 */
export default function Announcements() {
  const { user } = useAuth()
  const toast    = useToast()
  const confirm  = useConfirm()

  const canPost  = user.role !== 'Requester'
  const isAdmin  = user.role === 'Both'

  const [items,   setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [draft,   setDraft]   = useState(BLANK)
  const [busy,    setBusy]    = useState(false)
  const [editing, setEditing] = useState(null)   // id being edited, or null

  const load = useCallback(() => {
    setLoading(true)
    api.listAnnouncements()
      .then(setItems)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [toast])

  useEffect(() => { load() }, [load])

  const pinned  = items.find((a) => !a.retired_at) || null
  const history = items.filter((a) => a.retired_at)

  const valid = draft.body.trim().length > 0 && draft.body.length <= MAX_BODY

  function startEdit(a) {
    setEditing(a.id)
    setDraft({ title: a.title || '', body: a.body, level: a.level || 'info' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelEdit() {
    setEditing(null)
    setDraft(BLANK)
  }

  async function submit(e) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    try {
      if (editing) {
        await api.updateAnnouncement(editing, draft)
        toast.success('Announcement updated.')
      } else {
        await api.createAnnouncement(draft)
        toast.success('Posted. It’s on the dashboard now.')
      }
      setDraft(BLANK)
      setEditing(null)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRetire(a) {
    const ok = await confirm({
      title: 'Take this off the dashboard?',
      message: 'It stops showing to everyone, but stays here in the history.',
      confirmLabel: 'Take it down',
    })
    if (!ok) return
    try {
      await api.retireAnnouncement(a.id)
      toast.success('Taken down.')
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function handleDelete(a) {
    const ok = await confirm({
      title: 'Delete permanently?',
      message: `“${a.title || a.body.slice(0, 50)}” will be removed from the history.`,
      detail: 'This cannot be undone.',
      confirmLabel: 'Delete forever',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteAnnouncement(a.id)
      toast.success('Deleted.')
      load()
    } catch (err) {
      toast.error(err.message)
    }
  }

  function Card({ a, pinnedCard }) {
    return (
      <article className={`ann-card ann-${a.level || 'info'} ${pinnedCard ? 'pinned' : ''}`}>
        <div className="ann-card-head">
          <span className={`badge ann-badge ann-badge-${a.level || 'info'}`}>
            {LEVEL_LABEL[a.level] || 'Information'}
          </span>
          {pinnedCard && <span className="ann-pin">📌 On the dashboard</span>}
          <span className="ann-meta" title={fullTimestamp(a.created_at)}>
            {a.author} · {smartTime(a.created_at)}
            {a.updated_at && a.updated_at !== a.created_at && ' · edited'}
          </span>
        </div>

        {a.title && <h3 className="ann-card-title">{a.title}</h3>}
        <p className="ann-card-body">{a.body}</p>

        {canPost && (
          <div className="ann-card-actions">
            <button type="button" className="btn btn-secondary btn-sm"
                    onClick={() => startEdit(a)}>
              Edit
            </button>
            {pinnedCard && (
              <button type="button" className="btn btn-secondary btn-sm"
                      onClick={() => handleRetire(a)}>
                Take down
              </button>
            )}
            {isAdmin && (
              <button type="button" className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(a)}>
                Delete
              </button>
            )}
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="ann-page">
      <div className="admin-header">
        <div>
          <h1 className="home-title">Announcements</h1>
          <p className="home-subtitle">
            {canPost
              ? 'Post a notice to everyone with an account. The newest one sits at the top of the dashboard.'
              : 'Notices from the helpdesk. The current one also appears on your dashboard.'}
          </p>
        </div>
        <Link to="/dashboard" className="btn btn-secondary">← Dashboard</Link>
      </div>

      {/* ── Compose ── */}
      {canPost && (
        <form className="ann-compose" onSubmit={submit}>
          <h2 className="ann-compose-title">
            {editing ? 'Edit announcement' : 'New announcement'}
          </h2>
          {!editing && pinned && (
            <p className="ann-compose-note">
              Posting this replaces “{pinned.title || pinned.body.slice(0, 40)}”
              on the dashboard. The old one moves to the history below.
            </p>
          )}

          <div className="form-group">
            <label htmlFor="ann-title">Title <span className="ann-optional">(optional)</span></label>
            <input
              id="ann-title" type="text" value={draft.title} maxLength={120}
              placeholder="Email maintenance this Saturday"
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label htmlFor="ann-body">Message</label>
            <textarea
              id="ann-body" rows={5} value={draft.body} maxLength={MAX_BODY}
              placeholder="Mail will be unavailable Saturday 2–4am while we move servers. Tickets filed during that window will still reach us."
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <div className="ann-count">{draft.body.length} / {MAX_BODY}</div>
          </div>

          <div className="form-group">
            <label htmlFor="ann-level">Kind</label>
            <select
              id="ann-level" value={draft.level}
              onChange={(e) => setDraft({ ...draft, level: e.target.value })}
            >
              {LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
            <p className="ann-hint">
              {LEVELS.find((l) => l.id === draft.level)?.hint}
            </p>
          </div>

          <div className="ann-compose-actions">
            <button type="submit" className="btn btn-primary" disabled={!valid || busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Post to dashboard'}
            </button>
            {editing && (
              <button type="button" className="btn btn-secondary" onClick={cancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {/* ── Currently pinned ── */}
      <h2 className="ann-section">On the dashboard now</h2>
      {loading ? (
        <div className="ann-card skeleton-block" />
      ) : pinned ? (
        <Card a={pinned} pinnedCard />
      ) : (
        <EmptyState
          icon="📭"
          title="Nothing posted"
          body={canPost
            ? 'The dashboard has no announcement on it. Write one above.'
            : 'There are no announcements right now.'}
        />
      )}

      {/* ── History ── */}
      {history.length > 0 && (
        <>
          <h2 className="ann-section">Past announcements</h2>
          <div className="ann-history">
            {history.map((a) => <Card key={a.id} a={a} />)}
          </div>
        </>
      )}
    </div>
  )
}