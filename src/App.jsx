import { Navigate, Route, Routes } from 'react-router-dom'
import { useAdminAuth } from './context/AdminAuthContext.jsx'
import AdminLayout from './components/AdminLayout.jsx'
import LoginPage from './pages/LoginPage.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import StudentsPage from './pages/StudentsPage.jsx'
import StudentDetailsPage from './pages/StudentDetailsPage.jsx'
import ModulesPage from './pages/ModulesPage.jsx'
import ModuleDetailsPage from './pages/ModuleDetailsPage.jsx'
import AttemptsPage from './pages/AttemptsPage.jsx'
import AttemptDetailsPage from './pages/AttemptDetailsPage.jsx'
import NotFoundPage from './pages/NotFoundPage.jsx'

function ProtectedRoute() {
  const { loading, user, isAdmin } = useAdminAuth()
  if (loading) return <div className="loader-screen"><div className="spinner" />Checking admin access…</div>
  if (!user || !isAdmin) return <Navigate to="/login" replace />
  return <AdminLayout />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/students" element={<StudentsPage />} />
        <Route path="/students/:studentId" element={<StudentDetailsPage />} />
        <Route path="/modules" element={<ModulesPage />} />
        <Route path="/modules/:moduleName" element={<ModuleDetailsPage />} />
        <Route path="/attempts" element={<AttemptsPage />} />
        <Route path="/attempts/:attemptId" element={<AttemptDetailsPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
