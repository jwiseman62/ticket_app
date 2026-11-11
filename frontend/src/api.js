/**
 * API base URL.
 *
 * Locally this stays '/api', which the Vite dev server proxies to
 * localhost:8000 (see vite.config.js). That proxy exists only in dev, so a
 * deployed build pointing at a separate backend must be built with
 * VITE_API_URL set to the API's absolute origin, e.g.
 *
 *     VITE_API_URL=https://ticket-api.onrender.com
 *
 * Vite inlines env vars at BUILD time, not runtime — changing it means
 * rebuilding, not just restarting.
 *
 * If you later serve the frontend from FastAPI itself (single service),
 * leave VITE_API_URL unset and drop the /api prefix instead.
 */
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

/** True when this build is a public demo: enables the one-click logins. */
export const DEMO_MODE =
  String(import.meta.env.VITE_DEMO_MODE || '').toLowerCase() === 'true'

/** Accounts advertised on the login page. Must match backend/seed_demo.py. */
export const DEMO_ACCOUNTS = [
  { username: 'demo.admin', password: 'demo1234', role: 'Admin',
    blurb: 'Everything, plus user management and access codes' },
  { username: 'demo.tech',  password: 'demo1234', role: 'Technician',
    blurb: 'Claim, work and close any ticket' },
  { username: 'demo.user',  password: 'demo1234', role: 'Requester',
    blurb: 'File tickets and follow your own' },
]

/**
 * Is the API awake? Used to show a "waking up" notice during a free-tier
 * cold start rather than letting the page look broken.
 * Never throws — a failure just means "not reachable yet".
 */
export async function ping() {
  try {
    const res = await fetch(`${BASE}/health`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}

function getToken() {
  return localStorage.getItem('token')
}

/**
 * FastAPI returns validation errors (422) as an ARRAY of objects, not a
 * string. Passing that straight into new Error() produced "[object Object]",
 * and rendering it in JSX would crash React outright. This normalises any
 * error shape into readable text.
 */
function extractError(payload, fallback) {
  const detail = payload?.detail
  if (!detail) return fallback
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d) => {
        const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null
        const msg = (d.msg || '').replace(/^Value error,\s*/, '')
        return field && field !== 'body' ? `${field}: ${msg}` : msg
      })
      .filter(Boolean)
      .join(' · ') || fallback
  }
  return fallback
}

/**
 * A fetch that never resolves produces a bare TypeError("Failed to fetch"),
 * which tells the user nothing. In practice it means one of: the API is
 * asleep or down, or the browser blocked the response because the API's
 * CORS_ORIGINS doesn't list this exact origin — and note that
 * http://localhost and http://127.0.0.1 count as different origins.
 */
const NETWORK_ERROR =
  "Can't reach the server. It may still be waking up — try again in a moment."

async function safeFetch(url, options) {
  try {
    return await fetch(url, options)
  } catch {
    throw new Error(NETWORK_ERROR)
  }
}

async function request(path, options = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }
  const res = await safeFetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const payload = await res.json().catch(() => null)
    throw new Error(extractError(payload, res.statusText || 'Request failed'))
  }
  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json') ? res.json() : res
}

// ── Auth ─────────────────────────────────────────────────────────── //

export function login(username, password) {
  const body = new URLSearchParams({ username, password, grant_type: 'password' })
  return safeFetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).then(async (res) => {
    if (!res.ok) {
      const payload = await res.json().catch(() => null)
      throw new Error(extractError(payload, 'Login failed'))
    }
    return res.json()
  })
}

export const register = (name, email, password, requestedRole = '') =>
  request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ name, email, password, requested_role: requestedRole }),
  })

// ── Invite codes ──────────────────────────────────────────────────── //

export const listInvites = () => request('/invites')

export const createInvite = (data) =>
  request('/invites', { method: 'POST', body: JSON.stringify(data) })

export const revokeInvite = (id) =>
  request(`/invites/${id}`, { method: 'DELETE' })

export const redeemInvite = (code) =>
  request('/invites/redeem', { method: 'POST', body: JSON.stringify({ code }) })

export const listPendingRequests = () => request('/users/pending')

export const updateUserEmail = (id, email) =>
  request(`/users/${id}/email`, { method: 'PUT', body: JSON.stringify({ email }) })

