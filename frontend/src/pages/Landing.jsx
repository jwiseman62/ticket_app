import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const FEATURES = [
  {
    icon: '🎫',
    title: 'Ticket Tracking',
    body: 'Create, assign, and resolve IT tickets in one place. Every change is logged with a full history trail.',
  },
  {
    icon: '👥',
    title: 'Role-Based Access',
    body: 'Requesters submit tickets, Technicians resolve them, and Admins oversee everything — each with the right permissions.',
  },
  {
    icon: '🔔',
    title: 'Email Notifications',
    body: 'Automatic email alerts fire when tickets are created or their status changes, keeping everyone in the loop.',
  },
  {
    icon: '📊',
    title: 'Live Dashboard',
    body: 'A real-time overview of open, in-progress, and closed tickets broken down by status and priority.',
  },
  {
    icon: '🔍',
    title: 'Search & Filter',
    body: 'Find any ticket instantly by title, requester, or technician. Filter by status, priority, or your personal queue.',
  },
  {
    icon: '📥',
    title: 'CSV Export',
    body: 'Export your current ticket view to a CSV file any time for reporting, auditing, or offline review.',
  },
]

export default function Landing() {
  const { user } = useAuth()

  return (
    <div className="landing">

      {/* Hero */}
      <section className="hero">
        <div className="hero-inner">
          <div className="hero-badge">Tech Help</div>

          <h1 className="hero-title">
            Submit your tickets <br />
            <span className="hero-accent">without the chaos.</span>
          </h1>

          <p className="hero-body">
            A simple, fast ticketing system for IT teams, IT freelancers, and anyone looking for a better way to fix their devices. Submit requests, track
            progress, assign technicians, and close issues — all in one place.
          </p>

          <div className="hero-ctas">
            {user ? (
              <>
                <Link to="/dashboard" className="btn btn-primary btn-lg">Go to Dashboard</Link>
                <Link to="/tickets"   className="btn btn-outline btn-lg">View Tickets</Link>
              </>
            ) : (
              <>
                <Link to="/register" className="btn btn-primary btn-lg">Get Started — it's free</Link>
                <Link to="/login"    className="btn btn-outline btn-lg">Sign In</Link>
              </>
            )}
          </div>

          <div className="hero-stats">
            <div className="hero-stat"><span>3</span> Roles</div>
            <div className="hero-stat-divider" />
            <div className="hero-stat"><span>Full</span> Audit History</div>
            <div className="hero-stat-divider" />
            <div className="hero-stat"><span>Email</span> Notifications</div>
            <div className="hero-stat-divider" />
            <div className="hero-stat"><span>CSV</span> Export</div>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="about-section">
        <div className="section-inner">
          <div className="section-label">About</div>
          <h2 className="section-title">Built for IT teams of any size</h2>
          <p className="section-body">
            Tech Mate gives your helpdesk a structured way to receive, track,
            and resolve requests. Whether you're a one-person IT department or a
            larger team, the role-based workflow keeps things clear — requesters
            submit issues, technicians work through them, and nothing falls through
            the cracks.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="features-section">
        <div className="section-inner">
          <div className="section-label">Features</div>
          <h2 className="section-title">Everything you need, nothing you don't</h2>

          <div className="features-grid">
            {FEATURES.map(({ icon, title, body }) => (
              <div key={title} className="feature-card">
                <div className="feature-icon">{icon}</div>
                <h3 className="feature-title">{title}</h3>
                <p className="feature-body">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="how-section">
        <div className="section-inner">
          <div className="section-label">How It Works</div>
          <h2 className="section-title">Simple from day one</h2>

          <div className="steps-row">
            <div className="step">
              <div className="step-number">1</div>
              <h3 className="step-title">Register an account</h3>
              <p className="step-body">Sign up in seconds. Pick your role — Requester, Technician, or Both.</p>
            </div>
            <div className="step-arrow">→</div>
            <div className="step">
              <div className="step-number">2</div>
              <h3 className="step-title">Submit a ticket</h3>
              <p className="step-body">Describe the issue, set a priority, assign a technician, and add a due date.</p>
            </div>
            <div className="step-arrow">→</div>
            <div className="step">
              <div className="step-number">3</div>
              <h3 className="step-title">Track and resolve</h3>
              <p className="step-body">Technicians update the status as they work. Every change is logged automatically.</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA banner */}
      <section className="cta-section">
        <div className="cta-inner">
          <h2 className="cta-title">Ready to get organised?</h2>
          <p className="cta-body">Create your account in under a minute.</p>
          <div className="hero-ctas">
            {user ? (
              <Link to="/dashboard" className="btn btn-primary btn-lg">Go to Dashboard</Link>
            ) : (
              <>
                <Link to="/register" className="btn btn-primary btn-lg">Create Free Account</Link>
                <Link to="/login"    className="btn btn-outline-white btn-lg">Sign In</Link>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="landing-footer">
        <div className="footer-inner">
          <span className="footer-brand">🎫 Tech Help</span>
          <div className="footer-links">
            <Link to="/login">Sign In</Link>
            <Link to="/register">Register</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
