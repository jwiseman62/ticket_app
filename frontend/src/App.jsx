import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import Navbar    from './components/Navbar.jsx'
import Login     from './pages/Login.jsx'
import Register  from './pages/Register.jsx'
import Home      from './pages/Home.jsx'
import Dashboard from './pages/Dashboard.jsx'

// Wraps all private pages: checks auth + adds Navbar
function PrivateLayout({ children }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return (
    <div className="app-shell">
      <Navbar />
      <div className="page-content">
        {children}
      </div>
    </div>
  )
}

function Public({ children }) {
  const { user } = useAuth()
  return !user ? children : <Navigate to="/" replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login"    element={<Public><Login /></Public>} />
      <Route path="/register" element={<Public><Register /></Public>} />
      <Route path="/"         element={<PrivateLayout><Home /></PrivateLayout>} />
      <Route path="/tickets"  element={<PrivateLayout><Dashboard /></PrivateLayout>} />
      <Route path="*"         element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
