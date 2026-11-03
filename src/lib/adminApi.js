import { demoMode, supabase } from './supabase.js'
import { demo } from '../data/demo.js'

async function rpc(name, args = {}) {
  if (demoMode) return null
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(error.message)
  return data
}

export async function getDashboard() {
  return demoMode ? demo.dashboard : rpc('admin_dashboard_stats')
}

export async function listStudents({ search = '', limit = 50, offset = 0 } = {}) {
  if (demoMode) {
    const filtered = demo.students.filter((s) => s.username.toLowerCase().includes(search.toLowerCase()))
    return { rows: filtered.slice(offset, offset + limit), total: filtered.length }
  }
  return rpc('admin_list_students', { p_search: search, p_limit: limit, p_offset: offset })
}

export async function getStudent(studentId) {
  return demoMode ? demo.student(studentId) : rpc('admin_get_student', { p_student_id: studentId })
}

export async function listModules() {
  return demoMode ? demo.modules : rpc('admin_list_modules')
}

export async function getModule(moduleName) {
  return demoMode ? demo.module(moduleName) : rpc('admin_get_module', { p_module_name: moduleName })
}

export async function listAttempts({ search = '', module = '', limit = 50, offset = 0 } = {}) {
  if (demoMode) {
    let rows = demo.attempts
    if (search) rows = rows.filter((a) => a.username.toLowerCase().includes(search.toLowerCase()))
    if (module) rows = rows.filter((a) => a.module_name === module)
    return { rows: rows.slice(offset, offset + limit), total: rows.length }
  }
  return rpc('admin_list_attempts', { p_search: search, p_module_name: module || null, p_limit: limit, p_offset: offset })
}

export async function getAttempt(attemptId) {
  return demoMode ? demo.attempt(attemptId) : rpc('admin_get_attempt', { p_attempt_id: attemptId })
}
