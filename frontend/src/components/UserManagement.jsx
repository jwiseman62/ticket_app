import { useState, useEffect, useRef, useCallback } from 'react'
import * as api from '../api.js'

const ROLES = ['Requester', 'Technician', 'Both']
const MIN_PASSWORD = 8
const BLANK_DRAFT = { name: '', email: '', password: '', role: 'Requester' }

const ROLE_LABEL = {
  Requester:  'Requester',
  Technician: 'Technician',
  Both:       'Admin',
}

const ROLE_HELP = {
  Requester:  'Can file and view their own tickets',
  Technician: 'Can work, close, and delete any ticket',
  Both:       'Full admin — manages users and the knowledge base',
}

/**
 * NOTE: this component deliberately uses no window.prompt / window.confirm.
 * Browsers suppress those dialogs once a page has shown several of them
 * (Chrome's "Prevent this page from creating additional dialogs"), which made
 * the buttons silently do nothing. Everything below is inline UI instead.
 */
/** Rendered inside the Admin page as a panel (previously a modal). */
export default function UserManagement({ currentUser }) {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [message, setMessage] = useState('')
  const [busyId,  setBusyId]  = useState(null)

  // Inline email editing
  const [editingId,  setEditingId]  = useState(null)
  const [emailDraft, setEmailDraft] = useState('')
  const emailInput = useRef(null)

  // Row-level panels: { type: 'password' | 'delete', userId }
  const [panel, setPanel] = useState(null)
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')

  // New-account form
  const [creating,  setCreating]  = useState(false)
  const [draft,     setDraft]     = useState(BLANK_DRAFT)
  const [createBusy, setCreateBusy] = useState(false)
  const nameInput = useRef(null)

  useEffect(() => {
    api.listUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (editingId !== null) emailInput.current?.focus()
  }, [editingId])

  useEffect(() => {
    if (creating) nameInput.current?.focus()
  }, [creating])

  // Stable identity: the Escape handler lists it as a dependency, and a
  // function rebuilt each render would re-bind that listener every time.
  const cancelCreate = useCallback(() => {
    setCreating(false)
    setDraft(BLANK_DRAFT)
    setError('')
  }, [])

  // Escape closes whatever is open
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape') return
      if (editingId !== null) { setEditingId(null); return }
      if (panel) { closePanel(); return }
      if (creating) { cancelCreate() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingId, panel, creating, cancelCreate])

  function flash(msg) {
    setMessage(msg)
    setError('')
  }

  function closePanel() {
    setPanel(null)
    setPw1('')
    setPw2('')
  }

  // ── Email ─────────────────────────────────────────────────────── //

  function startEmailEdit(user) {
    setEditingId(user.id)
    setEmailDraft(user.email || '')
    setError('')
  }

  async function saveEmail(user) {
    const next = emailDraft.trim()
    if (!next) { setError('Email cannot be empty.'); return }

    setBusyId(user.id)
    try {
      const updated = await api.updateUserEmail(user.id, next)
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      setEditingId(null)
      flash(`Email saved for ${user.name}.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  // ── Role ──────────────────────────────────────────────────────── //

  async function handleRoleChange(user, role) {
    if (role === user.role) return
    setBusyId(user.id)
    try {
      const updated = await api.updateUserRole(user.id, role)
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      flash(`${user.name} is now ${role}.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  // ── Password ──────────────────────────────────────────────────── //

  async function submitPassword(user) {
    if (pw1.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (pw1 !== pw2) {
      setError('Passwords do not match.')
      return
    }
    setBusyId(user.id)
    try {
      await api.resetUserPassword(user.id, pw1)
      closePanel()
      flash(`Password updated for ${user.name}.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  // ── Create ────────────────────────────────────────────────────── //

  function setField(key, value) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  const draftValid =
    draft.name.trim().length >= 2 &&
    draft.email.trim().includes('@') &&
    draft.password.length >= MIN_PASSWORD

  async function submitCreate(e) {
    e.preventDefault()
    if (!draftValid || createBusy) return
    setCreateBusy(true)
    setError('')
    try {
      const created = await api.createUser({
        name: draft.name.trim(),
        email: draft.email.trim(),
        password: draft.password,
        role: draft.role,
      })
      // Keep the table in the order the server would return it.
      setUsers((prev) => [...prev, created].sort((a, b) => a.id - b.id))
      setCreating(false)
      setDraft(BLANK_DRAFT)
      flash(`Created ${created.name} as ${ROLE_LABEL[created.role]}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setCreateBusy(false)
    }
  }

  // ── Delete ────────────────────────────────────────────────────── //

  async function confirmDelete(user) {
    setBusyId(user.id)
    try {
      const res = await api.deleteUser(user.id)
      setUsers((prev) => prev.filter((u) => u.id !== user.id))
      closePanel()
      const n = res?.unassigned_tickets ?? 0
      flash(
        `Deleted ${user.name}.` +
        (n > 0 ? ` ${n} ticket${n === 1 ? '' : 's'} unassigned.` : '')
      )
    } catch (e) {
      setError(e.message)
    } finally {
      setBusyId(null)
    }
  }

  const adminCount   = users.filter((u) => u.role === 'Both').length
  const missingEmail = users.filter((u) => !u.email).length

  return (
    <div className="admin-panel">
        {error   && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        <div className="users-toolbar">
          <p className="modal-intro">
            New sign-ups always start as Requesters. Grant Technician or Admin
            access here, or create an account outright.
          </p>
          {!creating && (
            <button type="button" className="btn btn-primary btn-sm"
                    onClick={() => { setCreating(true); setError('') }}>
              ＋ New account
            </button>
          )}
        </div>

        {creating && (
          <form className="user-create" onSubmit={submitCreate}>
            <div className="user-create-grid">
              <label className="form-group">
                <span>Username</span>
                <input
                  ref={nameInput} type="text" value={draft.name}
                  autoComplete="off" placeholder="sam.patel"
                  onChange={(e) => setField('name', e.target.value)}
                />
              </label>

              <label className="form-group">
                <span>Email</span>
                <input
                  type="email" value={draft.email}
                  autoComplete="off" placeholder="sam@example.com"
                  onChange={(e) => setField('email', e.target.value)}
                />
              </label>

              <label className="form-group">
                <span>Temporary password</span>
                <input
                  type="text" value={draft.password}
                  autoComplete="new-password"
                  placeholder={`at least ${MIN_PASSWORD} characters`}
                  onChange={(e) => setField('password', e.target.value)}
                />
              </label>

              <label className="form-group">
                <span>Role</span>
                <select value={draft.role}
                        onChange={(e) => setField('role', e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
              </label>
            </div>

            <p className="user-create-help">{ROLE_HELP[draft.role]}</p>

            {/* Shown in the clear on purpose: the admin has to pass it on,
                and it is meant to be changed on first sign-in. */}
            <p className="user-create-note">
              The password is visible so you can share it. Ask them to change it
              from their profile once they are in.
            </p>

            <div className="user-create-actions">
              <button type="submit" className="btn btn-primary btn-sm"
                      disabled={!draftValid || createBusy}>
                {createBusy ? 'Creating…' : 'Create account'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm"
                      onClick={cancelCreate}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {!loading && missingEmail > 0 && (
          <div className="alert alert-warn">
            {missingEmail} account{missingEmail === 1 ? '' : 's'} without an email
            will not receive ticket notifications. Click an email cell to add one.
          </div>
        )}

        {loading ? (
          <div className="list-placeholder">Loading users…</div>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf      = u.name === currentUser.name
                const isLastAdmin = u.role === 'Both' && adminCount <= 1
                const busy        = busyId === u.id
                const openPanel   = panel?.userId === u.id ? panel.type : null

                return [
                  <tr key={u.id} className={busy ? 'row-busy' : ''}>
                    <td>
                      {u.name}
                      {isSelf && <span className="self-tag">you</span>}
                    </td>

                    {/* Email — inline editable */}
                    <td className="user-email">
                      {editingId === u.id ? (
                        <div className="email-editor">
                          <input
                            ref={emailInput}
                            type="email"
                            value={emailDraft}
                            placeholder="name@example.com"
                            onChange={(e) => setEmailDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); saveEmail(u) }
                              if (e.key === 'Escape') setEditingId(null)
                            }}
                          />
                          <button
                            type="button" className="icon-btn icon-btn-ok"
                            onClick={() => saveEmail(u)} disabled={busy}
                            aria-label="Save email" title="Save"
                          >✓</button>
                          <button
                            type="button" className="icon-btn"
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel" title="Cancel"
                          >✕</button>
                        </div>
                      ) : (
                        <button
                          type="button" className="email-edit" disabled={busy}
                          onClick={() => startEmailEdit(u)} title="Click to edit"
                        >
                          {u.email || <span className="email-missing">add email</span>}
                        </button>
                      )}
                    </td>

                    <td>
                      <select
                        value={u.role}
                        disabled={busy || isLastAdmin}
                        title={isLastAdmin ? 'Promote another admin first' : ROLE_HELP[u.role]}
                        onChange={(e) => handleRoleChange(u, e.target.value)}
                      >
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </td>

                    <td className="user-actions">
                      <button
                        className="btn btn-sm btn-secondary" disabled={busy}
                        onClick={() =>
                          setPanel(openPanel === 'password' ? null : { type: 'password', userId: u.id })
                        }
                      >
                        Reset PW
                      </button>
                      {!isSelf && !isLastAdmin && (
                        <button
                          className="btn btn-sm btn-danger" disabled={busy}
                          onClick={() =>
                            setPanel(openPanel === 'delete' ? null : { type: 'delete', userId: u.id })
                          }
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>,

                  /* Password panel */
                  openPanel === 'password' && (
                    <tr key={`${u.id}-pw`} className="panel-row">
                      <td colSpan={4}>
                        <div className="row-panel">
                          <div className="row-panel-title">
                            Set a new password for <strong>{u.name}</strong>
                          </div>
                          <div className="row-panel-fields">
                            <input
                              type="password" autoFocus placeholder="New password"
                              value={pw1} onChange={(e) => setPw1(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && submitPassword(u)}
                            />
                            <input
                              type="password" placeholder="Confirm password"
                              value={pw2} onChange={(e) => setPw2(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && submitPassword(u)}
                            />
                            <button className="btn btn-sm btn-primary" disabled={busy}
                                    onClick={() => submitPassword(u)}>
                              Save
                            </button>
                            <button className="btn btn-sm btn-secondary" onClick={closePanel}>
                              Cancel
                            </button>
                          </div>
                          <div className="row-panel-hint">
                            At least {MIN_PASSWORD} characters.
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),

                  /* Delete confirmation panel */
                  openPanel === 'delete' && (
                    <tr key={`${u.id}-del`} className="panel-row">
                      <td colSpan={4}>
                        <div className="row-panel row-panel-danger">
                          <div className="row-panel-title">
                            Delete <strong>{u.name}</strong>?
                          </div>
                          <div className="row-panel-hint">
                            Tickets assigned to them will be unassigned. Tickets
                            they filed are kept as a historical record. This
                            cannot be undone.
                          </div>
                          <div className="row-panel-fields">
                            <button className="btn btn-sm btn-danger" disabled={busy}
                                    onClick={() => confirmDelete(u)}>
                              {busy ? 'Deleting…' : 'Yes, delete'}
                            </button>
                            <button className="btn btn-sm btn-secondary" onClick={closePanel}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ),
                ].filter(Boolean)
              })}
            </tbody>
          </table>
        )}
    </div>
  )
}