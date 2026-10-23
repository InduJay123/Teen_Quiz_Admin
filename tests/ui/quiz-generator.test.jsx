import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import QuizGeneratorPage from '../../src/pages/QuizGeneratorPage.jsx'
import DashboardPage from '../../src/pages/DashboardPage.jsx'
import * as api from '../../src/lib/adminApi.js'

vi.mock('../../src/lib/adminApi.js', () => ({
  getGenerationChoices: vi.fn(), getRecentGenerationJob: vi.fn(), getGenerationJob: vi.fn(),
  submitGenerationText: vi.fn(), getDashboard: vi.fn(),
}))
vi.mock('../../src/lib/pdfExtraction.js', () => ({ extractLessonPdf: vi.fn(async () => ({ text: 'Lesson text '.repeat(30), pageCount: 1 })) }))
const job = { job_id: 'job', bank_id: 'bank', status: 'extracting', session_context: { module_name: 'Finance', session_name: 'Session 1' } }
const renderPage = () => render(<MemoryRouter><QuizGeneratorPage /></MemoryRouter>)
beforeEach(() => {
  vi.clearAllMocks()
  api.getGenerationChoices.mockResolvedValue({ configuration: { enabled: true, max_pdf_bytes: 20971520 }, sessions: [
    { bank_id: 'bank', module_name: 'Finance', module_title: 'Finance', session_name: 'Session 1', session_date: '2026-10-24', eligible: true },
  ] })
  api.getRecentGenerationJob.mockResolvedValue(null)
  api.getGenerationJob.mockResolvedValue(job)
})
afterEach(cleanup)

describe('quiz generator page', () => {
  it('one click uploads and starts automatically, without a second action', async () => {
    api.submitGenerationText.mockResolvedValue(job)
    renderPage()
    await waitFor(() => expect(screen.getByLabelText('Module')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Module'), { target: { value: 'Finance' } })
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 'bank' } })
    const file = new File(['%PDF-1.7 sample %%EOF'], 'lesson.pdf', { type: 'application/pdf' })
    file.arrayBuffer = async () => new TextEncoder().encode('%PDF-1.7 sample %%EOF').buffer
    fireEvent.change(screen.getByLabelText('Lesson PDF'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload & Process' }))
    await waitFor(() => expect(api.submitGenerationText).toHaveBeenCalledTimes(1))
    expect(api.submitGenerationText.mock.calls[0][0].sourceText).toContain('Lesson text')
    expect(api.submitGenerationText.mock.calls[0][0]).not.toHaveProperty('file')
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled()
    expect(screen.queryByText('Quiz Generated Successfully')).not.toBeInTheDocument()
  })
  it('restores an active job after refresh without browser storage', async () => {
    api.getRecentGenerationJob.mockResolvedValue(job)
    renderPage()
    expect(await screen.findByText('Processing PDF...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled()
    await waitFor(() => expect(api.getGenerationJob).toHaveBeenCalledWith('job'), { timeout: 3000 })
  })
  it('shows modules and unavailable sessions even when job RPC recovery fails', async () => {
    api.getRecentGenerationJob.mockRejectedValue(new Error('Generator setup is not installed.'))
    api.getGenerationChoices.mockResolvedValue({ configuration: { enabled: false, reason: 'Migration required.' }, sessions: [
      { bank_id: 'bank', module_name: 'Finance', module_title: 'Finance', session_name: 'Session 1', eligible: false, unavailable_reason: 'Completed bank.' },
    ] })
    renderPage()
    await waitFor(() => expect(screen.getByLabelText('Module')).toBeEnabled())
    fireEvent.change(screen.getByLabelText('Module'), { target: { value: 'Finance' } })
    expect(screen.getByRole('option', { name: /Session 1/ })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 'bank' } })
    expect(screen.getByText('Completed bank.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload & Process' })).toBeDisabled()
  })
  it('only shows success for a database publication receipt with 30 saved questions', async () => {
    api.getRecentGenerationJob.mockResolvedValue({ ...job, status: 'completed', actual_question_count: 30, published_question_count: 30, publication_id: 'receipt', completed_at: '2026-10-22' })
    renderPage()
    expect(await screen.findByText('Quiz Generated Successfully')).toBeInTheDocument()
    expect(screen.getByText(/30 questions generated and saved/)).toBeInTheDocument()
  })
  it('does not display unconfirmed completion as success', async () => {
    api.getRecentGenerationJob.mockResolvedValue({ ...job, status: 'completed' })
    renderPage()
    expect(await screen.findByText('Publication confirmation is incomplete')).toBeInTheDocument()
    expect(screen.queryByText('Quiz Generated Successfully')).not.toBeInTheDocument()
  })
  it('reports a failed job reason and keeps generation disabled when setup is incomplete', async () => {
    api.getRecentGenerationJob.mockResolvedValue({ ...job, status: 'failed', error_reason: 'Incorrect difficulty distribution' })
    api.getGenerationChoices.mockResolvedValue({ sessions: [], configuration: { enabled: false, reason: 'Publication adapter is missing.' } })
    renderPage()
    expect(await screen.findByText('Quiz Generation Failed')).toBeInTheDocument()
    expect(screen.getByText('Incorrect difficulty distribution')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload & Process' })).toBeDisabled()
  })
})

it('existing dashboard still loads its analytics API and renders metrics', async () => {
  api.getDashboard.mockResolvedValue({ total_students: 42, total_attempts: 80, completed_attempts: 60, average_score: 75, completion_rate: 75, module_performance: [], score_distribution: [], recent_attempts: [] })
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
  expect(await screen.findByText('42')).toBeInTheDocument()
  expect(screen.getByText('Recent attempts')).toBeInTheDocument()
  expect(api.getDashboard).toHaveBeenCalledTimes(1)
})
