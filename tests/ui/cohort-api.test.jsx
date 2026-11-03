import { beforeEach, expect, it, vi } from 'vitest'
const transport = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../../src/lib/supabase.js', () => ({ demoMode: false, supabase: transport }))
import * as api from '../../src/lib/adminApi.js'

beforeEach(() => transport.rpc.mockReset().mockResolvedValue({ data: { rows: [], total: 0 }, error: null }))
it('keeps global module calls on their original RPC signatures', async () => {
  await api.listModules()
  expect(transport.rpc).toHaveBeenLastCalledWith('admin_list_modules', {})
  await api.getModule('Marketing')
  expect(transport.rpc).toHaveBeenLastCalledWith('admin_get_module', { p_module_name: 'Marketing' })
})
it('loads the cohort catalog, selector and overview from distinct real RPC contracts', async () => {
  await api.listCohortModules()
  expect(transport.rpc).toHaveBeenLastCalledWith('admin_list_cohort_modules', {})
  await api.getModuleCohorts('Marketing')
  expect(transport.rpc).toHaveBeenLastCalledWith('admin_get_module_cohorts', { p_module_name: 'Marketing' })
  await api.getModuleCohort('Marketing', 3)
  expect(transport.rpc).toHaveBeenLastCalledWith('admin_get_module', { p_module_name: 'Marketing', p_cohort_id: 3 })
})
it('sends profile search, student ID and pagination to the cohort students RPC', async () => {
  await api.listCohortStudents({moduleName:'Marketing',cohortId:2,search:'Amaya',studentId:'student-id',limit:25,offset:50})
  expect(transport.rpc).toHaveBeenCalledWith('admin_list_cohort_students', {
    p_module_name:'Marketing',p_cohort_id:2,p_search:'Amaya',p_student_id:'student-id',p_limit:25,p_offset:50,
  })
})
it('sends all attempt filters using SQL parameter names', async () => {
  await api.listCohortAttempts({moduleName:'Marketing',cohortId:2,search:'077',sessionId:'session-id',status:'submitted',sort:'score_desc',limit:25,offset:25,studentId:'student-id',resultsOnly:true})
  expect(transport.rpc).toHaveBeenCalledWith('admin_list_cohort_attempts', {
    p_module_name:'Marketing',p_cohort_id:2,p_search:'077',p_batch_id:'session-id',p_status:'submitted',p_sort:'score_desc',p_limit:25,p_offset:25,p_student_id:'student-id',p_results_only:true,
  })
})
it('scopes questions and answer review, with empty session filter normalized to null', async () => {
  await api.listCohortQuestions({moduleName:'Marketing',cohortId:3,sessionId:''})
  expect(transport.rpc).toHaveBeenLastCalledWith('admin_list_cohort_questions', {p_module_name:'Marketing',p_cohort_id:3,p_batch_id:null,p_limit:25,p_offset:0})
  await api.getCohortAttempt('Marketing',3,'attempt-id')
  expect(transport.rpc).toHaveBeenLastCalledWith('admin_get_cohort_attempt', {p_module_name:'Marketing',p_cohort_id:3,p_attempt_id:'attempt-id'})
})
it('returns server data and surfaces RPC errors without fabricated fallback data', async () => {
  const data={rows:[{id:'profile',username:'Real response'}],total:1}
  transport.rpc.mockResolvedValueOnce({data,error:null})
  expect(await api.listCohortStudents({moduleName:'Marketing',cohortId:1})).toEqual(data)
  transport.rpc.mockResolvedValueOnce({data:null,error:{message:'admin_access_required'}})
  await expect(api.getModuleCohort('Marketing',1)).rejects.toThrow('admin_access_required')
  expect(transport.rpc).toHaveBeenCalledTimes(2)
})
