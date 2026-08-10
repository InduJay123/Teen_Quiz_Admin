import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { demoMode, supabase } from '../lib/supabase.js'

const AdminAuthContext = createContext(null)

export function AdminAuthProvider({ children }) {
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [error, setError] = useState('')

  async function verifyAdmin(nextUser) {
    if (demoMode) {
      setUser({ id: 'demo-admin', email: 'admin@teenacademy.lk' })
      setIsAdmin(true)
      setLoading(false)
      return
    }

    if (!nextUser || !supabase) {
      setUser(null)
      setIsAdmin(false)
      setLoading(false)
      return
    }

    setUser(nextUser)
    const { data, error: rpcError } = await supabase.rpc('admin_is_current_user')
    if (rpcError) {
      setError(rpcError.message)
      setIsAdmin(false)
    } else {
      setError('')
      setIsAdmin(Boolean(data))
    }
    setLoading(false)
  }

  useEffect(() => {
    if (demoMode) {
      verifyAdmin({ id: 'demo-admin' })
      return
    }
    if (!supabase) {
      setLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => verifyAdmin(data.session?.user || null))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setLoading(true)
      verifyAdmin(session?.user || null)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    setError('')
    if (demoMode) {
      setUser({ id: 'demo-admin', email: email || 'admin@teenacademy.lk' })
      setIsAdmin(true)
      return { ok: true }
    }
    if (!supabase) return { ok: false, error: 'Supabase is not configured.' }
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) return { ok: false, error: signInError.message }
    await verifyAdmin(data.user)
    const { data: allowed } = await supabase.rpc('admin_is_current_user')
    if (!allowed) {
      await supabase.auth.signOut()
      return { ok: false, error: 'This account is not an active Teen Academy admin.' }
    }
    return { ok: true }
  }

  async function signOut() {
    if (!demoMode && supabase) await supabase.auth.signOut()
    setUser(null)
    setIsAdmin(false)
  }

  const value = useMemo(() => ({ loading, user, isAdmin, error, signIn, signOut, demoMode }), [loading, user, isAdmin, error])
  return <AdminAuthContext.Provider value={value}>{children}</AdminAuthContext.Provider>
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext)
  if (!context) throw new Error('useAdminAuth must be used inside AdminAuthProvider')
  return context
}
