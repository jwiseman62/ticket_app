import { useState, useEffect } from 'react'
import * as api from '../api.js'

export default function UserManagement({ onClose, currentUser }) {
  const [users,   setUsers]   = useState([])
  const [error,   setError]   = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    api.listUsers().then(setUsers).catch((e) => setError(e.message))
  }, [])

  async function handleDelete(u) {
    if (u.name === currentUser.name) { alert('Cannot delete your own account.'); return }
    if (!window.confirm(`Delete user '${u.name}'?\nTickets are not deleted.`)) return
    try {
      await api.deleteUser(u.id)
      setUsers((prev) => prev.filter((x) => x.id !== u.id))
      setMessage(`User '${u.name}' deleted.`)
      setError('')
    } catch (e) { setError(e.message) }
  }

  async function handleReset(u) {
    const pw  = window.prompt(`New password for '${u.name}':`)
    if (!pw) return
    const pw2 = window.prompt('Confirm new password:')
    if (pw !== pw2) { alert('Passwords do not match.'); return }
    try {
      await api.resetUserPassword(u.id, pw)
      setMessage(`Password for '${u.name}' updated.`)
      setError('')
    } catch (e) { setError(e.message) }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>User Management</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {error   && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}

        <table className="users-table">
          <thead>
            <tr><th>Name</th><th>Role</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.role}</td>
                <td className="user-actions">
                  <button className="btn btn-sm btn-secondary" onClick={() => handleReset(u)}>
                    Reset PW
                  </button>
                  {u.name !== currentUser.name && (
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(u)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
