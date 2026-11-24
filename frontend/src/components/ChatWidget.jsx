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

/** "Both" is this app's admin role; nobody says "both" out loud. */
function roleLabel(role) {
  return role === 'Both' ? 'Admin' : role
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

  // People picker
  const [picking, setPicking] = useState(false)
  const [people,  setPeople]  = useState([])
  const [search,  setSearch]  = useState('')
  // Set when starting a brand-new thread: null means "the helpdesk queue".
  const [target,  setTarget]  = useState(undefined)

  const scrollRef = useRef(null)
  const inputRef  = useRef(null)
  // Highest message id seen, so polling asks only for what's new.
  const lastIdRef = useRef(0)

  const active = threads.find((t) => t.id === activeId) || null
  const composing = target !== undefined

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
    const timer = setInterval(poll, open ? POLL_OPEN : POLL_CLOSED)
    return () => clearInterval(timer)
  }, [poll, open, visible])

  // ── Messages in the open thread ──
  const pullMessages = useCallback(async (conversationId, reset = false) => {
    if (!conversationId) return
    try {
      const rows = await api.listMessages(
        conversationId, reset ? 0 : lastIdRef.current,
      )
      if (reset) setMessages(rows)
      else if (rows.length) setMessages((prev) => [...prev, ...rows])
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

  // ── People picker ──
  useEffect(() => {
    if (!picking) return undefined
    const timer = setTimeout(() => {
      api.listChatPeople(search).then(setPeople).catch(() => {})
    }, 200)
    return () => clearTimeout(timer)
  }, [picking, search])

  async function openThread(id) {
    setActiveId(id)
    setTarget(undefined)
    setPicking(false)
    setLoading(true)
    lastIdRef.current = 0
    await pullMessages(id, true)
    setLoading(false)
    poll()
    inputRef.current?.focus()
  }

  /** Start composing to someone — or to the queue when `to` is null. */
  function composeTo(to) {
    // An open thread with this person already exists? Go there instead of
    // starting a second one the backend would only merge anyway.
    const existing = threads.find(
      (t) => !t.closed_at && (to === null ? t.kind === 'helpdesk' && !t.other
                                          : t.other === to),
    )
    if (existing) { openThread(existing.id); return }

    setActiveId(null)
    setMessages([])
    lastIdRef.current = 0
    setTarget(to)
    setPicking(false)
    setSearch('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }

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
        const convo = await api.startConversation({ to: target ?? '', body: text })
        setActiveId(convo.id)
        setTarget(undefined)
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
      backToList()
    } catch (err) {
      toast.error(err.message)
    }
  }

  function backToList() {
    setActiveId(null)
    setMessages([])
    setTarget(undefined)
    setPicking(false)
    setSearch('')
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

  /** What to call the other side of a thread in the list. */
  function threadName(t) {
    if (t.kind === 'helpdesk' && !t.other) {
      return isStaff ? t.requester : 'Helpdesk'
    }
    return t.other || 'Helpdesk'
  }

  const badge = isStaff ? unread + waiting : unread

  if (!user) return null

  // ── Collapsed ──
  if (!open) {
    return (
      <button
        type="button"
        className="chat-bubble"
        onClick={() => { setOpen(true); poll() }}
        aria-label={badge ? `Messages, ${badge} waiting` : 'Messages'}
      >
        <span aria-hidden="true">💬</span>
        {badge > 0 && <span className="chat-bubble-badge">{badge > 9 ? '9+' : badge}</span>}
      </button>
    )
  }

  const inThread = Boolean(activeId) || composing
  const headerName = composing
    ? (target === null ? 'Helpdesk' : target)
    : active ? threadName(active) : 'Messages'

  return (
    <section className="chat-panel" aria-label="Messages">
      <header className="chat-head">
        {(inThread || picking) && (
          <button type="button" className="chat-icon-btn" onClick={backToList}
                  aria-label="Back to all conversations">←</button>
        )}
        <div className="chat-head-text">
          <strong>{picking ? 'New message' : headerName}</strong>
          {!picking && inThread && active && (
            <span className="chat-head-sub">
              {active.kind === 'helpdesk' && !active.other
                ? (isStaff ? 'Waiting to be picked up' : 'Waiting for a technician')
                : roleLabel(active.other_role)}
            </span>
          )}
          {!picking && composing && (
            <span className="chat-head-sub">
              {target === null
                ? 'The first free technician will answer'
                : 'New conversation'}
            </span>
          )}
          {!picking && !inThread && waiting > 0 && (
            <span className="chat-head-sub">{waiting} waiting to be picked up</span>
          )}
        </div>
        {activeId && (
          <button type="button" className="chat-icon-btn" onClick={handleClose}
                  title="Close this conversation">✓</button>
        )}
        <button type="button" className="chat-icon-btn" onClick={() => setOpen(false)}
                aria-label="Minimise messages">✕</button>
      </header>

      {/* ── People picker ── */}
      {picking ? (
        <div className="chat-body">
          <input
            className="chat-search" type="search" autoFocus
            placeholder="Search people…"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          {!isStaff && (
            <button type="button" className="chat-person chat-person-helpdesk"
                    onClick={() => composeTo(null)}>
              <span className="chat-person-name">🛟 Helpdesk</span>
              <span className="chat-person-role">
                Whoever is free answers first
              </span>
            </button>
          )}
          {people.length === 0 ? (
            <p className="chat-empty">No one matches that.</p>
          ) : (
            people.map((p) => (
              <button key={p.name} type="button" className="chat-person"
                      onClick={() => composeTo(p.name)}>
                <span className="chat-person-name">{p.name}</span>
                <span className="chat-person-role">{roleLabel(p.role)}</span>
              </button>
            ))
          )}
        </div>
      ) : !inThread ? (
        /* ── Thread list ── */
        <>
          <div className="chat-body">
            {threads.length === 0 ? (
              <p className="chat-empty">
                No conversations yet. Start one below.
              </p>
            ) : (
              <ul className="chat-list">
                {threads.map((t) => (
                  <li key={t.id}>
                    <button type="button" className="chat-list-item"
                            onClick={() => openThread(t.id)}>
                      <span className="chat-list-top">
                        <strong>{threadName(t)}</strong>
                        {t.kind === 'helpdesk' && !t.other && isStaff &&
                          <span className="chat-pill">New</span>}
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
          <div className="chat-newbar">
            <button type="button" className="btn btn-primary btn-sm btn-block"
                    onClick={() => { setPicking(true); setPeople([]) }}>
              ✎ New message
            </button>
          </div>
        </>
      ) : (
        /* ── A conversation ── */
        <>
          <div className="chat-body" ref={scrollRef}>
            {loading ? (
              <p className="chat-empty">Loading…</p>
            ) : messages.length === 0 ? (
              <p className="chat-empty">
                {composing && target === null
                  ? 'Describe your problem and a technician will pick it up.'
                  : composing
                    ? `Say hello to ${target}.`
                    : 'No messages yet.'}
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