import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import * as api from '../api.js'
import TermsContent, { LAST_UPDATED } from '../pages/TermsContent.jsx'
import { formatDate } from '../utils/dates.js'

/**
 * Shown in place of the whole application when the signed-in account has not
 * accepted the current terms — whatever their role, admins included.
 *
 * This is the visible half of the rule. The other half is in the backend's
 * get_current_user, which refuses every route but the three this screen
 * needs, so clearing the flag in devtools gets you an empty application
 * rather than a working one.
 */
export default function TermsGate() {
  const { user, logout, markTermsAccepted } = useAuth()
  const toast = useToast()

  const [atEnd,  setAtEnd]  = useState(false)
  const [saving, setSaving] = useState(false)
  const [since,  setSince]  = useState(null)   // null until /terms/status answers

  const boxRef = useRef(null)

  // Why are they seeing this? Worth one cheap request to get the wording
  // right, rather than telling a brand-new account the terms "have changed".
  useEffect(() => {
    let cancelled = false
    api.termsStatus()
      .then((s) => { if (!cancelled) setSince(s.accepted_at || '') })
      .catch(() => { if (!cancelled) setSince('') })
    return () => { cancelled = true }
  }, [])

  /* Enable the button only once they have reached the end of the text.
     Deliberately one-way: having read it, scrolling back up to re-read a
     section shouldn't take the button away again. */
  const checkScrolled = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    // 8px of slack — sub-pixel line heights and browser zoom mean these
    // numbers rarely land exactly equal, and being a pixel short should not
    // strand someone on a screen they cannot leave.
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) setAtEnd(true)
  }, [])

  // On a tall screen the text may not scroll at all, in which case it has
  // been "read" the moment it appears. Re-checked on resize for the same
  // reason: rotating a phone can remove the scrollbar.
  useEffect(() => {
    checkScrolled()
    window.addEventListener('resize', checkScrolled)
    return () => window.removeEventListener('resize', checkScrolled)
  }, [checkScrolled])

  async function accept() {
    if (!atEnd || saving) return
    setSaving(true)
    try {
      await api.acceptTerms()
      markTermsAccepted()      // unmounts this screen; no need to unset saving
    } catch (err) {
      toast.error(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="gate-screen" role="dialog" aria-modal="true"
         aria-labelledby="gate-title">
      <div className="gate-card">
        <header className="gate-head">
          <h1 id="gate-title">Terms of Service</h1>
          <p className="gate-lede">
            {since === null
              ? 'Please read these before continuing.'
              : since
                ? <>These terms have been updated since you accepted them
                    on {formatDate(since)}. Please read the new version to
                    continue.</>
                : <>Before you can use Tech Help, please read and accept the
                    terms of service.</>}
          </p>
          <p className="gate-meta">
            Last updated {LAST_UPDATED}
            {user?.name && <> · signed in as <strong>{user.name}</strong></>}
          </p>
        </header>

        <div className="gate-body legal-inner" ref={boxRef} onScroll={checkScrolled}
             tabIndex={0} aria-label="Terms of service">
          <TermsContent />
        </div>

        <footer className="gate-foot">
          <p className="gate-hint" aria-live="polite">
            {atEnd
              ? 'Thanks for reading.'
              : 'Scroll to the end of the terms to continue.'}
          </p>
          <div className="gate-actions">
            <button type="button" className="btn btn-ghost" onClick={logout}>
              Sign out
            </button>
            <button type="button" className="btn btn-primary"
                    onClick={accept} disabled={!atEnd || saving}>
              {saving ? 'Saving…' : 'I accept these terms'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}