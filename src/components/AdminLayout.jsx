import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAdminAuth } from '../context/AdminAuthContext.jsx'

const navItems = [
  ['/quiz-generator', 'AI Quiz Generator', '+'],
  ['/dashboard', 'Dashboard', '▦'],
  ['/students', 'Students', '◎'],
  ['/modules', 'Modules', '◫'],
  ['/attempts', 'Attempts', '✓'],
]

export default function AdminLayout() {
  const [open, setOpen] = useState(false)
  const { user, signOut, demoMode } = useAdminAuth()
  const location = useLocation()
  const current = navItems.find(([path]) => location.pathname.startsWith(path))?.[1] || 'Admin'

  return (
    <div className="admin-app">
      <aside className={`admin-sidebar ${open ? 'is-open' : ''}`}>
        <div className="admin-brand">
          <div className="brand-icon brand-icon--admin">
          <img
            src="/images/teen_logo.png"
            alt="Teen Academy"
            className="admin-brand-logo"
          />
        </div>
          <div>
            <strong>Teen Academy</strong>
            <span>Admin Console</span>
          </div>
          <button className="mobile-close" onClick={() => setOpen(false)} aria-label="Close menu">×</button>
        </div>

        <nav className="admin-nav">
          {navItems.map(([path, label, icon]) => (
            <NavLink key={path} to={path} onClick={() => setOpen(false)} className={({ isActive }) => `admin-nav__item ${isActive ? 'is-active' : ''}`}>
              <span className="nav-glyph">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar__footer">
          {demoMode && <span className="demo-badge">Demo mode</span>}
          <div className="admin-account">
            <div className="avatar">A</div>
            <div>
              <strong>Administrator</strong>
              <span>{user?.email || 'Admin'}</span>
            </div>
          </div>
          <button className="secondary-button full-button" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      {open && <button className="sidebar-backdrop" onClick={() => setOpen(false)} aria-label="Close menu" />}

      <main className="admin-main">
        <header className="admin-topbar">
          <button className="menu-button" onClick={() => setOpen(true)} aria-label="Open menu">☰</button>
          <div>
            <span>Teen Quiz Admin</span>
            <strong>{current}</strong>
          </div>
          <div className="topbar-status"><i /> {demoMode ? 'Demo data' : 'Live data'}</div>
        </header>
        <div className="admin-content"><Outlet /></div>
      </main>
    </div>
  )
}
