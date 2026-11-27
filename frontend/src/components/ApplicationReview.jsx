import { useState, useEffect, useCallback } from 'react'
import * as api from '../api.js'
import { useToast } from '../context/ToastContext.jsx'
import { useConfirm } from '../context/ConfirmContext.jsx'
import { formatDate } from '../utils/dates.js'

/**
 * Reviewing job applications, and hiring.
 *
 * Note what this screen cannot show: the voluntary self-identification data
 * is in a separate table and absent from the schema this fetches, so there
 * is no field to render and no way to render it by accident.
 *
 * Hiring does not create an account. It issues a single-use invite code for
 * the role the posting advertises; the applicant registers themselves and
 * redeems it. That is the same path every other technician takes.
 */

const STATUSES = ['New', 'Reviewing', 'Interview', 'Offer', 'Rejected']

const STATUS_CLASS = {
  New:       'app-status-new',
  Reviewing: 'app-status-reviewing',
  Interview: 'app-status-interview',
  Offer:     'app-status-offer',
  Hired:     'app-status-hired',
  Rejected:  'app-status-rejected',
}

function Row({ label, children }) {
  if (!children && children !== 0) return null
  return (
    <div className="app-row">
      <span className="app-row-label">{label}</span>
      <span className="app-row-value">{children}</span>
    </div>
  )
}

/**
 * A headed group of rows that disappears entirely when it has nothing in it.
 *
 * Most of this form is optional, so a typical application leaves whole
 * sections blank. Rendering the heading regardless left "Emergency contact"
 * and "Education" sitting over empty space, which reads like a loading bug
 * rather than an applicant who skipped them.
 */
function Section({ title, rows }) {
  const filled = rows.filter(([, value]) => value || value === 0)
  if (filled.length === 0) return null
  return (
    <>
      <h3>{title}</h3>
      {filled.map(([label, value]) => (
        <Row key={label} label={label}>{value}</Row>
      ))}
    </>
  )
}

