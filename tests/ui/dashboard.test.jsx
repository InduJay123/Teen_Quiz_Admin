import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from '../../src/pages/DashboardPage.jsx'
import * as api from '../../src/lib/adminApi.js'

vi.mock('../../src/lib/adminApi.js', () => ({ getDashboard: vi.fn() }))
afterEach(cleanup)

it('existing dashboard still loads its analytics API and renders metrics', async () => {
  api.getDashboard.mockResolvedValue({ total_students: 42, total_attempts: 80, completed_attempts: 60, average_score: 75, completion_rate: 75, module_performance: [], score_distribution: [], recent_attempts: [] })
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
  expect(await screen.findByText('42')).toBeInTheDocument()
  expect(screen.getByText('Recent attempts')).toBeInTheDocument()
  expect(api.getDashboard).toHaveBeenCalledTimes(1)
})
