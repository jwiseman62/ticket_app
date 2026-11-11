import { useState, useEffect } from 'react'
import * as api from '../api.js'

/**
 * Suggests knowledge base articles matching the current category and text.
 * Debounced so it doesn't fire on every keystroke.
 */
export default function ArticleSuggestions({ category, text }) {
  const [articles, setArticles] = useState([])
  const [openId,   setOpenId]   = useState(null)
  const [full,     setFull]     = useState(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (!category || dismissed) { setArticles([]); return }

    const timer = setTimeout(() => {
      api.suggestArticles({ category, text: text.slice(0, 500), limit: 3 })
        .then(setArticles)
        .catch(() => setArticles([]))
    }, 600)

    return () => clearTimeout(timer)
  }, [category, text, dismissed])

  async function toggle(id) {
    if (openId === id) { setOpenId(null); setFull(null); return }
    setOpenId(id)
    setFull(null)
    try {
      setFull(await api.getArticle(id))
    } catch {
      setFull(null)
    }
  }

  if (dismissed || articles.length === 0) return null

  return (
    <div className="article-suggestions">
      <div className="article-suggestions-header">
        <span className="article-suggestions-title">
          💡 This might already be solved
        </span>
        <button type="button" className="btn btn-sm btn-ghost"
                onClick={() => setDismissed(true)}>
          Dismiss
        </button>
      </div>

      <div className="article-suggestions-list">
        {articles.map((a) => (
          <div key={a.id} className="article-suggestion">
            <button type="button" className="article-suggestion-head" onClick={() => toggle(a.id)}>
              <span className="article-suggestion-title">{a.title}</span>
              <span className="article-suggestion-chevron">{openId === a.id ? '▾' : '▸'}</span>
            </button>
            {a.summary && <p className="article-suggestion-summary">{a.summary}</p>}

            {openId === a.id && (
              <div className="article-suggestion-body">
                {full
                  ? full.body.split('\n').map((line, i) =>
                      line.trim() ? <p key={i}>{line}</p> : <br key={i} />)
                  : <span className="text-muted">Loading…</span>}
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="article-suggestions-footer">
        Still stuck? Carry on and submit the ticket below.
      </p>
    </div>
  )
}
