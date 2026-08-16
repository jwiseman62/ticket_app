const BASE = '/api'

function getToken() {
  return localStorage.getItem('token')
}

async function request(path, options = {}) {
  const token = getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  }
  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail || 'Request failed')
  }
  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json') ? res.json() : res
}

// ── Auth ─────────────────────────────────────────────────────────── //

export function login(username, password) {
  const body = new URLSearchParams({ username, password, grant_type: 'password' })
  return fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || 'Login failed')
    }
    return res.json()
  })
}

export const register = (name, password, role) =>
  request('/auth/register', { method: 'POST', body: JSON.stringify({ name, password, role }) })

// ── Users ─────────────────────────────────────────────────────────── //

export const listUsers = () => request('/users')

export const resetUserPassword = (id, password) =>
  request(`/users/${id}/password`, { method: 'PUT', body: JSON.stringify({ password }) })

export const changeMyPassword = (password) =>
  request('/users/me/password', { method: 'PUT', body: JSON.stringify({ password }) })

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
