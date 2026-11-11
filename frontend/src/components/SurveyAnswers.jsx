import { questionsFor, categoryLabel, categoryIcon } from '../config/surveys.js'

/**
 * Read-only display of stored survey answers, shown to technicians
 * on an existing ticket.
 */
export default function SurveyAnswers({ category, survey }) {
  if (!category && (!survey || Object.keys(survey).length === 0)) {
    return (
      <div className="survey-answers-empty">
        No intake survey was completed for this ticket.
      </div>
    )
  }

  const questions = questionsFor(category)
  const answered  = questions.filter((q) => {
    const v = survey?.[q.id]
    return v !== undefined && String(v).trim() !== ''
  })

  // Any keys stored that no longer match a question definition
  const known   = new Set(questions.map((q) => q.id))
  const orphans = Object.entries(survey || {})
    .filter(([k, v]) => !known.has(k) && String(v).trim() !== '')

  return (
    <div className="survey-answers">
      <div className="survey-answers-header">
        <span className="survey-cat-chip">
          {categoryIcon(category)} {categoryLabel(category)}
        </span>
        <span className="text-muted">{answered.length} answers</span>
      </div>

      {answered.length === 0 && orphans.length === 0 && (
        <div className="survey-answers-empty">
          A category was chosen but no questions were answered.
        </div>
      )}

      <dl className="survey-answer-list">
        {answered.map((q) => (
          <div key={q.id} className="survey-answer-row">
            <dt>{q.label}</dt>
            <dd>{String(survey[q.id])}</dd>
          </div>
        ))}
        {orphans.map(([k, v]) => (
          <div key={k} className="survey-answer-row">
            <dt>{k}</dt>
            <dd>{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
