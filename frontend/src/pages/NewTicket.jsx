import { useState, useMemo, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import * as api from '../api.js'
import ArticleSuggestions from '../components/ArticleSuggestions.jsx'
import { ticketRef } from '../utils/tickets.js'
import {
  CATEGORIES, questionsFor, suggestPriority, categoryIcon, categoryLabel,
} from '../config/surveys.js'

/**
 * Guided ticket creation.
 *
 * The Dashboard's split-pane form is efficient for technicians who live in it
 * all day, but it's a wall of controls for someone who just wants help. This
 * walks them through one question at a time:
 *
 *   category -> questions -> details -> confirmation
 */

const STEPS = ['category', 'questions', 'details', 'done']

export default function NewTicket() {
  const { user }  = useAuth()
  const toast     = useToast()
  const navigate  = useNavigate()

  const [step,     setStep]     = useState('category')
  const [category, setCategory] = useState('')
  const [answers,  setAnswers]  = useState({})
  const [title,    setTitle]    = useState('')
  const [description, setDescription] = useState('')
  const [dueDate,  setDueDate]  = useState('')
  const [priority, setPriority] = useState('Medium')
  const [touchedPriority, setTouchedPriority] = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [created,  setCreated]  = useState(null)
  const [reviewing, setReviewing] = useState(false)

  const questions = useMemo(() => questionsFor(category), [category])

  // Escape closes the review, matching the other dialogs in the app.
  useEffect(() => {
    if (!reviewing) return
    const onKey = (e) => { if (e.key === 'Escape') setReviewing(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reviewing])
  const suggestion = useMemo(
    () => (category ? suggestPriority(category, answers) : null),
    [category, answers],
  )

  // Follow the suggestion until the user overrides it themselves
  useEffect(() => {
    if (suggestion && !touchedPriority) setPriority(suggestion.priority)
  }, [suggestion, touchedPriority])

  const answeredCount = questions.filter((q) => {
    const v = answers[q.id]
    return v !== undefined && String(v).trim() !== ''
  }).length

  function setAnswer(id, value) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  const matchText = [title, description, ...Object.values(answers).map(String)].join(' ')

  function openReview() {
    if (!title.trim()) { toast.error('Please give your issue a short title.'); return }
    setReviewing(true)
  }

  async function submit() {
    if (!title.trim()) { toast.error('Please give your issue a short title.'); return }
    setReviewing(false)
    setSaving(true)
    try {
      const ticket = await api.createTicket({
        title: title.trim(),
        description,
        requester: user.name,
        technician: '',
        priority,
        status: 'Open',
        due_date: dueDate,
        category,
        survey: answers,
      })
      setCreated(ticket)
      setStep('done')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const stepIndex = STEPS.indexOf(step)

  return (
    <div className="wizard-page">

      {/* Progress */}
      {step !== 'done' && (
        <ol className="wizard-steps">
          {[
            { id: 'category',  label: 'What kind of problem?' },
            { id: 'questions', label: 'A few details' },
            { id: 'details',   label: 'Describe it' },
          ].map((s, i) => (
            <li
              key={s.id}
              className={`wizard-step ${
                step === s.id ? 'current' : i < stepIndex ? 'done' : ''
              }`}
            >
              <span className="wizard-step-num">{i < stepIndex ? '✓' : i + 1}</span>
              <span className="wizard-step-label">{s.label}</span>
            </li>
          ))}
        </ol>
      )}

      {/* ── Step 1: category ── */}
      {step === 'category' && (
        <div className="wizard-panel">
          <h1 className="wizard-title">What do you need help with?</h1>
          <p className="wizard-sub">
            Pick the closest match. This helps us route your request to the right
            person — and might surface a fix you can apply yourself.
          </p>

          <div className="category-grid wizard-categories">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                className="category-card"
                onClick={() => {
                  setCategory(c.id)
                  setAnswers({})
                  setStep('questions')
                }}
              >
                <span className="category-icon">{c.icon}</span>
                <span className="category-label">{c.label}</span>
                <span className="category-blurb">{c.blurb}</span>
              </button>
            ))}
          </div>

          <div className="wizard-actions">
            <button
              type="button" className="btn btn-ghost"
              onClick={() => { setCategory(''); setAnswers({}); setStep('details') }}
            >
              Skip — just let me describe it
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: questions ── */}
      {step === 'questions' && (
        <div className="wizard-panel">
          <h1 className="wizard-title">
            {categoryIcon(category)} {categoryLabel(category)}
          </h1>
          <p className="wizard-sub">
            Answer what you can — every question is optional, but each one makes
            it likelier the technician fixes it on the first try.
          </p>

          <div className="survey-progress">
            <div className="survey-progress-track">
              <div
                className="survey-progress-fill"
                style={{ width: `${(answeredCount / questions.length) * 100}%` }}
              />
            </div>
            <span className="survey-progress-text">
              {answeredCount}/{questions.length}
            </span>
          </div>

          <div className="survey-questions">
            {questions.map((q) => (
              <div key={q.id} className="survey-question">
                <label className="survey-label" htmlFor={`q_${q.id}`}>{q.label}</label>
                {q.hint && <div className="survey-hint">{q.hint}</div>}

                {q.type === 'radio' && (
                  <div className="survey-options">
                    {q.options.map((opt) => (
                      <button
                        key={opt} type="button"
                        className={`survey-option ${answers[q.id] === opt ? 'selected' : ''}`}
                        onClick={() => setAnswer(q.id, answers[q.id] === opt ? '' : opt)}
                      >{opt}</button>
                    ))}
                  </div>
                )}
                {q.type === 'select' && (
                  <select id={`q_${q.id}`} value={answers[q.id] || ''}
                          onChange={(e) => setAnswer(q.id, e.target.value)}>
                    <option value="">— Select —</option>
                    {q.options.map((o) => <option key={o}>{o}</option>)}
                  </select>
                )}
                {q.type === 'text' && (
                  <input id={`q_${q.id}`} type="text" value={answers[q.id] || ''}
                         onChange={(e) => setAnswer(q.id, e.target.value)} />
                )}
                {q.type === 'textarea' && (
                  <textarea id={`q_${q.id}`} rows={3} value={answers[q.id] || ''}
                            onChange={(e) => setAnswer(q.id, e.target.value)} />
                )}
              </div>
            ))}
          </div>

          <ArticleSuggestions category={category} text={matchText} />

          <div className="wizard-actions">
            <button type="button" className="btn btn-secondary"
                    onClick={() => setStep('category')}>
              ← Back
            </button>
            <button type="button" className="btn btn-primary"
                    onClick={() => setStep('details')}>
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: details ── */}
      {step === 'details' && (
        <div className="wizard-panel">
          <h1 className="wizard-title">Describe the problem</h1>
          <p className="wizard-sub">
            A clear title helps whoever picks this up understand it at a glance.
          </p>

          <div className="form-group">
            <label htmlFor="title">Short title *</label>
            <input
              id="title" type="text" value={title} autoFocus
              placeholder="e.g. Laptop won't turn on after update"
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="desc">Anything else we should know?</label>
            <textarea
              id="desc" rows={5} value={description}
              placeholder="When it started, what you were doing, anything you already tried…"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="prio">How urgent is it?</label>
              <select
                id="prio" value={priority}
                onChange={(e) => { setPriority(e.target.value); setTouchedPriority(true) }}
              >
                <option value="Low">Low — whenever you get to it</option>
                <option value="Medium">Medium — soon please</option>
                <option value="High">High — I'm blocked</option>
              </select>
              {suggestion && !touchedPriority && answeredCount > 0 && (
                <span className="field-hint">
                  Set to <strong>{suggestion.priority}</strong> based on your
                  answers — change it if that's not right.
                </span>
              )}
            </div>
            <div className="form-group">
              <label htmlFor="due">Needed by (optional)</label>
              <input id="due" type="date" value={dueDate}
                     onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          {category && <ArticleSuggestions category={category} text={matchText} />}

          <div className="wizard-actions">
            <button
              type="button" className="btn btn-secondary"
              onClick={() => setStep(category ? 'questions' : 'category')}
            >
              ← Back
            </button>
            <button type="button" className="btn btn-primary"
                    onClick={openReview} disabled={saving || !title.trim()}>
              Review &amp; Submit
            </button>
          </div>
        </div>
      )}

      {/* ── Review before submitting ──
          A ticket is read by someone else, so a typo or a missing detail
          costs a round trip. This shows exactly what will be filed, with a
          way back to each step rather than only an OK button. */}
      {reviewing && (
        <div className="review-backdrop" role="presentation"
             onClick={() => setReviewing(false)}>
          <div
            className="review-dialog"
            role="dialog" aria-modal="true" aria-labelledby="review-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="review-title" id="review-title">
              Is everything correct?
            </h2>
            <p className="review-sub">
              This is what the helpdesk will see. You can still go back and
              change anything.
            </p>

            <dl className="review-list">
              <div className="review-row">
                <dt>Category</dt>
                <dd>
                  {category
                    ? `${categoryIcon(category)} ${categoryLabel(category)}`
                    : <span className="review-empty">Not chosen</span>}
                </dd>
              </div>
              <div className="review-row">
                <dt>Title</dt>
                <dd>{title.trim()}</dd>
              </div>
              <div className="review-row">
                <dt>Description</dt>
                <dd>
                  {description.trim()
                    ? <span className="review-pre">{description.trim()}</span>
                    : <span className="review-empty">Left blank</span>}
                </dd>
              </div>
              <div className="review-row">
                <dt>Priority</dt>
                <dd>
                  {priority}
                  {suggestion && !touchedPriority && (
                    <span className="review-note"> · suggested</span>
                  )}
                </dd>
              </div>
              {dueDate && (
                <div className="review-row">
                  <dt>Needed by</dt><dd>{dueDate}</dd>
                </div>
              )}
            </dl>

            {questions.length > 0 && (
              <>
                <h3 className="review-section">
                  Your answers ({answeredCount} of {questions.length})
                </h3>
                <dl className="review-list">
                  {questions.map((q) => {
                    const v = answers[q.id]
                    const filled = v !== undefined && String(v).trim() !== ''
                    return (
                      <div className="review-row" key={q.id}>
                        <dt>{q.label}</dt>
                        <dd>
                          {filled
                            ? String(v)
                            : <span className="review-empty">Skipped</span>}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </>
            )}

            <div className="review-actions">
              <button type="button" className="btn btn-primary"
                      onClick={submit} disabled={saving}>
                {saving ? 'Submitting…' : 'Yes, submit it'}
              </button>
              <button type="button" className="btn btn-secondary"
                      onClick={() => setReviewing(false)}>
                Go back and edit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 4: confirmation ── */}
      {step === 'done' && created && (
        <div className="wizard-panel wizard-done">
          <div className="wizard-done-icon">✅</div>
          <h1 className="wizard-title">Your ticket is in</h1>
          <p className="wizard-sub">
            Reference <strong>{ticketRef(created)}</strong>
            {' — '}keep this handy if you need to follow up.
          </p>

          <div className="wizard-summary">
            <div className="wizard-summary-row">
              <span>Title</span><strong>{created.title}</strong>
            </div>
            <div className="wizard-summary-row">
              <span>Priority</span>
              <span className={`badge badge-prio-${created.priority.toLowerCase()}`}>
                {created.priority}
              </span>
            </div>
            {created.category && (
              <div className="wizard-summary-row">
                <span>Category</span>
                <strong>{categoryIcon(created.category)} {categoryLabel(created.category)}</strong>
              </div>
            )}
          </div>

          <div className="whats-next">
            <h2 className="whats-next-title">What happens next</h2>
            <ol className="whats-next-list">
              <li>A technician picks up your ticket and it moves to In Progress.</li>
              <li>You'll get an email when someone claims it or comments.</li>
              <li>You can reply to them directly on the ticket — and attach
                  screenshots, which usually speed things up a lot.</li>
            </ol>
          </div>

          <div className="wizard-actions">
            <Link to={`/tickets/${created.id}`} className="btn btn-primary">
              View my ticket
            </Link>
            <button
              type="button" className="btn btn-secondary"
              onClick={() => {
                setStep('category'); setCategory(''); setAnswers({})
                setTitle(''); setDescription(''); setDueDate('')
                setPriority('Medium'); setTouchedPriority(false); setCreated(null)
              }}
            >
              File another
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate('/')}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}