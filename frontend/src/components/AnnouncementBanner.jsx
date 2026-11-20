import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import * as api from '../api.js'
import { smartTime, fullTimestamp } from '../utils/dates.js'

const LEVEL_LABEL = {
  info:     'Information',
  warning:  'Heads-up',
  critical: 'Urgent',
}

/**
 * The pinned announcement, at the top of the dashboard.
 *
 * Renders nothing at all when there's no announcement — an empty box saying
 * "no announcements" would take up the most valuable space on the page to
 * say nothing. Technicians and admins get an Update button; everyone else
 * just reads it.
 */
export default function AnnouncementBanner() {
  const { user } = useAuth()
  const canPost  = user.role !== 'Requester'

  const [item,    setItem]    = useState(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let alive = true
    api.getCurrentAnnouncement()
      .then((a) => { if (alive) setItem(a) })
      // A failure here shouldn't break the dashboard, and an error box where
      // an announcement would go is worse than no announcement.
      .catch(() => {})
      .finally(() => { if (alive) setChecked(true) })
    return () => { alive = false }
  }, [])

  if (!checked) return null

  if (!item) {
    // Nothing pinned. Staff still get a quiet way in; requesters see nothing.
    return canPost ? (
      <div className="ann-banner-empty">
        <span>No announcement is showing on the dashboard.</span>
        <Link to="/announcements" className="btn btn-secondary btn-sm">
          Post one
        </Link>
      </div>
    ) : null
  }

  return (
    <section className={`ann-banner ann-${item.level || 'info'}`}>
      <div className="ann-banner-main">
        <div className="ann-banner-head">
          <span className={`badge ann-badge ann-badge-${item.level || 'info'}`}>
            {LEVEL_LABEL[item.level] || 'Information'}
          </span>
          <span className="ann-banner-meta" title={fullTimestamp(item.created_at)}>
            {item.author} · {smartTime(item.created_at)}
          </span>
        </div>
        {item.title && <h2 className="ann-banner-title">{item.title}</h2>}
        <p className="ann-banner-body">{item.body}</p>
      </div>

      {canPost && (
        <div className="ann-banner-actions">
          <Link to="/announcements" className="btn btn-secondary btn-sm">
            Update
          </Link>
        </div>
      )}
    </section>
  )
}