export default function ApplicationReview() {
  const toast   = useToast()
  const confirm = useConfirm()

  const [rows,     setRows]     = useState([])
  const [filter,   setFilter]   = useState('')
  const [loading,  setLoading]  = useState(true)
  const [openId,   setOpenId]   = useState(null)
  const [detail,   setDetail]   = useState(null)
  const [notes,    setNotes]    = useState('')
  const [busy,     setBusy]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await api.listApplications(filter))
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }, [filter, toast])

  useEffect(() => { load() }, [load])

  async function open(id) {
    if (openId === id) { setOpenId(null); setDetail(null); return }
    setOpenId(id)
    setDetail(null)
    try {
      const full = await api.getApplication(id)
      setDetail(full)
      setNotes(full.reviewer_notes || '')
    } catch (err) {
      toast.error(err.message)
      setOpenId(null)
    }
  }

  async function setStatus(id, status) {
    setBusy(true)
    try {
      const updated = await api.reviewApplication(id, { status })
      setDetail(updated)
      toast.success(`Marked ${status.toLowerCase()}.`)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function saveNotes(id) {
    setBusy(true)
    try {
      const updated = await api.reviewApplication(id, { reviewer_notes: notes })
      setDetail(updated)
      toast.success('Notes saved.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function hire(row) {
    const ok = await confirm({
      title: `Hire ${row.first_name} ${row.last_name}?`,
      message: 'This issues a single-use invite code for the role this posting '
             + 'advertises and emails it to the applicant. It does not create an '
             + 'account — they register themselves and redeem the code.',
      confirmLabel: 'Hire and issue code',
    })
    if (!ok) return
    setBusy(true)
    try {
      const res = await api.hireApplicant(row.id)
      toast.success(`Hired. Invite code ${res.invite_code} grants ${res.role}.`)
      const full = await api.getApplication(row.id)
      setDetail(full)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="app-review">
      <div className="app-review-head">
        <h2>Applications</h2>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter by status">
          <option value="">All statuses</option>
          {[...STATUSES, 'Hired'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="app-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="app-empty">
          {filter ? `No applications marked ${filter}.` : 'No applications yet.'}
        </p>
      ) : (
        <ul className="app-list">
          {rows.map((row) => (
            <li key={row.id} className="app-item">
              <button type="button" className="app-item-head"
                      onClick={() => open(row.id)}
                      aria-expanded={openId === row.id}>
                <span className="app-item-name">
                  {row.first_name} {row.last_name}
                </span>
                <span className="app-item-job">{row.job_title}</span>
                <span className={`app-status ${STATUS_CLASS[row.status] || ''}`}>
                  {row.status}
                </span>
                <span className="app-item-ref">{row.ref}</span>
                <span className="app-item-date">{formatDate(row.submitted_at)}</span>
              </button>

              {openId === row.id && (
                <div className="app-detail">
                  {!detail ? <p className="app-empty">Loading…</p> : (
                    <>
                      <div className="app-cols">
                        <section>
                          <Section title="Contact" rows={[
                            ['Email',  detail.email],
                            ['Mobile', detail.phone_mobile],
                            ['Home',   detail.phone_home],
                            ['Address', [detail.address, detail.city, detail.state,
                                         detail.postal_code].filter(Boolean).join(', ')],
                            ['18 or over', detail.is_adult ? 'Yes' : 'Not confirmed'],
                            ['Work authorised',
                             detail.work_authorized ? 'Yes' : 'Not confirmed'],
                          ]} />
                          <Section title="Emergency contact" rows={[
                            ['Name',         detail.ec_name],
                            ['Relationship', detail.ec_relation],
                            ['Phone',        detail.ec_phone],
                            ['Email',        detail.ec_email],
                          ]} />
                          <Section title="Education" rows={[
                            ['High school', [detail.highschool, detail.highschool_year]
                              .filter(Boolean).join(' · ')],
                            ['College', [detail.college, detail.college_major,
                              detail.still_attending ? 'still attending'
                                                     : detail.college_year]
                              .filter(Boolean).join(' · ')],
                          ]} />
                        </section>

                        <section>
                          <Section title="Employment" rows={
                            detail.no_prior_employment
                              ? [['History', 'No prior employment']]
                              : [
                                  ['Employer', detail.prev_employer],
                                  ['Title',    detail.prev_title],
                                  ['Dates',    [detail.prev_from, detail.prev_to]
                                    .filter(Boolean).join(' to ')],
                                  ['Reason for leaving', detail.prev_reason],
                                ]
                          } />
                          <Section title="Role fit" rows={[
                            ['Can perform functions',
                             detail.can_perform_functions ? 'Yes' : 'Not confirmed'],
                            ['Interview accommodation',
                             detail.needs_interview_accommodation || 'None requested'],
                          ]} />
                          <Section title="Signed" rows={[
                            ['Signature', detail.signature],
                            ['Certified', detail.certified ? 'Yes' : 'No'],
                            ['Heard about us via', detail.heard_about],
                          ]} />
                        </section>
                      </div>

                      {detail.about_you && (
                        <div className="app-prose">
                          <h3>About them</h3>
                          <p>{detail.about_you}</p>
                        </div>
                      )}
                      {detail.it_experience && (
                        <div className="app-prose">
                          <h3>IT experience</h3>
                          <p>{detail.it_experience}</p>
                        </div>
                      )}

                      <p className="app-eeo-absent">
                        Voluntary self-identification is stored separately and
                        is not shown here, by design.
                      </p>

                      <div className="app-notes">
                        <label>
                          Reviewer notes
                          <textarea rows={3} value={notes}
                                    onChange={(e) => setNotes(e.target.value)} />
                        </label>
                        <button type="button" className="btn btn-secondary btn-sm"
                                disabled={busy} onClick={() => saveNotes(detail.id)}>
                          Save notes
                        </button>
                      </div>

                      {detail.hired_invite_code ? (
                        <div className="app-hired">
                          Hired. Invite code{' '}
                          <code>{detail.hired_invite_code}</code> was issued —
                          they register, then redeem it to activate access.
                        </div>
                      ) : (
                        <div className="app-actions">
                          {STATUSES.map((s) => (
                            <button key={s} type="button"
                                    className={`btn btn-sm ${detail.status === s
                                      ? 'btn-secondary' : 'btn-ghost'}`}
                                    disabled={busy || detail.status === s}
                                    onClick={() => setStatus(detail.id, s)}>
                              {s}
                            </button>
                          ))}
                          <button type="button" className="btn btn-primary btn-sm"
                                  disabled={busy} onClick={() => hire(row)}>
                            Hire
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}