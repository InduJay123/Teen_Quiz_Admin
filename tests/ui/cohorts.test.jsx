import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import ModuleDetailsPage from '../../src/pages/ModuleDetailsPage.jsx'
import { colomboDate } from '../../src/components/CohortContent.jsx'
import * as api from '../../src/lib/adminApi.js'
vi.mock('../../src/lib/adminApi.js',()=>({getModuleCohorts:vi.fn(),getModuleCohort:vi.fn(),listCohortStudents:vi.fn(),listCohortAttempts:vi.fn(),listCohortQuestions:vi.fn(),getCohortAttempt:vi.fn()}))
const cohorts=[{id:1,display_name:'Batch 1'},{id:2,display_name:'Batch 2'},{id:3,display_name:'Batch 3'},{id:17,display_name:'Weekend group'}]
const summary=id=>({cohort_id:id,overview:{total_students:id,session_count:1,question_count:30,total_attempts:0,completed_attempts:0,pending_attempts:0,average_score:0,best_score:0,students_attempted:0,students_not_attempted:id},sessions:[{batch_id:`session-${id}`,session_name:`Session for ${id}`,unlock_at:'2026-11-03T20:00:00Z',session_date:'2026-11-04',published:true,question_count:30,bank_size_target:40,total_attempts:0,completed_attempts:0,students_attempted:0,average_score:0,best_score:0}]})
const student=id=>({id:`student-${id}`,username:`Member of ${id}`,phone:`077000000${id}`,age:14,attempts:0,sessions_attempted:0,sessions_not_attempted:1,average_score:0,best_score:0,completion_status:'not_started'})
function Location(){return <output data-testid="url">{useLocation().search}</output>}
function renderPage(query='cohort=1&tab=overview') {return render(<MemoryRouter initialEntries={[`/modules/Marketing?${query}`]}><Location/><Routes><Route path="/modules/:moduleName" element={<ModuleDetailsPage/>}/></Routes></MemoryRouter>)}
beforeEach(()=>{
  vi.resetAllMocks()
  api.getModuleCohorts.mockResolvedValue({module_name:'Marketing',cohorts})
  api.getModuleCohort.mockImplementation(async(_,id)=>summary(id))
  api.listCohortStudents.mockImplementation(async({cohortId})=>({rows:[student(cohortId)],total:1}))
  api.listCohortAttempts.mockResolvedValue({rows:[],total:0})
  api.listCohortQuestions.mockResolvedValue({rows:[],total:0})
})
afterEach(cleanup)
describe('module cohort navigation',()=>{
  it('shows profile phone and age and sends name searches to the server',async()=>{
    renderPage('cohort=2&tab=students')
    expect(await screen.findByText('0770000002')).toBeInTheDocument()
    expect(screen.getByText('14')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search name, phone or student ID'),{target:{value:'Nethmi'}})
    await waitFor(()=>expect(api.listCohortStudents).toHaveBeenLastCalledWith(expect.objectContaining({cohortId:2,search:'Nethmi',offset:0})))
  })
  it('keeps empty Batch 3 selectable with its scheduled sessions',async()=>{
    api.getModuleCohort.mockImplementation(async(_,id)=>({...summary(id),overview:{...summary(id).overview,total_students:0,students_not_attempted:0}}))
    api.listCohortStudents.mockResolvedValue({rows:[],total:0})
    renderPage('cohort=3&tab=students')
    expect(await screen.findByText('No cohort students found')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Batch 3'})).toHaveAttribute('aria-pressed','true')
    fireEvent.click(screen.getByRole('link',{name:'Sessions'}))
    expect(await screen.findByRole('link',{name:'Session for 3'})).toBeInTheDocument()
  })
  it('uses dynamic cohort names and restores selection from URL',async()=>{
    renderPage('cohort=17&tab=students')
    expect(await screen.findByText('Member of 17')).toBeInTheDocument()
    expect(screen.getByRole('button',{name:'Weekend group'})).toHaveAttribute('aria-pressed','true')
    expect(api.listCohortStudents).toHaveBeenCalledWith(expect.objectContaining({moduleName:'Marketing',cohortId:17}))
  })
  it('selects the first assigned cohort only when no selection exists',async()=>{
    renderPage('')
    await screen.findByText('Cohort students')
    expect(screen.getByTestId('url').textContent).toContain('cohort=1')
    expect(api.getModuleCohort).toHaveBeenCalledWith('Marketing',1)
  })
  it('does not fall back when the URL cohort is not assigned',async()=>{
    renderPage('cohort=999')
    expect(await screen.findByText('Cohort unavailable')).toBeInTheDocument()
    expect(api.getModuleCohort).not.toHaveBeenCalled()
  })
  it('clears old students immediately on cohort switch and ignores late responses',async()=>{
    let resolveOld
    api.listCohortStudents.mockImplementation(({cohortId})=>cohortId===1?new Promise(resolve=>{resolveOld=resolve}):Promise.resolve({rows:[student(cohortId)],total:1}))
    renderPage('cohort=1&tab=students')
    await waitFor(()=>expect(api.listCohortStudents).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button',{name:'Batch 2'}))
    fireEvent.click(await screen.findByRole('link',{name:'Students'}))
    expect(await screen.findByText('Member of 2')).toBeInTheDocument()
    await act(async()=>resolveOld({rows:[student(1)],total:1}))
    expect(screen.queryByText('Member of 1')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Batch 3'}))
    expect(screen.queryByText('Member of 2')).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('link',{name:'Students'}))
    expect(await screen.findByText('Member of 3')).toBeInTheDocument()
  })
  it('shows cohort-specific schedule time and navigates with session ID',async()=>{
    renderPage('cohort=2&tab=sessions')
    expect(await screen.findByText(/04 Nov 2026, 01:30/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link',{name:'Session for 2'}))
    expect(screen.getByTestId('url').textContent).toContain('session=session-2')
    expect(colomboDate('2026-11-03T20:00:00Z')).toBe('04 Nov 2026, 01:30')
  })
  it('requests results with cohort, session, search, sorting and pagination',async()=>{
    api.listCohortAttempts.mockResolvedValue({rows:[],total:26})
    renderPage('cohort=2&tab=results&session=session-2&search=abc&sort=score_desc&page=1')
    await waitFor(()=>expect(api.listCohortAttempts).toHaveBeenCalledWith(expect.objectContaining({cohortId:2,moduleName:'Marketing',sessionId:'session-2',search:'abc',sort:'score_desc',offset:25,resultsOnly:true})))
    expect(await screen.findByRole('button',{name:'Next'})).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Attempt status'),{target:{value:'submitted'}})
    await waitFor(()=>expect(api.listCohortAttempts).toHaveBeenLastCalledWith(expect.objectContaining({status:'submitted',offset:0})))
  })
  it('keeps student history scoped and separates its pagination',async()=>{
    renderPage('cohort=2&tab=students&student=student-2&historyPage=1')
    await screen.findByText('Student history for this module and cohort')
    await waitFor(()=>expect(api.listCohortAttempts).toHaveBeenCalledWith(expect.objectContaining({moduleName:'Marketing',cohortId:2,studentId:'student-2',offset:25})))
  })
  it('loads question banks only for an assigned session',async()=>{
    renderPage('cohort=3&tab=questions&session=session-3')
    await screen.findByText('No questions in these sessions')
    expect(api.listCohortQuestions).toHaveBeenCalledWith(expect.objectContaining({cohortId:3,sessionId:'session-3'}))
  })
  it('rejects a session belonging to another cohort before requesting rows',async()=>{
    renderPage('cohort=2&tab=questions&session=session-1')
    expect(await screen.findByText('Session unavailable for this cohort')).toBeInTheDocument()
    expect(api.listCohortQuestions).not.toHaveBeenCalled()
  })
  it('renders every answer option and explanation through scoped review RPC',async()=>{
    api.getCohortAttempt.mockResolvedValue({attempt:{username:'Member',session_name:'Session',status:'submitted',correct_count:1,total_questions:1},questions:[{question_id:'q1',question_text:'Question?',option_a:'First option',option_b:'Second option',option_c:'Third option',option_d:'Fourth option',correct_option:'B',selected_option:'B',is_correct:true,explanation:'Because this is correct.'}]})
    renderPage('cohort=2&tab=results&attempt=attempt-1')
    expect(await screen.findByText('Because this is correct.')).toBeInTheDocument()
    expect(screen.getByText(/Fourth option/)).toBeInTheDocument()
    expect(api.getCohortAttempt).toHaveBeenCalledWith('Marketing',2,'attempt-1')
  })
  it('displays load errors and supports retry without global fallback',async()=>{
    api.getModuleCohort.mockRejectedValueOnce(new Error('Schema setup required'))
    renderPage()
    expect(await screen.findByText('Schema setup required')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button',{name:'Try again'}))
    expect(await screen.findByText('Cohort students')).toBeInTheDocument()
  })
  it('has an empty state for modules without schedules',async()=>{
    api.getModuleCohorts.mockResolvedValue({cohorts:[]})
    renderPage()
    expect(await screen.findByText('No cohorts assigned')).toBeInTheDocument()
    expect(api.getModuleCohort).not.toHaveBeenCalled()
  })
})
