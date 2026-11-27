import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { ConfirmProvider } from './context/ConfirmContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Navbar    from './components/Navbar.jsx'
import ChatWidget from './components/ChatWidget.jsx'
import TermsGate  from './components/TermsGate.jsx'
import Landing   from './pages/Landing.jsx'
import Terms     from './pages/Terms.jsx'
import Careers   from './pages/Careers.jsx'
import JobDetail from './pages/JobDetail.jsx'
import JobApply  from './pages/JobApply.jsx'
import Login     from './pages/Login.jsx'
import Register  from './pages/Register.jsx'
import Home      from './pages/Home.jsx'
import Dashboard from './pages/Dashboard.jsx'
import TicketDetail  from './pages/TicketDetail.jsx'
import Announcements from './pages/Announcements.jsx'
import Archive       from './pages/Archive.jsx'
import KnowledgeBase from './pages/KnowledgeBase.jsx'
import NewTicket     from './pages/NewTicket.jsx'
import Profile       from './pages/Profile.jsx'
import Redeem        from './pages/Redeem.jsx'
import Admin         from './pages/Admin.jsx'

// Public pages — always accessible, Navbar shown
function PublicLayout({ children }) {
  return (
    <div className="app-shell">
      <Navbar />
      <div className="page-content">{children}</div>
    </div>
  )
}

// Auth pages (login/register) — redirect to dashboard if already logged in
function AuthLayout({ children }) {
  const { user } = useAuth()
  return !user ? children : <Navigate to="/dashboard" replace />
}

// Private pages — redirect to login if not authenticated
function PrivateLayout({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return (
    <div className="app-shell">
      <Navbar />
      <div className="page-content">{children}</div>
    </div>
  )
}

// Admin-only pages — non-admins go home rather than hit a dead end
function AdminLayout({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'Both') return <Navigate to="/" replace />
  return (
    <div className="app-shell">
      <Navbar />
      <div className="page-content">{children}</div>
    </div>
  )
}

/**
 * Rendered once, beside the router rather than inside it.
 *
 * Every private route constructs its own <PrivateLayout>, so anything living
 * in that layout is unmounted and remounted on each navigation — which reset
 * the chat panel to collapsed and dropped the open thread. Out here it
 * survives route changes, which is the whole point of a persistent
 * messenger. It renders nothing when signed out.
 */
function GlobalChat() {
  const { user } = useAuth()
  return user ? <ChatWidget /> : null
}

/**
 * Stands between a signed-in account and the application.
 *
 * When the terms have changed, nothing else renders — not the routes, not
 * the chat widget — so there is no corner of the app reachable without
 * accepting first. Signed-out visitors are unaffected: they get the normal
 * routes, including the public /terms page.
 */
function Session() {
  const { user, termsRequired } = useAuth()

  if (user && termsRequired) return <TermsGate />

  return (
    <>
      <AppRoutes />
      {/* Sibling of the routes, so navigating doesn't remount it. */}
      <GlobalChat />
    </>
  )
}

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/"          element={<PublicLayout><Landing /></PublicLayout>} />
      {/* Public on purpose: terms have to be readable before you sign up. */}
      <Route path="/terms"     element={<PublicLayout><Terms /></PublicLayout>} />
      {/* Public on purpose: applicants have no account yet. */}
      <Route path="/careers"   element={<PublicLayout><Careers /></PublicLayout>} />
      <Route path="/careers/:slug" element={<PublicLayout><JobDetail /></PublicLayout>} />
      <Route path="/careers/:slug/apply" element={<PublicLayout><JobApply /></PublicLayout>} />

      {/* Auth */}
      <Route path="/login"     element={<AuthLayout><Login /></AuthLayout>} />
      <Route path="/register"  element={<AuthLayout><Register /></AuthLayout>} />

      {/* Private */}
      <Route path="/dashboard" element={<PrivateLayout><Home /></PrivateLayout>} />
      <Route path="/tickets"   element={<PrivateLayout><Dashboard /></PrivateLayout>} />
      <Route path="/tickets/:id" element={<PrivateLayout><TicketDetail /></PrivateLayout>} />
      <Route path="/announcements" element={<PrivateLayout><Announcements /></PrivateLayout>} />
      <Route path="/archive"   element={<PrivateLayout><Archive /></PrivateLayout>} />
      <Route path="/kb"        element={<PrivateLayout><KnowledgeBase /></PrivateLayout>} />
      <Route path="/new"       element={<PrivateLayout><NewTicket /></PrivateLayout>} />
      <Route path="/profile"   element={<PrivateLayout><Profile /></PrivateLayout>} />
      {/* Public: a scanned QR must work even when signed out, so the page
          itself handles the "please sign in first" case. */}
      <Route path="/redeem"    element={<Redeem />} />
      <Route path="/admin"     element={<AdminLayout><Admin /></AdminLayout>} />

      {/* Fallback */}
      <Route path="*"          element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <BrowserRouter>
              <ErrorBoundary>
                <Session />
              </ErrorBoundary>
            </BrowserRouter>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}