export const updateUserRole = (id, role) =>
  request(`/users/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) })

// ── Users ─────────────────────────────────────────────────────────── //

export const getMe = () => request('/auth/me')

export const listUsers = () => request('/users')

export const resetUserPassword = (id, password) =>
  request(`/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) })

export const changeMyPassword = (password) =>
  request('/users/me/password', { method: 'PUT', body: JSON.stringify({ password }) })

export const createUser = (body) =>
  request('/users', { method: 'POST', body: JSON.stringify(body) })

export const deleteUser = (id) => request(`/users/${id}`, { method: 'DELETE' })

// ── Tickets ───────────────────────────────────────────────────────── //

export const listTickets = (params = {}) =>
  request(`/tickets?${new URLSearchParams(params)}`)

export const getTicket = (id) => request(`/tickets/${id}`)

export const createTicket = (data) =>
  request('/tickets', { method: 'POST', body: JSON.stringify(data) })

export const updateTicket = (id, data) =>
  request(`/tickets/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const deleteTicket = (id) => request(`/tickets/${id}`, { method: 'DELETE' })

export const claimTicket = (id) =>
  request(`/tickets/${id}/claim`, { method: 'POST' })

export const setTicketStatus = (id, status) =>
  request(`/tickets/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })

export async function exportCsv(params = {}) {
  const token = getToken()
  const res = await fetch(`${BASE}/tickets/export/csv?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'tickets.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export const getStats = () => request('/stats')

// ── Archive and trash ─────────────────────────────────────────────── //
//
// Closed tickets leave the dashboard after a grace period but are kept
// indefinitely and searchable here. Deleting one puts it in the trash,
// which empties itself after the retention window.

export const listArchive = (params = {}) =>
  request(`/tickets/archive?${new URLSearchParams(params)}`)

export const listTrash = () => request('/tickets/trash')

export const restoreTicket = (id) =>
  request(`/tickets/${id}/restore`, { method: 'POST' })

export const deleteTicketPermanently = (id) =>
  request(`/tickets/${id}/permanent`, { method: 'DELETE' })

export const purgeDeletedTickets = () =>
  request('/tickets/purge-deleted', { method: 'POST' })

// ── Comments ──────────────────────────────────────────────────────── //

export const listComments = (ticketId) => request(`/tickets/${ticketId}/comments`)

export const addComment = (ticketId, body) =>
  request(`/tickets/${ticketId}/comments`, { method: 'POST', body: JSON.stringify({ body }) })

export const deleteComment = (commentId) =>
  request(`/comments/${commentId}`, { method: 'DELETE' })

// ── Attachments ───────────────────────────────────────────────────── //

export const listAttachments = (ticketId) => request(`/tickets/${ticketId}/attachments`)

export async function uploadAttachment(ticketId, file) {
  const token = getToken()
  const fd = new FormData()
  fd.append('file', file)
  // Note: no Content-Type header — the browser sets the multipart boundary.
  const res = await fetch(`${BASE}/tickets/${ticketId}/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

export const deleteAttachment = (attachmentId) =>
  request(`/attachments/${attachmentId}`, { method: 'DELETE' })

export async function downloadAttachment(attachmentId, filename) {
  const token = getToken()
  const res = await fetch(`${BASE}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Download failed')
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Returns an object URL for inline image previews. Caller must revoke it. */
export async function fetchAttachmentBlobUrl(attachmentId) {
  const token = getToken()
  const res = await fetch(`${BASE}/attachments/${attachmentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error('Preview failed')
  return URL.createObjectURL(await res.blob())
}

// ── Knowledge base ────────────────────────────────────────────────── //

export const listArticles = (params = {}) =>
  request(`/articles?${new URLSearchParams(params)}`)

export const getArticle = (id) => request(`/articles/${id}`)

export const suggestArticles = (params = {}) =>
  request(`/articles/suggest?${new URLSearchParams(params)}`)

export const createArticle = (data) =>
  request('/articles', { method: 'POST', body: JSON.stringify(data) })

export const updateArticle = (id, data) =>
  request(`/articles/${id}`, { method: 'PUT', body: JSON.stringify(data) })

export const deleteArticle = (id) =>
  request(`/articles/${id}`, { method: 'DELETE' })