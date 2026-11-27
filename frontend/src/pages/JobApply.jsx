import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import * as api from '../api.js'
import { useToast } from '../context/ToastContext.jsx'

/*
 * The application form.
 *
 * Deliberately NOT collected, with reasons — if a future version adds any of
 * these back, it should be a decision rather than an oversight:
 *
 *   Social Security Number  Post-offer only, for the I-9 and background
 *                           check. Collecting it on a public demo would put
 *                           a real number in a database that a shared admin
 *                           login can read.
 *   Date of birth           Age-discrimination exposure with no pre-offer
 *                           purpose. "18 or over" answers the real question.
 *   Criminal history        Illinois' Job Opportunities for Qualified
 *                           Applicants Act bars asking at this stage.
 *   Disability              The ADA bars pre-offer disability questions,
 *                           even where the employer intends to read the
 *                           answers only after an offer. The permitted
 *                           questions are about performing the job and about
 *                           accommodation for the interview — both below.
 *
 * The EEO self-identification block is voluntary, defaults to declining, and
 * is stored in a separate table the review screens never read.
 */

const GENDERS = [
  'Decline to self-identify', 'Male', 'Female', 'Non-binary',
]

const RACES = [
  'Decline to self-identify',
  'Hispanic or Latino',
  'White (Not Hispanic or Latino)',
  'Black or African American (Not Hispanic or Latino)',
  'Asian (Not Hispanic or Latino)',
  'Native Hawaiian or Other Pacific Islander (Not Hispanic or Latino)',
  'American Indian or Alaska Native (Not Hispanic or Latino)',
  'Two or More Races (Not Hispanic or Latino)',
]

const VETERAN = [
  'Decline to self-identify',
  'I identify as one or more classifications of protected veteran',
  'I am not a protected veteran',
]

const BLANK = {
  first_name: '', middle_initial: '', last_name: '',
  address: '', city: '', state: '', postal_code: '',
  phone_mobile: '', phone_home: '', email: '', confirm_email: '',
  is_adult: false, work_authorized: false,
  ec_name: '', ec_relation: '', ec_phone: '', ec_email: '',
  heard_about: '', about_you: '', it_experience: '',
  highschool: '', highschool_year: '',
  college: '', college_major: '', college_year: '', still_attending: false,
  no_prior_employment: false,
  prev_employer: '', prev_title: '', prev_from: '', prev_to: '', prev_reason: '',
  can_perform_functions: false, needs_interview_accommodation: '',
  signature: '', certified: false,
  eeo_gender: 'Decline to self-identify',
  eeo_race: 'Decline to self-identify',
  eeo_veteran: 'Decline to self-identify',
}

