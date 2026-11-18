import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, API_BASE_URL: 'http://localhost/api' }))

import AdminLayout from '@/features/admin/components/AdminLayout'
import { useAuthStore } from '@/features/auth/services/auth-store'

const office = { name: 'Bansud Tourism Office', about: '', email: '', phone: '', address: '', logo_url: null, cover_url: null, updated_at: null }

function renderAt(path = '/admin/dashboard') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="dashboard" element={<p>dashboard page</p>} />
            <Route path="riders" element={<p>riders page</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ user: { id: 1, name: 'Bansud Tourism Office', email: 'tourism@bansud.gov.ph', role: 'bansud_tourism_office', account_status: 'approved' } as never, loading: false })
  api.get.mockImplementation((url: string) =>
    Promise.resolve(url.includes('profile') ? office : { stats: { pending_verifications: 4, pending_review: 0, total_municipalities: 15 } }),
  )
})

describe('Bansud admin shell (municipal portal identity)', () => {
  it('shows the TrackTour mark, the grouped admin navigation and the page', async () => {
    renderAt()

    const nav = screen.getByRole('navigation', { name: 'Admin navigation' })
    expect(screen.getAllByAltText('TrackTour Logo')[0]).toHaveAttribute('src', '/assets/logo/tracktour.png')
    for (const label of ['Dashboard', 'Live Map', 'Users', 'Rider Onboarding', 'Reports', 'Settings']) {
      expect(within(nav).getByRole('link', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('dashboard page')).toBeInTheDocument()
  })

  it('badges waiting verifications on Users and names the municipalities overseen', async () => {
    renderAt()

    expect(await screen.findByLabelText('4 waiting')).toBeInTheDocument()
    expect(await screen.findByText('15 municipalities')).toBeInTheDocument()
  })

  it('opens the account menu with Office Profile and Logout', async () => {
    renderAt('/admin/riders')

    expect(screen.getByText('riders page')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Bansud Tourism Office/ }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: /Office Profile/ })).toHaveAttribute('href', '/admin/profile')
    expect(within(menu).getByRole('menuitem', { name: /Logout/ })).toBeInTheDocument()
  })
})
