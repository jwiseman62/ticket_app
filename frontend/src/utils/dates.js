/**
 * Date formatting helpers.
 *
 * The backend stores timezone-aware UTC ("2026-09-11T14:23:00+00:00").
 * Displaying that raw shows UTC, which is wrong for everyone not on UTC —
 * a ticket filed at 9:23 AM in Houston read as 14:23. new Date() parses the
 * offset correctly and renders in the viewer's own timezone, so everything
 * below goes through it.
 */

function toDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "just now", "5m ago", "3h ago", "2d ago", then a date. */
export function relativeTime(value) {
  const d = toDate(value)
  if (!d) return ''

  const seconds = (Date.now() - d.getTime()) / 1000

  if (seconds < 0)      return 'just now'   // clock skew
  if (seconds < 45)     return 'just now'
  if (seconds < 3600)   return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400)  return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "11 Sep 2026, 09:23" in local time. */
export function formatDateTime(value) {
  const d = toDate(value)
  if (!d) return ''
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/** "11 Sep 2026" in local time. */
export function formatDate(value) {
  const d = toDate(value)
  if (!d) return ''
  return d.toLocaleDateString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/** Full timestamp for tooltips. */
export function fullTimestamp(value) {
  const d = toDate(value)
  return d ? d.toLocaleString() : ''
}

/**
 * Recent items read better as "2h ago"; older ones as a real date.
 * Used for ticket list rows and activity lines.
 */
export function smartTime(value) {
  const d = toDate(value)
  if (!d) return ''
  const days = (Date.now() - d.getTime()) / 86400000
  return days < 7 ? relativeTime(value) : formatDate(value)
}

/** Local YYYY-MM-DD, for comparing against due dates. */
export function todayISO() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Due dates are plain calendar dates — compare in local time, not UTC. */
export function isOverdue(ticket) {
  if (!ticket?.due_date || ticket.status === 'Closed') return false
  return ticket.due_date < todayISO()
}

/** "in 3 days", "today", "2 days overdue". */
export function dueLabel(dueDate) {
  if (!dueDate) return ''
  const today = todayISO()
  if (dueDate === today) return 'due today'

  const diff = Math.round(
    (new Date(`${dueDate}T00:00:00`) - new Date(`${today}T00:00:00`)) / 86400000
  )
  if (diff < 0) {
    const n = Math.abs(diff)
    return `${n} day${n === 1 ? '' : 's'} overdue`
  }
  if (diff === 1) return 'due tomorrow'
  return `due in ${diff} days`
}