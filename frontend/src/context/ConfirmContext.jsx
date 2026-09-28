import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'

const ConfirmContext = createContext(null)

/**
 * Drop-in replacement for window.confirm that returns a promise.
 *
 *   const confirm = useConfirm()
 *   if (!await confirm({ title: 'Delete this?', danger: true })) return
 *
 * Browsers suppress native dialogs once a page has shown several of them
 * ("Prevent this page from creating additional dialogs"), which makes
 * window.confirm silently return false and the action appear broken. This
 * renders real DOM instead, so it always works.
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)
  const resolver = useRef(null)
  const confirmBtn = useRef(null)

  const confirm = useCallback((options) => {
    const opts = typeof options === 'string' ? { message: options } : (options || {})
    return new Promise((resolve) => {
      resolver.current = resolve
      setState({
        title:        opts.title        || 'Are you sure?',
        message:      opts.message      || '',
        detail:       opts.detail       || '',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel:  opts.cancelLabel  || 'Cancel',
        danger:       opts.danger       ?? false,
      })
    })
  }, [])

  const settle = useCallback((result) => {
    resolver.current?.(result)
    resolver.current = null
    setState(null)
  }, [])

  useEffect(() => {
    if (!state) return
    confirmBtn.current?.focus()
    function onKey(e) {
      if (e.key === 'Escape') settle(false)
      if (e.key === 'Enter')  settle(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, settle])

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {state && (
        <div
          className="confirm-overlay"
          onClick={() => settle(false)}
          role="presentation"
        >
          <div
            className={`confirm-dialog ${state.danger ? 'confirm-danger' : ''}`}
            onClick={(e) => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
          >
            <h2 className="confirm-title" id="confirm-title">{state.title}</h2>

            {state.message && <p className="confirm-message">{state.message}</p>}
            {state.detail  && <p className="confirm-detail">{state.detail}</p>}

            <div className="confirm-actions">
              <button
                className="btn btn-secondary"
                onClick={() => settle(false)}
              >
                {state.cancelLabel}
              </button>
              <button
                ref={confirmBtn}
                className={`btn ${state.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => settle(true)}
              >
                {state.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>')
  }
  return ctx
}