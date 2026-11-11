import { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react'

const ToastContext = createContext(null)

let nextId = 1

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    clearTimeout(timers.current[id])
    delete timers.current[id]
  }, [])

  const push = useCallback((message, type = 'info', duration = 4000) => {
    const id = nextId++
    setToasts((prev) => [...prev, { id, message, type }])
    timers.current[id] = setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  // Memoized so consumers can safely list `toast` in a useEffect/useCallback
  // dependency array. A fresh object each render would loop forever.
  const toast = useMemo(() => ({
    success: (msg, d) => push(msg, 'success', d),
    error:   (msg, d) => push(msg, 'error', d ?? 6000),  // errors linger
    info:    (msg, d) => push(msg, 'info', d),
    dismiss,
  }), [push, dismiss])

  const ICONS = { success: '✓', error: '✕', info: 'ℹ' }

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon">{ICONS[t.type]}</span>
            <span className="toast-message">{t.message}</span>
            <button
              className="toast-close"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Fail loudly in dev rather than silently swallowing notifications
    throw new Error('useToast must be used inside <ToastProvider>')
  }
  return ctx
}