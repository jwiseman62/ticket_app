import { useState, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'
import * as api from '../api.js'
import { useToast } from '../context/ToastContext.jsx'
import { useConfirm } from '../context/ConfirmContext.jsx'
import { formatDate, fullTimestamp } from '../utils/dates.js'

/** Rendered inside the Admin page as a panel (previously a modal). */
export default function InviteManager() {
  const toast   = useToast()
  const confirm = useConfirm()

  const [pending,  setPending]  = useState([])
  const [invites,  setInvites]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState(false)

  // The freshly-minted code we're showing a QR for
  const [issued,   setIssued]   = useState(null)
  const [qrUrl,    setQrUrl]    = useState('')

  // Manual issue form
  const [form, setForm] = useState({
    role: 'Technician', note: '', target_user: '', expires_days: 14, max_uses: 1,
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, i] = await Promise.all([
        api.listPendingRequests(),
        api.listInvites(),
      ])
      setPending(p)
      setInvites(i)
    } catch (e) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { load() }, [load])

  /** The URL the QR encodes — opens the redeem page with the code filled in. */
  function redeemUrl(code) {
    return `${window.location.origin}/redeem?code=${encodeURIComponent(code)}`
  }

  async function issue(overrides = {}) {
    setBusy(true)
    try {
      const payload = { ...form, ...overrides }
      const invite = await api.createInvite(payload)
      const url = await QRCode.toDataURL(redeemUrl(invite.code), {
        width: 280, margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
      })
      setIssued(invite)
      setQrUrl(url)
      setForm((f) => ({ ...f, note: '', target_user: '' }))
      toast.success(`Code ${invite.code} created.`)
      load()
    } catch (e) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(inv) {
    const ok = await confirm({
      title: `Revoke ${inv.code}?`,
      message: 'Anyone holding this code will no longer be able to use it.',
      confirmLabel: 'Revoke',
      danger: true,
    })
    if (!ok) return
    try {
      await api.revokeInvite(inv.id)
      toast.success('Code revoked.')
      load()
    } catch (e) {
      toast.error(e.message)
    }
  }

  function copy(text, label) {
    navigator.clipboard?.writeText(text)
      .then(() => toast.success(`${label} copied.`))
      .catch(() => toast.error('Could not copy — select it manually.'))
  }

  function downloadQr() {
    if (!qrUrl || !issued) return
    const a = document.createElement('a')
    a.href = qrUrl
    a.download = `access-code-${issued.code}.png`
    a.click()
  }

  function stateOf(inv) {
    if (inv.revoked) return 'revoked'
    if (inv.uses >= inv.max_uses) return 'used'
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) return 'expired'
    return 'active'
  }

  const set = (f) => (e) => setForm((p) => ({ ...p, [f]: e.target.value }))

  return (
    <div className="admin-panel">
        {/* ── The code we just made ── */}
        {issued && (
          <div className="issued-panel">
            <div className="issued-qr">
              {qrUrl && <img src={qrUrl} alt={`QR code for ${issued.code}`} />}
            </div>
            <div className="issued-detail">
              <div className="issued-label">Send this to the technician</div>
              <div className="issued-code">{issued.code}</div>
              <p className="issued-hint">
                They can scan the QR, or sign in and enter the code on the
                Redeem page. It unlocks <strong>{issued.role}</strong> access
                {issued.target_user && <> for <strong>{issued.target_user}</strong> only</>}
                {' '}and expires {formatDate(issued.expires_at)}.
              </p>
              <div className="issued-actions">
                <button className="btn btn-sm btn-secondary" onClick={downloadQr}>
                  ↓ Download QR
                </button>
                <button className="btn btn-sm btn-secondary"
                        onClick={() => copy(issued.code, 'Code')}>
                  Copy code
                </button>
                <button className="btn btn-sm btn-secondary"
                        onClick={() => copy(redeemUrl(issued.code), 'Link')}>
                  Copy link
                </button>
                <button className="btn btn-sm btn-ghost"
                        onClick={() => { setIssued(null); setQrUrl('') }}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {loading ? (
          <div className="list-placeholder">Loading…</div>
        ) : (
          <>
            {/* ── Pending requests ── */}
            <section className="invite-section">
              <h3 className="chart-title">
                Pending requests {pending.length > 0 && `(${pending.length})`}
              </h3>
              {pending.length === 0 ? (
                <p className="profile-hint">
                  Nobody is waiting for technician access right now.
                </p>
              ) : (
                <table className="users-table">
                  <thead>
                    <tr><th>Name</th><th>Email</th><th>Wants</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    {pending.map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td className="user-email">{u.email || '—'}</td>
                        <td><span className="navbar-role-badge">{u.requested_role}</span></td>
                        <td>
                          <button
                            className="btn btn-sm btn-primary" disabled={busy}
                            onClick={() => issue({
                              role: 'Technician',
                              target_user: u.name,
                              note: `Approved for ${u.name}`,
                            })}
                          >
                            Approve & generate code
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            {/* ── Issue manually ── */}
            <section className="invite-section">
              <h3 className="chart-title">Issue a code manually</h3>
              <p className="profile-hint">
                For someone who hasn't signed up yet, or to grant admin access.
              </p>
              <div className="invite-form">
                <div className="form-group">
                  <label htmlFor="inv-role">Grants</label>
                  <select id="inv-role" value={form.role} onChange={set('role')}>
                    <option value="Technician">Technician</option>
                    <option value="Both">Admin (Both)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="inv-target">Lock to username (optional)</label>
                  <input
                    id="inv-target" type="text" value={form.target_user}
                    placeholder="anyone if blank" onChange={set('target_user')}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="inv-note">Note</label>
                  <input
                    id="inv-note" type="text" value={form.note}
                    placeholder="who it's for" onChange={set('note')}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="inv-exp">Expires in (days)</label>
                  <input id="inv-exp" type="number" min="1" max="365"
                         value={form.expires_days} onChange={set('expires_days')} />
                </div>
                <button className="btn btn-primary" disabled={busy}
                        onClick={() => issue()}>
                  {busy ? 'Generating…' : 'Generate code'}
                </button>
              </div>
            </section>

            {/* ── Existing codes ── */}
            <section className="invite-section">
              <h3 className="chart-title">All codes</h3>
              {invites.length === 0 ? (
                <p className="profile-hint">No codes issued yet.</p>
              ) : (
                <table className="users-table">
                  <thead>
                    <tr>
                      <th>Code</th><th>Grants</th><th>For</th>
                      <th>Status</th><th>Expires</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((inv) => {
                      const state = stateOf(inv)
                      return (
                        <tr key={inv.id} className={state !== 'active' ? 'row-dim' : ''}>
                          <td><code className="invite-code-cell">{inv.code}</code></td>
                          <td>{inv.role}</td>
                          <td className="user-email">
                            {inv.target_user || inv.note || <span className="text-muted">anyone</span>}
                          </td>
                          <td>
                            <span className={`badge invite-state-${state}`}>{state}</span>
                            {inv.last_used_by && (
                              <div className="text-muted" style={{ fontSize: '.7rem' }}>
                                by {inv.last_used_by}
                              </div>
                            )}
                          </td>
                          <td className="text-muted" title={fullTimestamp(inv.expires_at)}>
                            {formatDate(inv.expires_at)}
                          </td>
                          <td>
                            {state === 'active' && (
                              <button className="btn btn-sm btn-danger"
                                      onClick={() => handleRevoke(inv)}>
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
    </div>
  )
}