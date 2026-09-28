import { useState, useEffect, useCallback } from 'react'
import * as api from '../api.js'
import { relativeTime, fullTimestamp } from '../utils/dates.js'
import { useConfirm } from '../context/ConfirmContext.jsx'

function initials(name) {
  return name.slice(0, 2).toUpperCase()
}

export default function Comments({ ticketId, currentUser }) {
  const confirm = useConfirm()
  const [comments, setComments] = useState([])
  const [draft,    setDraft]    = useState('')
  const [loading,  setLoading]  = useState(true)
  const [posting,  setPosting]  = useState(false)
  const [error,    setError]    = useState('')

  // useCallback so the effect below has a stable dependency instead of a
  // function identity that changes on every render.
  const load = useCallback(async () => {
    try {
      setComments(await api.listComments(ticketId))
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [ticketId])

  useEffect(() => { load() }, [load])

  async function handlePost(e) {
    e.preventDefault()
    if (!draft.trim()) return
    setPosting(true)
    setError('')
    try {
      const created = await api.addComment(ticketId, draft.trim())
      setComments((prev) => [...prev, created])
      setDraft('')
    } catch (err) {
      setError(err.message)
    } finally {
      setPosting(false)
    }
  }

  async function handleDelete(id) {
    const ok = await confirm({
      title: 'Delete this comment?',
      detail: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteComment(id)
      setComments((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError(err.message)
    }
  }

  const canDelete = (c) => c.author === currentUser.name || currentUser.role === 'Both'

  return (
    <div className="comments">
      {error && <div className="alert alert-error">{error}</div>}

      {loading ? (
        <div className="list-placeholder">Loading comments…</div>
      ) : comments.length === 0 ? (
        <div className="list-placeholder">
          No comments yet. Start the conversation below.
        </div>
      ) : (
        <div className="comment-list">
          {comments.map((c) => (
            <div key={c.id} className={`comment ${c.author === currentUser.name ? 'mine' : ''}`}>
              <div className="comment-avatar">{initials(c.author)}</div>
              <div className="comment-main">
                <div className="comment-meta">
                  <span className="comment-author">{c.author}</span>
                  {c.author_role && (
                    <span className="comment-role">{c.author_role}</span>
                  )}
                  <span className="comment-time" title={fullTimestamp(c.created_at)}>{relativeTime(c.created_at)}</span>
                  {canDelete(c) && (
                    <button
                      type="button"
                      className="comment-delete"
                      onClick={() => handleDelete(c.id)}
                      aria-label="Delete comment"
                    >
                      ✕
                    </button>
                  )}
                </div>
                <div className="comment-body">{c.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handlePost} className="comment-form">
        <textarea
          rows={3}
          placeholder="Add a comment…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handlePost(e)
          }}
        />
        <div className="comment-form-actions">
          <span className="comment-form-hint">⌘/Ctrl + Enter to post</span>
          <button type="submit" className="btn btn-primary btn-sm"
                  disabled={posting || !draft.trim()}>
            {posting ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      </form>
    </div>
  )
}