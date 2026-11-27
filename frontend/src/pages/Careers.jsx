import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import * as api from '../api.js'

/*
 * The careers board. Public: an applicant has no account yet, so nothing on
 * this page or the two below it requires a token.
 */

export default function Careers() {
  const [jobs,    setJobs]    = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    let cancelled = false
    api.listJobs()
      .then((rows) => { if (!cancelled) setJobs(rows) })
      .catch((err) => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="careers-page">
      <div className="careers-inner">
        <Link to="/" className="legal-back">← Back to home</Link>

        <header className="careers-head">
          <h1>Join the team</h1>
          <p className="careers-lede">
            We run the helpdesk for a few thousand people and we would rather
            fix causes than close tickets. If that sounds like your kind of
            work, these are the roles we are hiring for.
          </p>
        </header>

        <div className="careers-demo-note">
          <strong>This is a demonstration.</strong> These roles are not real and
          no hiring takes place. Please don't enter real personal information
          into the application form.
        </div>

        {loading ? (
          <p className="careers-empty">Loading open roles…</p>
        ) : error ? (
          <p className="careers-empty">
            Couldn't load the open roles. {error}
          </p>
        ) : jobs.length === 0 ? (
          <p className="careers-empty">
            Nothing open right now — do check back.
          </p>
        ) : (
          <ul className="job-list">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link to={`/careers/${job.slug}`} className="job-card">
                  <span className="job-card-top">
                    <strong className="job-card-title">{job.title}</strong>
                    {job.level && <span className="job-chip">{job.level}</span>}
                  </span>
                  <span className="job-card-summary">{job.summary}</span>
                  <span className="job-card-meta">
                    {[job.location, job.employment_type, job.salary_range]
                      .filter(Boolean).join(' · ')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}