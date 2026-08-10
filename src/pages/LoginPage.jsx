import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'

export default function LoginPage() {
  const { user, isAdmin, signIn, demoMode } = useAdminAuth()
  const [email, setEmail] = useState(demoMode ? 'admin@teenacademy.lk' : '')
  const [password, setPassword] = useState(demoMode ? 'demo1234' : '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (user && isAdmin) navigate('/dashboard', { replace: true })
  }, [user, isAdmin, navigate])

  if (user && isAdmin) return <Navigate to="/dashboard" replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const result = await signIn(email, password)
    setBusy(false)
    if (!result.ok) setError(result.error)
  }

  return (
    <div className="auth-page admin-auth-page">
      <div className="auth-orb auth-orb--one" />
      <div className="auth-orb auth-orb--two" />
      <form className="auth-card admin-login-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-icon brand-icon--admin">
          <img
            src="/images/teen_logo.png"
            alt="Teen Academy"
            className="admin-brand-logo"
          />
        </div>
          <div><strong>Teen Academy</strong><span>Quiz Administration</span></div>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">Admin access</span>
          <h1>Student performance</h1>
         </div>
        {error && <div className="form-error">{error}</div>}
        {demoMode && <div className="notice demo-notice">Demo mode is enabled. Any email/password will open the dashboard.</div>}
        <label className="field-label"><span>Email</span><input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="admin@teenacademy.lk" required /></label>
        <label className="field-label"><span>Password</span><input value={password} onChange={(e) => setPassword(e.target.value)} type="password" placeholder="••••••••" required /></label>
        <button className="primary-button full-button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
