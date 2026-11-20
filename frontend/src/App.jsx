import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { ThemeProvider } from './context/ThemeContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { ConfirmProvider } from './context/ConfirmContext.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Navbar    from './components/Navbar.jsx'
import ChatWidget from './components/ChatWidget.jsx'
import Landing   from './pages/Landing.jsx'
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

function AppRoutes() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/"          element={<PublicLayout><Landing /></PublicLayout>} />

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
                <AppRoutes />
                {/* Sibling of the routes, so navigating doesn't remount it. */}
                <GlobalChat />
              </ErrorBoundary>
            </BrowserRouter>
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}