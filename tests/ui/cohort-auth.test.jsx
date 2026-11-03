import React from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from '../../src/App.jsx'
import { useAdminAuth } from '../../src/context/AdminAuthContext.jsx'
vi.mock('../../src/context/AdminAuthContext.jsx',()=>({useAdminAuth:vi.fn()}))
vi.mock('../../src/pages/LoginPage.jsx',()=>({default:()=> <div>Login required</div>}))
vi.mock('../../src/components/AdminLayout.jsx',async()=>{
  const {Outlet}=await import('react-router-dom')
  return {default:()=> <Outlet/>}
})
vi.mock('../../src/pages/ModuleDetailsPage.jsx',()=>({default:()=> <div>Protected cohort analytics</div>}))
afterEach(cleanup)
function renderApp(){render(<MemoryRouter initialEntries={['/modules/Marketing?cohort=2']}><App/></MemoryRouter>)}
it('redirects unauthenticated visitors from cohort routes',()=>{
  useAdminAuth.mockReturnValue({loading:false,user:null,isAdmin:false});renderApp()
  expect(screen.getByText('Login required')).toBeInTheDocument()
  expect(screen.queryByText('Protected cohort analytics')).not.toBeInTheDocument()
})
it('rejects signed-in non-admin users on cohort routes',()=>{
  useAdminAuth.mockReturnValue({loading:false,user:{id:'student'},isAdmin:false});renderApp()
  expect(screen.getByText('Login required')).toBeInTheDocument()
})
it('allows a verified administrator to open a cohort route',()=>{
  useAdminAuth.mockReturnValue({loading:false,user:{id:'admin'},isAdmin:true});renderApp()
  expect(screen.getByText('Protected cohort analytics')).toBeInTheDocument()
})
it('does not render cohort analytics before authorization finishes',()=>{
  useAdminAuth.mockReturnValue({loading:true,user:{id:'admin'},isAdmin:true});renderApp()
  expect(screen.queryByText('Protected cohort analytics')).not.toBeInTheDocument()
})
