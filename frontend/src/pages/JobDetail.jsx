import { useState, useEffect } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import * as api from '../api.js'

/*
 * One job posting, with the Apply button at the bottom.
 *
 * Responsibilities and requirements are stored as newline-separated text
 * rather than as JSON arrays — they are written by a person in a textarea,
 * and a blank line should not be able to break the page.
 */

/** Split a stored block into list items, discarding empty lines. */
function toLines(block) {
  return String(block || '')
    .split('\n')
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
}

export default function JobDetail() {
  const { slug }   = useParams()
  const navigate   = useNavigate()
  const [job,     setJob]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.getJob(slug)
      .then((row) => { if (!cancelled) setJob(row) })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [slug])

  if (loading) {
    return (
      <div className="careers-page"><div className="careers-inner">
        <p className="careers-empty">Loading…</p>
      </div></div>
    )
  }

  if (error || !job) {
    return (
      <div className="careers-page"><div className="careers-inner">
        <Link to="/careers" className="legal-back">← All open roles</Link>
        <h1 className="careers-head">This role isn't open</h1>
        <p className="careers-empty">
          It may have been filled or withdrawn since you saw it.
        </p>
      </div></div>
    )
  }

  const responsibilities = toLines(job.responsibilities)
  const requirements     = toLines(job.requirements)

  return (
    <div className="careers-page">
      <div className="careers-inner">
        <Link to="/careers" className="legal-back">← All open roles</Link>

        <header className="job-head">
          <h1>{job.title}</h1>
          <p className="job-head-meta">
            {[job.level, job.location, job.employment_type, job.salary_range]
              .filter(Boolean).join(' · ')}
          </p>
          {job.summary && <p className="job-head-summary">{job.summary}</p>}
        </header>

        {job.description && (
          <section className="job-section">
            <h2>About the role</h2>
            {job.description.split('\n\n').map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </section>
        )}

        {responsibilities.length > 0 && (
          <section className="job-section">
            <h2>What you'll do</h2>
            <ul>{responsibilities.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </section>
        )}

        {requirements.length > 0 && (
          <section className="job-section">
            <h2>What we're looking for</h2>
            <ul>{requirements.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </section>
        )}

        <section className="job-section">
          <h2>How hiring works here</h2>
          <p>
            Submit the application below and you'll get a reference by email.
            If you're offered the role, you'll receive an invite code — you
            register your own account with your own password, then enter that
            code to activate your access. We never create an account on your
            behalf or send you a password.
          </p>
        </section>

        <div className="job-apply-bar">
          <div className="job-apply-note">
            <strong>Demonstration only.</strong> No real hiring takes place and
            this form should not receive real personal information.
          </div>
          <button type="button" className="btn btn-primary btn-lg"
                  onClick={() => navigate(`/careers/${job.slug}/apply`)}>
            Apply for this role
          </button>
        </div>
      </div>
    </div>
  )
}