import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProtectedRoute from '@/shared/components/ProtectedRoute'

const auth = vi.hoisted(() => ({
  user: null as { role: string; account_status?: string } | null,
  loading: false,
  fetchUser: vi.fn(),
}))

vi.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: (selector?: (state: typeof auth) => unknown) => (selector ? selector(auth) : auth),
}))

function LoginPage() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  return (
    <div>
      <h1>Sign in</h1>
      <output data-testid="return-destination">{from}</output>
    </div>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/tourist/explore/map"
          element={
            <ProtectedRoute roles={['tourist']}>
              <p>Tourist map</p>
            </ProtectedRoute>
          }
        />
        <Route path="/explore/map" element={<p>Public directions map</p>} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/unauthorized" element={<p>Unauthorized</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  auth.user = null
  auth.loading = false
  auth.fetchUser.mockReset()
  localStorage.clear()
})

describe('Tourist map access', () => {
  it('requires sign-in and preserves a directions destination', async () => {
    renderAt('/tourist/explore/map?directions=8')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByTestId('return-destination')).toHaveTextContent('/tourist/explore/map?directions=8')
  })

  it('allows a signed-in tourist to open the map', () => {
    auth.user = { role: 'tourist' }

    renderAt('/tourist/explore/map?directions=8')

    expect(screen.getByText('Tourist map')).toBeInTheDocument()
  })

  it('does not allow a different account role to open the tourist map', () => {
    auth.user = { role: 'business_owner', account_status: 'approved' }

    renderAt('/tourist/explore/map')

    expect(screen.getByText('Unauthorized')).toBeInTheDocument()
  })

  it('lets a guest open the public landing directions map directly', () => {
    renderAt('/explore/map?directions=8')

    expect(screen.getByText('Public directions map')).toBeInTheDocument()
  })
})
