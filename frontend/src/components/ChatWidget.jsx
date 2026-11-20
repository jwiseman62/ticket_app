import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import * as api from '../api.js'
import { smartTime, fullTimestamp } from '../utils/dates.js'

/**
 * Poll intervals. Deliberately modest: the backend sleeps after 15 minutes
 * of silence on the free tier, so every poll is also a keep-alive, and a
 * tighter loop would burn the monthly instance-hour allowance for no
 * perceptible gain.
 */
const POLL_OPEN   = 3000    // a thread is on screen
const POLL_CLOSED = 15000   // just keeping the badge honest

/** Ask the browser whether anyone is actually looking. */
function useIsVisible() {
  const [visible, setVisible] = useState(
    () => (typeof document === 'undefined' ? true : !document.hidden),
  )
  useEffect(() => {
    const onChange = () => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

export default function ChatWidget() {
  const { user } = useAuth()
  const toast    = useToast()
  const visible  = useIsVisible()

  // PublicLayout and PrivateLayout have identical JSX, so it is easy to
  // mount this in the wrong one. Fail quietly instead of crashing the page.
  const isStaff = user?.role !== 'Requester'

  const [open,     setOpen]     = useState(false)
  const [threads,  setThreads]  = useState([])
  const [unread,   setUnread]   = useState(0)
  const [waiting,  setWaiting]  = useState(0)
  const [activeId, setActiveId] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft,    setDraft]    = useState('')
  const [sending,  setSending]  = useState(false)
  const [loading,  setLoading]  = useState(false)

  const scrollRef = useRef(null)
  const inputRef  = useRef(null)
  // Highest message id seen, so polling asks only for what's new.
  const lastIdRef = useRef(0)

  const active = threads.find((t) => t.id === activeId) || null

  // ── Badge / thread list ──
  const poll = useCallback(async () => {
    try {
      const data = await api.chatPoll()
      setThreads(data.conversations)
      setUnread(data.unread)
      setWaiting(data.waiting)
    } catch {
      // A failed poll is not worth a toast every few seconds — the next one
      // usually succeeds, and the server may just be waking up.
    }
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    poll()
    const ms = open ? POLL_OPEN : POLL_CLOSED
    const timer = setInterval(poll, ms)
    return () => clearInterval(timer)
  }, [poll, open, visible])

  // ── Messages in the open thread ──
  const pullMessages = useCallback(async (conversationId, reset = false) => {
    if (!conversationId) return
    try {
      const since = reset ? 0 : lastIdRef.current
      const rows = await api.listMessages(conversationId, since)
      if (reset) {
        setMessages(rows)
      } else if (rows.length) {
        setMessages((prev) => [...prev, ...rows])
      }
      if (rows.length) lastIdRef.current = rows[rows.length - 1].id
    } catch (err) {
      toast.error(err.message)
    }
  }, [toast])

  useEffect(() => {
    if (!open || !activeId || !visible) return undefined
    const timer = setInterval(() => pullMessages(activeId), POLL_OPEN)
    return () => clearInterval(timer)
  }, [open, activeId, visible, pullMessages])

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, open])

  async function openThread(id) {
    setActiveId(id)
    setLoading(true)
    lastIdRef.current = 0
    await pullMessages(id, true)
    setLoading(false)
    poll()
    inputRef.current?.focus()
  }

  // A requester has at most one live thread, so opening the widget should
  // drop them straight into it rather than showing a list of one.
  async function handleOpen() {
    setOpen(true)
    await poll()
  }

  useEffect(() => {
    if (!open || isStaff || activeId) return
    const mine = threads.find((t) => !t.closed_at)
    if (mine) openThread(mine.id)
    // openThread is stable enough for this one-shot; re-running on every
    // threads change would refetch the whole thread on each poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isStaff, activeId, threads])

  async function send(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    try {
      if (activeId) {
        const msg = await api.sendMessage(activeId, text)
        setMessages((prev) => [...prev, msg])
        lastIdRef.current = msg.id
      } else {
        // First message from a requester opens the thread.
        const convo = await api.startConversation({ body: text })
        setActiveId(convo.id)
        lastIdRef.current = 0
        await pullMessages(convo.id, true)
      }
      setDraft('')
      poll()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  async function handleClose() {
    if (!activeId) return
    try {
      await api.closeConversation(activeId)
      toast.success('Conversation closed.')
      setActiveId(null)
      setMessages([])
      poll()
    } catch (err) {
      toast.error(err.message)
    }
  }

  function backToList() {
    setActiveId(null)
    setMessages([])
    lastIdRef.current = 0
    poll()
  }

  // Enter sends, Shift+Enter makes a new line — what every chat box does.
  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(e)
    }
  }

  const badge = isStaff ? unread + waiting : unread

  if (!user) return null

  // ── Collapsed ──
  if (!open) {
    return (
      <button
        type="button"
        className="chat-bubble"
        onClick={handleOpen}
        aria-label={badge ? `Messages, ${badge} waiting` : 'Messages'}
      >
        <span aria-hidden="true">💬</span>
        {badge > 0 && <span className="chat-bubble-badge">{badge > 9 ? '9+' : badge}</span>}
      </button>
    )
  }

  const showList = isStaff && !activeId

  return (
    <section className="chat-panel" aria-label="Messages">
      <header className="chat-head">
        {activeId && isStaff && (
          <button type="button" className="chat-icon-btn" onClick={backToList}
                  aria-label="Back to all conversations">←</button>
        )}
        <div className="chat-head-text">
          <strong>
            {showList ? 'Messages'
              : active ? (isStaff ? active.requester : 'Helpdesk')
              : 'Helpdesk'}
          </strong>
          {!showList && active && (
            <span className="chat-head-sub">
              {active.technician
                ? (isStaff ? `with ${active.requester}` : `${active.technician} is helping`)
                : 'Waiting for a technician'}
            </span>
          )}
          {showList && waiting > 0 && (
            <span className="chat-head-sub">{waiting} waiting to be picked up</span>
          )}
        </div>
        {activeId && isStaff && (
          <button type="button" className="chat-icon-btn" onClick={handleClose}
                  title="Close this conversation">✓</button>
        )}
        <button type="button" className="chat-icon-btn" onClick={() => setOpen(false)}
                aria-label="Minimise messages">✕</button>
      </header>

      {/* ── Thread list (staff only) ── */}
      {showList ? (
        <div className="chat-body">
          {threads.length === 0 ? (
            <p className="chat-empty">No open conversations.</p>
          ) : (
            <ul className="chat-list">
              {threads.map((t) => (
                <li key={t.id}>
                  <button type="button" className="chat-list-item"
                          onClick={() => openThread(t.id)}>
                    <span className="chat-list-top">
                      <strong>{t.requester}</strong>
                      {!t.technician && <span className="chat-pill">New</span>}
                      {t.unread > 0 && <span className="chat-count">{t.unread}</span>}
                    </span>
                    <span className="chat-list-preview">
                      {t.last_sender === user.name && 'You: '}{t.last_message}
                    </span>
                    <span className="chat-list-time" title={fullTimestamp(t.updated_at)}>
                      {smartTime(t.updated_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="chat-body" ref={scrollRef}>
            {loading ? (
              <p className="chat-empty">Loading…</p>
            ) : messages.length === 0 ? (
              <p className="chat-empty">
                {isStaff
                  ? 'No messages yet.'
                  : 'Send a message and a technician will pick it up.'}
              </p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`chat-msg ${m.sender === user.name ? 'mine' : 'theirs'}`}
                >
                  {m.sender !== user.name && (
                    <span className="chat-msg-sender">{m.sender}</span>
                  )}
                  <span className="chat-msg-body">{m.body}</span>
                  <span className="chat-msg-time" title={fullTimestamp(m.created_at)}>
                    {smartTime(m.created_at)}
                  </span>
                </div>
              ))
            )}
          </div>

          <form className="chat-compose" onSubmit={send}>
            <textarea
              ref={inputRef}
              rows={1}
              value={draft}
              maxLength={2000}
              placeholder="Type a message…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button type="submit" className="btn btn-primary btn-sm"
                    disabled={sending || !draft.trim()}>
              {sending ? '…' : 'Send'}
            </button>
          </form>
        </>
      )}
    </section>
  )
}