export default function JobApply() {
  const { slug } = useParams()
  const toast    = useToast()

  const [job,     setJob]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [form,    setForm]    = useState(BLANK)
  const [sending, setSending] = useState(false)
  const [done,    setDone]    = useState(null)   // the reference, once accepted

  useEffect(() => {
    let cancelled = false
    api.getJob(slug)
      .then((row) => { if (!cancelled) setJob(row) })
      .catch(() => { if (!cancelled) setJob(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [slug])

  const set = (field) => (e) => setForm((prev) => ({
    ...prev,
    [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
  }))

  const emailsMatch =
    !form.confirm_email ||
    form.email.trim().toLowerCase() === form.confirm_email.trim().toLowerCase()

  async function submit(e) {
    e.preventDefault()
    if (sending) return
    if (!emailsMatch) { toast.error("The two email addresses don't match."); return }

    setSending(true)
    try {
      const res = await api.submitApplication({
        job_slug: slug,
        first_name: form.first_name, middle_initial: form.middle_initial,
        last_name: form.last_name,
        address: form.address, city: form.city, state: form.state,
        postal_code: form.postal_code,
        phone_mobile: form.phone_mobile, phone_home: form.phone_home,
        email: form.email, confirm_email: form.confirm_email,
        is_adult: form.is_adult, work_authorized: form.work_authorized,
        ec_name: form.ec_name, ec_relation: form.ec_relation,
        ec_phone: form.ec_phone, ec_email: form.ec_email,
        heard_about: form.heard_about, about_you: form.about_you,
        it_experience: form.it_experience,
        highschool: form.highschool, highschool_year: form.highschool_year,
        college: form.college, college_major: form.college_major,
        college_year: form.college_year, still_attending: form.still_attending,
        no_prior_employment: form.no_prior_employment,
        prev_employer: form.prev_employer, prev_title: form.prev_title,
        prev_from: form.prev_from, prev_to: form.prev_to,
        prev_reason: form.prev_reason,
        can_perform_functions: form.can_perform_functions,
        needs_interview_accommodation: form.needs_interview_accommodation,
        signature: form.signature, certified: form.certified,
        eeo: {
          gender: form.eeo_gender,
          race: form.eeo_race,
          veteran_status: form.eeo_veteran,
        },
      })
      setDone(res.ref)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSending(false)
    }
  }

  if (loading) {
    return <div className="careers-page"><div className="careers-inner">
      <p className="careers-empty">Loading…</p></div></div>
  }

  if (!job) {
    return <div className="careers-page"><div className="careers-inner">
      <Link to="/careers" className="legal-back">← All open roles</Link>
      <h1 className="careers-head">This role isn't open</h1>
    </div></div>
  }

  if (done) {
    return (
      <div className="careers-page"><div className="careers-inner">
        <div className="apply-done">
          <h1>Application received</h1>
          <p>
            Thanks — your application for <strong>{job.title}</strong> is in.
            Your reference is <strong className="apply-ref">{done}</strong>.
          </p>
          <p>
            If you're offered the role you'll get an invite code by email. You
            register your own account with your own password, then enter the
            code to activate your access.
          </p>
          <p className="apply-done-note">
            This is a demonstration project. No real application has been made
            and nobody will be in touch.
          </p>
          <Link to="/careers" className="btn btn-primary">Back to open roles</Link>
        </div>
      </div></div>
    )
  }

  return (
    <div className="careers-page">
      <div className="careers-inner">
        <Link to={`/careers/${slug}`} className="legal-back">← {job.title}</Link>

        <header className="careers-head">
          <h1>Apply — {job.title}</h1>
          <p className="careers-lede">
            Everything except the marked fields is optional.
          </p>
        </header>

        <div className="careers-demo-note">
          <strong>Do not enter real personal information.</strong> This is a
          portfolio demonstration on public hosting. Anything you submit can be
          read by anyone using the shared demo administrator account, and is
          deleted at the next scheduled reset.
        </div>

        <form className="apply-form" onSubmit={submit}>

          {/* ── Contact ── */}
          <fieldset className="apply-section">
            <legend>Contact information</legend>
            <div className="apply-grid apply-grid-3">
              <label>First name <span className="req">*</span>
                <input required value={form.first_name} onChange={set('first_name')} />
              </label>
              <label className="apply-narrow">Middle initial
                <input maxLength={2} value={form.middle_initial}
                       onChange={set('middle_initial')} />
              </label>
              <label>Last name <span className="req">*</span>
                <input required value={form.last_name} onChange={set('last_name')} />
              </label>
            </div>
            <label>Street address
              <input value={form.address} onChange={set('address')}
                     placeholder="Number and street, apartment if any" />
            </label>
            <div className="apply-grid apply-grid-3">
              <label>City
                <input value={form.city} onChange={set('city')} />
              </label>
              <label className="apply-narrow">State
                <input maxLength={2} value={form.state} onChange={set('state')}
                       placeholder="IL" />
              </label>
              <label>ZIP code
                <input value={form.postal_code} onChange={set('postal_code')} />
              </label>
            </div>
            <div className="apply-grid">
              <label>Mobile phone
                <input type="tel" value={form.phone_mobile} onChange={set('phone_mobile')} />
              </label>
              <label>Home phone
                <input type="tel" value={form.phone_home} onChange={set('phone_home')} />
              </label>
            </div>
            <div className="apply-grid">
              <label>Email <span className="req">*</span>
                <input type="email" required value={form.email} onChange={set('email')} />
              </label>
              <label>Confirm email <span className="req">*</span>
                <input type="email" required value={form.confirm_email}
                       onChange={set('confirm_email')} />
                {!emailsMatch && (
                  <span className="field-hint field-hint-warn">
                    These don't match.
                  </span>
                )}
              </label>
            </div>
          </fieldset>

          {/* ── Eligibility: what date of birth was actually being asked for ── */}
          <fieldset className="apply-section">
            <legend>Eligibility</legend>
            <label className="apply-check">
              <input type="checkbox" required checked={form.is_adult}
                     onChange={set('is_adult')} />
              <span>I am 18 years of age or older <span className="req">*</span></span>
            </label>
            <label className="apply-check">
              <input type="checkbox" checked={form.work_authorized}
                     onChange={set('work_authorized')} />
              <span>I am legally authorised to work in the United States</span>
            </label>
          </fieldset>

          {/* ── Emergency contact ── */}
          <fieldset className="apply-section">
            <legend>Emergency contact</legend>
            <div className="apply-grid">
              <label>Name
                <input value={form.ec_name} onChange={set('ec_name')} />
              </label>
              <label>Relationship
                <input value={form.ec_relation} onChange={set('ec_relation')}
                       placeholder="Partner, parent, friend…" />
              </label>
            </div>
            <div className="apply-grid">
              <label>Phone
                <input type="tel" value={form.ec_phone} onChange={set('ec_phone')} />
              </label>
              <label>Email
                <input type="email" value={form.ec_email} onChange={set('ec_email')} />
              </label>
            </div>
          </fieldset>

          {/* ── Background ── */}
          <fieldset className="apply-section">
            <legend>Background</legend>
            <label>How did you find us?
              <input value={form.heard_about} onChange={set('heard_about')} />
            </label>
            <label>Tell us a bit about yourself
              <textarea rows={4} maxLength={2000} value={form.about_you}
                        onChange={set('about_you')} />
            </label>
            <label>A short paragraph about your IT experience
              <textarea rows={5} maxLength={2000} value={form.it_experience}
                        onChange={set('it_experience')} />
            </label>
          </fieldset>

          {/* ── Education ── */}
          <fieldset className="apply-section">
            <legend>Education</legend>
            <div className="apply-grid">
              <label>High school or GED
                <input value={form.highschool} onChange={set('highschool')} />
              </label>
              <label className="apply-narrow">Graduation year
                <input maxLength={4} value={form.highschool_year}
                       onChange={set('highschool_year')} placeholder="2016" />
              </label>
            </div>
            <div className="apply-grid apply-grid-3">
              <label>College attended
                <input value={form.college} onChange={set('college')} />
              </label>
              <label>Major
                <input value={form.college_major} onChange={set('college_major')} />
              </label>
              <label className="apply-narrow">Graduation year
                <input maxLength={4} value={form.college_year}
                       onChange={set('college_year')}
                       disabled={form.still_attending} />
              </label>
            </div>
            <label className="apply-check">
              <input type="checkbox" checked={form.still_attending}
                     onChange={set('still_attending')} />
              <span>I'm still attending</span>
            </label>
          </fieldset>

          {/* ── Employment ── */}
          <fieldset className="apply-section">
            <legend>Employment history</legend>
            <label className="apply-check">
              <input type="checkbox" checked={form.no_prior_employment}
                     onChange={set('no_prior_employment')} />
              <span>I have not been employed before</span>
            </label>
            {!form.no_prior_employment && (
              <>
                <div className="apply-grid">
                  <label>Most recent employer
                    <input value={form.prev_employer} onChange={set('prev_employer')} />
                  </label>
                  <label>Job title
                    <input value={form.prev_title} onChange={set('prev_title')} />
                  </label>
                </div>
                <div className="apply-grid">
                  <label>From
                    <input type="month" value={form.prev_from} onChange={set('prev_from')} />
                  </label>
                  <label>To
                    <input type="month" value={form.prev_to} onChange={set('prev_to')} />
                  </label>
                </div>
                <label>Reason for leaving
                  <textarea rows={2} maxLength={500} value={form.prev_reason}
                            onChange={set('prev_reason')} />
                </label>
              </>
            )}
          </fieldset>

          {/* ── The two questions the ADA permits before an offer ── */}
          <fieldset className="apply-section">
            <legend>About the job itself</legend>
            <label className="apply-check">
              <input type="checkbox" checked={form.can_perform_functions}
                     onChange={set('can_perform_functions')} />
              <span>
                I can perform the essential functions of this role, with or
                without reasonable accommodation
              </span>
            </label>
            <label>
              Do you need any accommodation for the interview process?
              <textarea rows={3} maxLength={1000}
                        value={form.needs_interview_accommodation}
                        onChange={set('needs_interview_accommodation')}
                        placeholder="Leave blank if not — asking does not affect your application." />
            </label>
          </fieldset>

          {/* ── EEO: voluntary, and kept apart ── */}
          <fieldset className="apply-section apply-section-eeo">
            <legend>Voluntary self-identification</legend>
            <p className="apply-eeo-note">
              Answering is entirely optional and every question defaults to
              declining. This information is used for equal-opportunity
              reporting only. It is stored separately from your application and
              is <strong>not shown to anyone reviewing it</strong> — in this
              application that is literal: it lives in a different database
              table that the review screens never read.
            </p>
            <div className="apply-grid">
              <label>Gender
                <select value={form.eeo_gender} onChange={set('eeo_gender')}>
                  {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </label>
              <label>Protected veteran status
                <select value={form.eeo_veteran} onChange={set('eeo_veteran')}>
                  {VETERAN.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </label>
            </div>
            <label>Race or ethnicity
              <select value={form.eeo_race} onChange={set('eeo_race')}>
                {RACES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
          </fieldset>

          {/* ── Agreement ── */}
          <fieldset className="apply-section">
            <legend>Agreement</legend>
            <p className="apply-terms">
              I certify that the information in this application is true and
              complete to the best of my knowledge. I understand that a false
              statement or omission may disqualify me from consideration or, if
              discovered after hiring, result in dismissal. I authorise the
              employer to verify the information above, including contacting
              the employers and schools named. I understand that this
              application is not an offer of employment and does not create a
              contract, and that employment, if offered, would be at will.
            </p>
            <p className="apply-terms apply-terms-demo">
              I also understand that <strong>this is a demonstration
              application</strong>, that no real employment is on offer, and
              that submitted data is deleted at the next scheduled reset.
            </p>
            <label className="apply-check">
              <input type="checkbox" required checked={form.certified}
                     onChange={set('certified')} />
              <span>I agree to the statements above <span className="req">*</span></span>
            </label>
            <div className="apply-grid">
              <label>Type your full name as an electronic signature <span className="req">*</span>
                <input required value={form.signature} onChange={set('signature')}
                       className="apply-signature"
                       placeholder="Your full name" />
              </label>
              <label>Date
                <input value={new Date().toLocaleDateString()} readOnly
                       aria-label="Date of application" />
              </label>
            </div>
          </fieldset>

          <div className="apply-submit">
            <button type="submit" className="btn btn-primary btn-lg"
                    disabled={sending || !emailsMatch}>
              {sending ? 'Submitting…' : 'Submit application'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}