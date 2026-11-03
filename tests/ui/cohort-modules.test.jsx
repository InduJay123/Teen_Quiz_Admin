import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ModulesPage from '../../src/pages/ModulesPage.jsx'
import * as api from '../../src/lib/adminApi.js'
vi.mock('../../src/lib/adminApi.js', () => ({listCohortModules:vi.fn(),listModules:vi.fn()}))
afterEach(cleanup)
it('loads cohort catalog metadata without changing the global module API', async () => {
  api.listCohortModules.mockResolvedValue([{module_name:'Marketing',module_title:'Marketing',session_count:2,cohort_count:4,question_count:60,status:'ready'}])
  render(<MemoryRouter><ModulesPage/></MemoryRouter>)
  expect(await screen.findByText('Marketing')).toBeInTheDocument()
  expect(screen.getByText('4')).toBeInTheDocument()
  expect(screen.getByText('60')).toBeInTheDocument()
  expect(api.listModules).not.toHaveBeenCalled()
  expect(screen.getByRole('link')).toHaveAttribute('href','/modules/Marketing')
})
