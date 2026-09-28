import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'

export default function Navbar() {
  const { user, logout }       = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location               = useLocation()
  const [open, setOpen]        = useState(false)

  const privateLinks = [
    { to: '/',          label: 'Home' },
    { to: '/dashboard', label: 'Dashboard' },
    { to: '/tickets',   label: 'Tickets'   },
    { to: '/kb',        label: 'Knowledge Base' },
    // Admin tools live on their own page rather than cluttering the sidebar
    ...(user?.role === 'Both' ? [{ to: '/admin', label: 'Admin' }] : []),
  ]

  const isDark = theme === 'dark'

  return (
    <nav className="navbar">
      {/* Brand — always goes home */}
      <Link to="/" className="navbar-brand" onClick={() => setOpen(false)}>
        <span className="navbar-icon">🎫</span>
        <span className="navbar-title">Tech Help</span>
      </Link>

      {/* ── Logged-in nav ── */}
      {user && (
        <div className={`navbar-links ${open ? 'open' : ''}`}>
          {privateLinks.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`nav-link ${location.pathname === to ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            >
              {label}
            </Link>
          ))}
        </div>
      )}

      {/* ── Logged-out nav ── */}
      {!user && (
        <div className={`navbar-links ${open ? 'open' : ''}`}>
          <Link to="/login" className="nav-link" onClick={() => setOpen(false)}>
            Sign In
          </Link>
          <Link to="/register" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>
            Get Started
          </Link>
        </div>
      )}

      {/* ── Right-hand controls ── */}
      <div className="navbar-right">
        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
          title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
        >
          {isDark ? '☀️' : '🌙'}
        </button>

        {user && (
          <>
            <Link to="/new" className="btn btn-primary btn-sm navbar-cta">
              ＋ Get help
            </Link>
            <div className="navbar-user">
              <Link to="/profile" className="navbar-username" title="Your profile">
                {user.name}
              </Link>
              <span className="navbar-role-badge">{user.role}</span>
              <button className="btn btn-ghost btn-sm" onClick={logout}>Sign Out</button>
            </div>
          </>
        )}

        {/* Hamburger — mobile only */}
        <button
          className="navbar-hamburger"
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle menu"
        >
          {open ? '✕' : '☰'}
        </button>
      </div>
    </nav>
  )
}