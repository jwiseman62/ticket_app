import { useState, useEffect } from 'react'
import * as api from '../api.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatDateTime, fullTimestamp } from '../utils/dates.js'
import { useConfirm } from '../context/ConfirmContext.jsx'
import HistoryTimeline   from './HistoryTimeline.jsx'
import SurveyStep        from './SurveyStep.jsx'
import SurveyAnswers     from './SurveyAnswers.jsx'
import Comments          from './Comments.jsx'
import Attachments       from './Attachments.jsx'
import { categoryLabel, categoryIcon } from '../config/surveys.js'

const STATUS_OPTIONS   = ['Open', 'In Progress', 'Closed']
const PRIORITY_OPTIONS = ['Low', 'Medium', 'High']
const EMPTY = {
  title: '', requester: '', technician: '', priority: 'Medium',
  status: 'Open', due_date: '', description: '',
}

function fmtId(id) { return `TKT-${String(id).padStart(3, '0')}` }

export default function TicketForm({ ticketId, currentUser, onSaved, onDeleted }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [form,     setForm]     = useState(EMPTY)
  const [category, setCategory] = useState('')
  const [survey,   setSurvey]   = useState({})
  const [ticket,   setTicket]   = useState(null)

  const [tab,     setTab]     = useState('details')
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    setError('')
    setSuccess('')
    setTab('details')

    if (!ticketId) {
      const prefill = { ...EMPTY }
      if (currentUser.role === 'Requester' || currentUser.role === 'Both')
        prefill.requester = currentUser.name
      if (currentUser.role === 'Technician' || currentUser.role === 'Both')
        prefill.technician = currentUser.name
      setForm(prefill)
      setCategory('')
      setSurvey({})
      setTicket(null)
      return
    }

    setLoading(true)
    api.getTicket(ticketId)
      .then((t) => {
        setTicket(t)
        setForm({
          title: t.title, requester: t.requester, technician: t.technician,
          priority: t.priority, status: t.status, due_date: t.due_date,
          description: t.description,
        })
        setCategory(t.category || '')
        setSurvey(t.survey || {})
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticketId, currentUser])

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }))

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!form.title.trim())     { setError('Title is required.'); setTab('details'); return }
    if (!form.requester.trim()) { setError('Requester is required.'); setTab('details'); return }
    if (form.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.due_date)) {
      setError('Due date must be YYYY-MM-DD.')
      setTab('details')
      return
    }

    setSaving(true)
    try {
      const payload = { ...form, category, survey }
      const saved = ticketId
        ? await api.updateTicket(ticketId, payload)
        : await api.createTicket(payload)
      setTicket(saved)
      toast.success(ticketId ? `Saved ${fmtId(saved.id)}` : `Created ${fmtId(saved.id)}`)
      onSaved(saved.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!ticketId) return
    const ok = await confirm({
      title: `Delete ${fmtId(ticketId)}?`,
      message: 'The ticket and all its comments and attachments will be removed.',
      detail: 'This cannot be undone.',
      confirmLabel: 'Delete ticket',
      danger: true,
    })
    if (!ok) return
    try {
      await api.deleteTicket(ticketId)
      onDeleted()
    } catch (err) { setError(err.message) }
  }

  const isRequester = currentUser.role === 'Requester'
  const canDelete   = !isRequester

  if (loading) return <div className="form-loading">Loading ticket…</div>

  const tabs = ticketId
    ? [
        { id: 'details',     label: 'Details' },
        { id: 'survey',      label: 'Survey' },
        { id: 'comments',    label: 'Comments' },
        { id: 'attachments', label: 'Files' },
        { id: 'history',     label: 'History' },
      ]
    : [
        { id: 'details', label: 'Details' },
        { id: 'survey',  label: 'Survey' },
      ]

  return (
    <div className="ticket-form-wrapper">

      {/* Header */}
      <div className="ticket-form-header">
        <h2>{ticketId ? fmtId(ticketId) : 'New Ticket'}</h2>
        {category && (
          <span className="survey-cat-chip">
            {categoryIcon(category)} {categoryLabel(category)}
          </span>
        )}
        {ticket && (
          <span className="ticket-timestamps">
            <span title={fullTimestamp(ticket.created_at)}>
              Created {formatDateTime(ticket.created_at)}
            </span>
            {' · '}
            <span title={fullTimestamp(ticket.updated_at)}>
              Updated {formatDateTime(ticket.updated_at)}
            </span>
          </span>
        )}
      </div>

      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      {/* Tabs */}
      <div className="tab-bar">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Details tab ── */}
      {tab === 'details' && (
        <form onSubmit={handleSave} className="ticket-form">
          <div className="form-group">
            <label htmlFor="title">Title *</label>
            <input id="title" type="text" value={form.title} onChange={set('title')} required />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="requester">Requester *</label>
              <input
                id="requester" type="text" value={form.requester} onChange={set('requester')}
                readOnly={isRequester} className={isRequester ? 'input-readonly' : ''}
              />
            </div>
            <div className="form-group">
              <label htmlFor="technician">Technician</label>
              <input id="technician" type="text" value={form.technician} onChange={set('technician')} />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label htmlFor="priority">Priority</label>
              <select id="priority" value={form.priority} onChange={set('priority')}>
                {PRIORITY_OPTIONS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="status">Status</label>
              <select id="status" value={form.status} onChange={set('status')}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} disabled={isRequester && s === 'Closed'}>{s}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="due_date">Due Date</label>
              <input id="due_date" type="date" value={form.due_date} onChange={set('due_date')} />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="description">Description</label>
            <textarea id="description" rows={6} value={form.description} onChange={set('description')} />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving…' : (ticketId ? 'Save Changes' : 'Create Ticket')}
            </button>
            {ticketId && canDelete && (
              <button type="button" className="btn btn-danger" onClick={handleDelete}>Delete</button>
            )}
          </div>
        </form>
      )}

      {/* ── Survey tab ── */}
      {tab === 'survey' && (
        <div className="tab-panel">
          {ticketId && currentUser.role !== 'Requester' ? (
            <>
              <SurveyAnswers category={category} survey={survey} />
              <details className="survey-edit-toggle">
                <summary>Edit survey answers</summary>
                <SurveyStep
                  category={category} setCategory={setCategory}
                  answers={survey} setAnswers={setSurvey}
                  onApplyPriority={(p) => setForm((f) => ({ ...f, priority: p }))}
                  currentPriority={form.priority}
                  titleText={form.title} descriptionText={form.description}
                />
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Survey'}
                </button>
              </details>
            </>
          ) : (
            <>
              <SurveyStep
                category={category} setCategory={setCategory}
                answers={survey} setAnswers={setSurvey}
                onApplyPriority={(p) => setForm((f) => ({ ...f, priority: p }))}
                currentPriority={form.priority}
                titleText={form.title} descriptionText={form.description}
              />
              <div className="form-actions">
                <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : (ticketId ? 'Save Changes' : 'Create Ticket')}
                </button>
                {!ticketId && (
                  <button type="button" className="btn btn-secondary" onClick={() => setTab('details')}>
                    Back to details
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Comments tab ── */}
      {tab === 'comments' && ticketId && (
        <div className="tab-panel">
          <Comments ticketId={ticketId} currentUser={currentUser} />
        </div>
      )}

      {/* ── Attachments tab ── */}
      {tab === 'attachments' && ticketId && (
        <div className="tab-panel">
          <Attachments ticketId={ticketId} currentUser={currentUser} />
        </div>
      )}

      {/* ── History tab ── */}
      {tab === 'history' && ticketId && (
        <div className="tab-panel">
          {ticket?.history?.length > 0
            ? <HistoryTimeline entries={ticket.history} />
            : <div className="list-placeholder">No history yet.</div>}
        </div>
      )}
    </div>
  )
}
