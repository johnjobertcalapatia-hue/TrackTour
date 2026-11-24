import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouristProfile from '@/features/tourist/pages/TouristProfile'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))

vi.mock('@/shared/services/api', () => ({
  get: api.get, post: api.post, put: api.put,
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
}))
vi.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: (selector?: (v: unknown) => unknown) => {
    const state = { user: { id: 1, name: 'Tina Tourist', role: 'tourist' }, logout: () => {}, setUser: () => {} }
    return selector ? selector(state) : state
  },
}))

function renderProfile() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TouristProfile /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const geo = (ok: boolean) => {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (success: PositionCallback, fail: PositionErrorCallback) =>
        ok ? success({ coords: { latitude: 12.86, longitude: 121.45, accuracy: 10 } } as GeolocationPosition) : fail({ code: 1 } as GeolocationPositionError),
    },
  })
}

beforeEach(() => {
  api.get.mockReset(); api.post.mockReset(); api.put.mockReset()
  api.get.mockImplementation((url: string) => Promise.resolve(
    url === '/tourist/location-sharing' ? { enabled: false, consented_at: null, location_at: null } : { id: 1, name: 'Tina Tourist', role: 'tourist', profile_photo: null },
  ))
})
afterEach(() => { Reflect.deleteProperty(navigator, 'geolocation') })

describe('Tourist location sharing (opt-in)', () => {
  it('is off by default and turns on only after the browser gives a location', async () => {
    geo(true)
    api.put.mockResolvedValue({ enabled: true, consented_at: '2026-11-22T00:00:00Z', location_at: null })
    renderProfile()

    const toggle = await screen.findByRole('switch', { name: /Share my location with the tourism office/ })
    await waitFor(() => expect(toggle).not.toBeDisabled())
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await act(async () => { fireEvent.click(toggle) })

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/tourist/location-sharing', { enabled: true }))
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    expect(screen.getByText('Sharing is on.')).toBeInTheDocument()
  })

  it('stays off and explains when location access is denied', async () => {
    geo(false)
    renderProfile()
    const toggle = await screen.findByRole('switch', { name: /Share my location/ })
    await waitFor(() => expect(toggle).not.toBeDisabled())

    await act(async () => { fireEvent.click(toggle) })

    expect(await screen.findByRole('alert')).toHaveTextContent(/Allow location access/)
    expect(api.put).not.toHaveBeenCalled()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
  })
})
