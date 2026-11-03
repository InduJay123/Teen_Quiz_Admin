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

// Never fall back to unscoped RPCs for cohort data.
async function cohortRpc(name, args) {
  if (demoMode) throw new Error('Cohort analytics require the configured database. Set VITE_DEMO_MODE=false to use live cohort data.')
  if (!supabase) throw new Error('Supabase is not configured.')
  return rpc(name, args)
}
export const listCohortModules = () => cohortRpc('admin_list_cohort_modules', {})
export const getModuleCohorts = moduleName => cohortRpc('admin_get_module_cohorts', { p_module_name: moduleName })
export const getModuleCohort = (moduleName, cohortId) => cohortRpc('admin_get_module', { p_module_name: moduleName, p_cohort_id: cohortId })
export const listCohortStudents = ({ moduleName, cohortId, search = '', limit = 25, offset = 0, studentId = null }) =>
  cohortRpc('admin_list_cohort_students', { p_module_name: moduleName, p_cohort_id: cohortId, p_search: search, p_limit: limit, p_offset: offset, p_student_id: studentId })
export const listCohortAttempts = ({ moduleName, cohortId, search = '', sessionId = null, status = null, sort = 'submitted_desc', limit = 25, offset = 0, studentId = null, resultsOnly = false }) =>
  cohortRpc('admin_list_cohort_attempts', { p_module_name: moduleName, p_cohort_id: cohortId, p_search: search, p_batch_id: sessionId || null, p_status: status || null, p_sort: sort, p_limit: limit, p_offset: offset, p_student_id: studentId, p_results_only: resultsOnly })
export const listCohortQuestions = ({ moduleName, cohortId, sessionId = null, limit = 25, offset = 0 }) =>
  cohortRpc('admin_list_cohort_questions', { p_module_name: moduleName, p_cohort_id: cohortId, p_batch_id: sessionId || null, p_limit: limit, p_offset: offset })
export const getCohortAttempt = (moduleName, cohortId, attemptId) =>
  cohortRpc('admin_get_cohort_attempt', { p_module_name: moduleName, p_cohort_id: cohortId, p_attempt_id: attemptId })
