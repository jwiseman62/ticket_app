import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import * as api from '../api.js'
import { CATEGORIES, categoryIcon, categoryLabel } from '../config/surveys.js'

const BLANK_ARTICLE = { title: '', category: '', summary: '', body: '', keywords: '' }

export default function KnowledgeBase() {
  const { user } = useAuth()
  const isAdmin  = user.role === 'Both'

  const [articles, setArticles] = useState([])
  const [search,   setSearch]   = useState('')
  const [category, setCategory] = useState('All')
  const [openId,   setOpenId]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState('')

  const [editing, setEditing] = useState(null)   // null | 'new' | article id
  const [draft,   setDraft]   = useState(BLANK_ARTICLE)
  const [saving,  setSaving]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setArticles(await api.listArticles({ search, category }))
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [search, category])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  function startNew() {
    setDraft(BLANK_ARTICLE)
    setEditing('new')
    setOpenId(null)
  }

  function startEdit(a) {
    setDraft({
      title: a.title, category: a.category, summary: a.summary,
      body: a.body, keywords: a.keywords,
    })
    setEditing(a.id)
    setOpenId(null)
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!draft.title.trim()) { setError('Title is required.'); return }
    setSaving(true)
    setError('')
    try {
      if (editing === 'new') await api.createArticle(draft)
      else                   await api.updateArticle(editing, draft)
      setEditing(null)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(a) {
    if (!window.confirm(`Delete "${a.title}"?`)) return
    try {
      await api.deleteArticle(a.id)
      load()
    } catch (err) { setError(err.message) }
  }

  const setField = (f) => (e) => setDraft((p) => ({ ...p, [f]: e.target.value }))

  return (
    <div className="kb-page">
      <div className="kb-header">
        <div>
          <h1 className="home-title">Knowledge Base</h1>
          <p className="home-subtitle">
            Common fixes and troubleshooting guides. Try these before opening a ticket.
          </p>
        </div>
        {isAdmin && (
          <button className="btn btn-primary" onClick={startNew}>＋ New Article</button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Editor */}
      {editing !== null && (
        <form className="kb-editor" onSubmit={handleSave}>
          <h2 className="chart-title">
            {editing === 'new' ? 'New article' : 'Edit article'}
          </h2>

          <div className="form-group">
            <label htmlFor="a_title">Title *</label>
            <input id="a_title" type="text" value={draft.title} onChange={setField('title')} required />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="a_cat">Category</label>
              <select id="a_cat" value={draft.category} onChange={setField('category')}>
                <option value="">— None —</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="a_kw">Keywords</label>
              <input
                id="a_kw" type="text" value={draft.keywords} onChange={setField('keywords')}
                placeholder="comma, separated, search terms"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="a_sum">Summary</label>
            <input id="a_sum" type="text" value={draft.summary} onChange={setField('summary')} />
          </div>

          <div className="form-group">
            <label htmlFor="a_body">Body</label>
            <textarea id="a_body" rows={10} value={draft.body} onChange={setField('body')} />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Article'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="kb-filters">
        <input
          type="search" placeholder="Search articles…"
          value={search} onChange={(e) => setSearch(e.target.value)}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="All">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </div>

      {/* Article list */}
      {loading ? (
        <div className="list-placeholder">Loading…</div>
      ) : articles.length === 0 ? (
        <div className="list-placeholder">No articles match your search.</div>
      ) : (
        <div className="kb-list">
          {articles.map((a) => (
            <article key={a.id} className="kb-article">
              <button
                type="button"
                className="kb-article-head"
                onClick={() => setOpenId(openId === a.id ? null : a.id)}
              >
                <div className="kb-article-headline">
                  <span className="kb-article-title">{a.title}</span>
                  {a.category && (
                    <span className="kb-cat-chip">
                      {categoryIcon(a.category)} {categoryLabel(a.category)}
                    </span>
                  )}
                </div>
                <span className="kb-chevron">{openId === a.id ? '▾' : '▸'}</span>
              </button>

              {a.summary && <p className="kb-article-summary">{a.summary}</p>}

              {openId === a.id && (
                <div className="kb-article-body">
                  {a.body.split('\n').map((line, i) =>
                    line.trim() ? <p key={i}>{line}</p> : <br key={i} />)}

                  {isAdmin && (
                    <div className="kb-admin-actions">
                      <button className="btn btn-sm btn-secondary" onClick={() => startEdit(a)}>
                        Edit
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(a)}>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
