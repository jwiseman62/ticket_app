import { useState, useMemo } from 'react'
import {
  CATEGORIES, questionsFor, suggestPriority,
} from '../config/surveys.js'
import ArticleSuggestions from './ArticleSuggestions.jsx'

/**
 * Optional intake survey shown when creating a ticket.
 *
 * Flow:  pick a category → answer questions → see suggested priority
 *        and any matching knowledge base articles.
 *
 * The whole thing is skippable at every stage.
 */
export default function SurveyStep({
  category, setCategory,
  answers, setAnswers,
  onApplyPriority,
  currentPriority,
  titleText = '',
  descriptionText = '',
}) {
  const [expanded, setExpanded] = useState(!category)
  const [skipped,  setSkipped]  = useState(false)

  const questions = useMemo(() => questionsFor(category), [category])

  const answeredCount = questions.filter((q) => {
    const v = answers[q.id]
    return v !== undefined && String(v).trim() !== ''
  }).length

  const suggestion = useMemo(
    () => (category ? suggestPriority(category, answers) : null),
    [category, answers],
  )

  function setAnswer(id, value) {
    setAnswers((prev) => ({ ...prev, [id]: value }))
  }

  function chooseCategory(id) {
    setCategory(id)
    setAnswers({})
    setSkipped(false)
    setExpanded(true)
  }

  function handleSkip() {
    setSkipped(true)
    setExpanded(false)
  }

  function handleClear() {
    setCategory('')
    setAnswers({})
    setSkipped(false)
    setExpanded(true)
  }

  // Free text used to match knowledge base articles
  const matchText = [
    titleText,
    descriptionText,
    ...Object.values(answers).map(String),
  ].join(' ')

  // ── Collapsed states ─────────────────────────────────────────── //

  if (skipped && !expanded) {
    return (
      <div className="survey-box survey-skipped">
        <span className="survey-skipped-text">Survey skipped — that's fine.</span>
        <button type="button" className="btn btn-sm btn-secondary"
                onClick={() => { setSkipped(false); setExpanded(true) }}>
          Answer it after all
        </button>
      </div>
    )
  }

  if (category && !expanded) {
    return (
      <div className="survey-box survey-collapsed">
        <div className="survey-collapsed-info">
          <span className="survey-cat-chip">
            {CATEGORIES.find((c) => c.id === category)?.icon}{' '}
            {CATEGORIES.find((c) => c.id === category)?.label}
          </span>
          <span className="survey-progress-text">
            {answeredCount} of {questions.length} answered
          </span>
        </div>
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => setExpanded(true)}>
          Edit answers
        </button>
      </div>
    )
  }

  // ── Category picker ──────────────────────────────────────────── //

  if (!category) {
    return (
      <div className="survey-box">
        <div className="survey-header">
          <div>
            <h3 className="survey-title">Help us diagnose it faster</h3>
            <p className="survey-sub">
              Answer a few quick questions about the problem. Optional, but it usually
              gets your ticket resolved sooner.
            </p>
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={handleSkip}>
            Skip
          </button>
        </div>

        <div className="category-grid">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className="category-card"
              onClick={() => chooseCategory(c.id)}
            >
              <span className="category-icon">{c.icon}</span>
              <span className="category-label">{c.label}</span>
              <span className="category-blurb">{c.blurb}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Questions ────────────────────────────────────────────────── //

  const cat = CATEGORIES.find((c) => c.id === category)

  return (
    <div className="survey-box">
      <div className="survey-header">
        <div>
          <h3 className="survey-title">
            {cat.icon} {cat.label} questions
          </h3>
          <p className="survey-sub">
            Answer what you can — every field is optional.
          </p>
        </div>
        <div className="survey-header-actions">
          <button type="button" className="btn btn-sm btn-ghost" onClick={handleClear}>
            Change category
          </button>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setExpanded(false)}>
            Collapse
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="survey-progress">
        <div className="survey-progress-track">
          <div
            className="survey-progress-fill"
            style={{ width: `${(answeredCount / questions.length) * 100}%` }}
          />
        </div>
        <span className="survey-progress-text">{answeredCount}/{questions.length}</span>
      </div>

      {/* Questions */}
      <div className="survey-questions">
        {questions.map((q) => (
          <div key={q.id} className="survey-question">
            <label className="survey-label" htmlFor={`q_${q.id}`}>{q.label}</label>
            {q.hint && <div className="survey-hint">{q.hint}</div>}

            {q.type === 'radio' && (
              <div className="survey-options">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`survey-option ${answers[q.id] === opt ? 'selected' : ''}`}
                    onClick={() => setAnswer(q.id, answers[q.id] === opt ? '' : opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {q.type === 'select' && (
              <select
                id={`q_${q.id}`}
                value={answers[q.id] || ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              >
                <option value="">— Select —</option>
                {q.options.map((opt) => <option key={opt}>{opt}</option>)}
              </select>
            )}

            {q.type === 'text' && (
              <input
                id={`q_${q.id}`} type="text"
                value={answers[q.id] || ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}

            {q.type === 'textarea' && (
              <textarea
                id={`q_${q.id}`} rows={3}
                value={answers[q.id] || ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}

            {q.type === 'date' && (
              <input
                id={`q_${q.id}`} type="date"
                value={answers[q.id] || ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Suggested priority */}
      {suggestion && answeredCount > 0 && (
        <div className="priority-suggestion">
          <div className="priority-suggestion-text">
            <span className="priority-suggestion-label">Suggested priority</span>
            <span className={`badge badge-prio-${suggestion.priority.toLowerCase()}`}>
              {suggestion.priority}
            </span>
            <span className="priority-suggestion-note">
              based on your answers — you can override it
            </span>
          </div>
          {currentPriority !== suggestion.priority && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => onApplyPriority(suggestion.priority)}
            >
              Apply
            </button>
          )}
          {currentPriority === suggestion.priority && (
            <span className="priority-applied">✓ Applied</span>
          )}
        </div>
      )}

      {/* Matching knowledge base articles */}
      <ArticleSuggestions category={category} text={matchText} />
    </div>
  )
}
