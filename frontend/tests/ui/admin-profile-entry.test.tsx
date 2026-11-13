import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardLayout from '@/shared/layouts/DashboardLayout'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

/**
 * The Admin sidebar's "Signed in as" card opens the Bansud Tourism Office
 * profile (/admin/profile), and the sidebar brand shows the office's own logo
 * once the office has uploaded one.
 */

const OFFICE = {
  name: 'Bansud Tourism Office',
  about: '',
  email: '',
  phone: '',
  address: 'Municipal Hall, Bansud, Oriental Mindoro',
  logo_url: '/storage/office/logo/bansud-seal.png',
  cover_url: null,
  updated_at: null,
}

const api = vi.hoisted(() => ({
  office: {
    name: 'Bansud Tourism Office',
    about: '',
    email: '',
    phone: '',
    address: 'Municipal Hall, Bansud, Oriental Mindoro',
    logo_url: '/storage/office/logo/bansud-seal.png' as string | null,
    cover_url: null as string | null,
    updated_at: null as string | null,
  },
  get: vi.fn(),
  post: vi.fn(async () => ({})),
  patch: vi.fn(async () => ({})),
  put: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
  apiErrorMessage: vi.fn(() => 'server rejected'),
}))

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  patch: api.patch,
  put: api.put,
  del: api.del,
  apiErrorMessage: api.apiErrorMessage,
}))

const ADMIN: User = {
  id: 3,
  name: 'Bansud Tourism Office',
  email: 'office@bansud.gov.ph',
  role: 'bansud_tourism_office',
  account_status: 'approved',
  email_verified_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-24T00:00:00Z',
}

const sections = [
  {
    label: 'Main',
    items: [{ to: '/admin/dashboard', label: 'Dashboard', icon: <span data-testid="nav-icon" /> }],
  },
]

function renderAdmin(options: { profilePath?: string } = {}) {
  const profilePath = 'profilePath' in options ? options.profilePath : '/admin/profile'

  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/dashboard']}>
        <Routes>
          <Route
            path="/admin"
            element={
              <DashboardLayout
                sections={sections}
                roleLabel="Admin"
                theme="admin"
                profilePath={profilePath}
              />
            }
          >
            <Route path="dashboard" element={<div>Admin dashboard</div>} />
            <Route path="profile" element={<div>Office profile page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Admin sidebar office identity', () => {
  beforeEach(() => {
    api.office.logo_url = OFFICE.logo_url
    localStorage.clear()
    api.get.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/admin/profile') return Promise.resolve(api.office)
      return Promise.resolve({})
    })
    useAuthStore.setState({ user: ADMIN, loading: false })
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, loading: false })
  })

  it('opens the office profile from the "Signed in as" card', async () => {
    renderAdmin()

    const card = await screen.findByRole('link', { name: 'Open the Admin profile' })
    expect(card).toHaveTextContent('Signed in as')
    expect(card).toHaveTextContent('Bansud Tourism Office')

    fireEvent.click(card)

    expect(await screen.findByText('Office profile page')).toBeInTheDocument()
  })

  it('shows the uploaded office logo and name in the sidebar brand', async () => {
    renderAdmin()

    const logo = await screen.findByAltText('Bansud Tourism Office logo')
    expect(logo.getAttribute('src')).toContain('/storage/office/logo/bansud-seal.png')
    expect(screen.queryByAltText('TrackTour Logo')).toBeNull()
  })

  it('falls back to the TrackTour brand while no logo is configured', async () => {
    api.office.logo_url = null
    renderAdmin()

    expect(await screen.findByAltText('TrackTour Logo')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByAltText('Bansud Tourism Office logo')).toBeNull())
  })

  it('does not link the identity card when the role has no profile page', async () => {
    renderAdmin({ profilePath: undefined })

    await screen.findByText('Signed in as')
    expect(screen.queryByRole('link', { name: 'Open the Admin profile' })).toBeNull()
    // The identity card still renders the signed-in name, just not as a link.
    expect(screen.getAllByText('Bansud Tourism Office').length).toBeGreaterThan(0)
  })
})
