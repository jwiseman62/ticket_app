import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function Navbar() {
  const { user, logout } = useAuth()
  const location         = useLocation()
  const [open, setOpen]  = useState(false)

  const links = [
    { to: '/',        label: 'Home' },
    { to: '/tickets', label: 'Tickets' },
  ]

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <span className="navbar-icon">🎫</span>
        <span className="navbar-title">IT Ticket System</span>
      </div>

      {/* Desktop links */}
      <div className={`navbar-links ${open ? 'open' : ''}`}>
        {links.map(({ to, label }) => (
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

      {/* User info + logout */}
      <div className="navbar-user">
        <span className="navbar-username">{user?.name}</span>
        <span className="navbar-role-badge">{user?.role}</span>
        <button className="btn btn-ghost btn-sm" onClick={logout}>Sign Out</button>
      </div>

      {/* Mobile hamburger */}
      <button
        className="navbar-hamburger"
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle menu"
      >
        {open ? '✕' : '☰'}
      </button>
    </nav>
  )
}
