import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RiderProfile from '@/features/rider/pages/RiderProfile'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))
const store = vi.hoisted(() => ({ fetchUser: vi.fn() }))

vi.mock('@/shared/services/api', () => ({ ...api }))
vi.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: (selector?: (state: typeof store) => unknown) => selector ? selector(store) : store,
}))

const profile = {
  id: 12,
  name: 'Rider Name',
  email: 'rider@example.com',
  phone: '09123456789',
  municipality: 'Bansud',
  barangay: 'Poblacion',
  role: 'rider',
  account_status: 'approved',
  profile_photo: 'profiles/rider.jpg',
}

function renderProfile() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/rider/profile']}>
        <RiderProfile />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Rider profile photo', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.put.mockReset()
    api.get.mockResolvedValue(profile)
  })

  it('loads the uploaded profile photo from public storage', async () => {
    renderProfile()

    const image = await screen.findByAltText('Rider Name')
    expect(image.getAttribute('src')).toContain('/storage/profiles/rider.jpg')
  })

  it('shows rider initials instead of a broken image when the photo is unavailable', async () => {
    renderProfile()

    const image = await screen.findByAltText('Rider Name')
    fireEvent.error(image)

    expect(screen.queryByAltText('Rider Name')).not.toBeInTheDocument()
    expect(screen.getByText('R')).toBeInTheDocument()
  })
})
