import { useState, useEffect } from 'react'
import * as api from '../api.js'
import HistoryTimeline from './HistoryTimeline.jsx'

const STATUS_OPTIONS   = ['Open', 'In Progress', 'Closed']
const PRIORITY_OPTIONS = ['Low', 'Medium', 'High']
const EMPTY = { title:'', requester:'', technician:'', priority:'Medium', status:'Open', due_date:'', description:'' }

function fmtId(id) { return `TKT-${String(id).padStart(3,'0')}` }

export default function TicketForm({ ticketId, currentUser, onSaved, onDeleted }) {
  const [form,    setForm]    = useState(EMPTY)
  const [ticket,  setTicket]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    setError('')
    setSuccess('')
    if (!ticketId) {
      const prefill = { ...EMPTY }
      if (currentUser.role === 'Requester' || currentUser.role === 'Both')
        prefill.requester = currentUser.name
      if (currentUser.role === 'Technician' || currentUser.role === 'Both')
        prefill.technician = currentUser.name
      setForm(prefill)
      setTicket(null)
      return
    }
    setLoading(true)
    api.getTicket(ticketId)
      .then((t) => {
        setTicket(t)
        setForm({ title:t.title, requester:t.requester, technician:t.technician,
                  priority:t.priority, status:t.status, due_date:t.due_date, description:t.description })
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticketId, currentUser])

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }))

  async function handleSave(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    if (!form.title.trim())     { setError('Title is required.'); return }
    if (!form.requester.trim()) { setError('Requester is required.'); return }
    if (form.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(form.due_date)) {
      setError('Due date must be YYYY-MM-DD.')
      return
    }
    setSaving(true)
    try {
      const saved = ticketId
        ? await api.updateTicket(ticketId, form)
        : await api.createTicket(form)
      setTicket(saved)
      setSuccess(ticketId ? `Updated ${fmtId(saved.id)}` : `Created ${fmtId(saved.id)}`)
      onSaved(saved.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!ticketId) return
    if (!window.confirm(`Delete ${fmtId(ticketId)}? This cannot be undone.`)) return
    try {
      await api.deleteTicket(ticketId)
      onDeleted()
    } catch (err) { setError(err.message) }
  }

  const isRequester = currentUser.role === 'Requester'
  const canDelete   = !isRequester

  if (loading) return <div className="form-loading">Loading ticket…</div>

  return (
    <div className="ticket-form-wrapper">
      <div className="ticket-form-header">
        <h2>{ticketId ? fmtId(ticketId) : 'New Ticket'}</h2>
        {ticket && (
          <span className="ticket-timestamps">
            Created: {ticket.created_at} &nbsp;|&nbsp; Updated: {ticket.updated_at}
          </span>
        )}
      </div>

      {error   && <div className="alert alert-error">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

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

      {ticket && ticket.history?.length > 0 && (
        <div className="history-section">
          <h3>History</h3>
          <HistoryTimeline entries={ticket.history} />
        </div>
      )}
    </div>
  )
}
