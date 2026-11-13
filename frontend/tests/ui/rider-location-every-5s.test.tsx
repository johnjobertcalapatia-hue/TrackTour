import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardLayout from '@/shared/layouts/DashboardLayout'
import { RiderActiveTripProvider } from '@/features/rider/context/RiderActiveTripContext'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { RIDER_LOCATION_INTERVAL_MS, locationSentRecently, markLocationSent } from '@/features/rider/gps'
import type { User } from '@/shared/types'

/** Decision 2026-11-11: the rider's current location is sent every 5 seconds. */

const api = vi.hoisted(() => ({
  get: vi.fn(async (url: string) => (url === '/rider/map/location' ? { rider: { latitude: 12.86, longitude: 121.45 }, deliveries: [] } : {})),
  post: vi.fn(async () => ({ moved: true })),
  patch: vi.fn(async () => ({})),
  del: vi.fn(async () => ({})),
  put: vi.fn(async () => ({})),
  apiErrorMessage: vi.fn(() => 'error'),
}))
vi.mock('@/shared/services/api', () => api)

const RIDER: User = {
  id: 9, name: 'Rider', email: 'rider@test.com', role: 'rider', account_status: 'approved', email_verified_at: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-24T00:00:00Z', rider_status: 'available', current_service: 'transport', auto_accept: false,
}

const locationPosts = () => api.post.mock.calls.filter(([url]) => url === '/rider/map/location')

describe('rider location every 5 seconds', () => {
  let fix = { latitude: 12.8601, longitude: 121.4501, accuracy: 8 }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false })
    api.post.mockClear()
    markLocationSent(0)
    fix = { latitude: 12.8601, longitude: 121.4501, accuracy: 8 }
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: {
        getCurrentPosition: (ok: PositionCallback) => ok({ coords: { ...fix, heading: null, speed: null, altitude: null, altitudeAccuracy: null }, timestamp: Date.now() } as unknown as GeolocationPosition),
        watchPosition: () => 1,
        clearWatch: () => undefined,
      },
    })
    useAuthStore.setState({ user: RIDER, loading: false })
  })

  afterEach(() => {
    vi.useRealTimers()
    useAuthStore.setState({ user: null, loading: false })
  })

  it('the interval is 5 s and the shared clock prevents double sends', () => {
    expect(RIDER_LOCATION_INTERVAL_MS).toBe(5000)
    markLocationSent(10_000)
    expect(locationSentRecently(12_000)).toBe(true)
    expect(locationSentRecently(15_000)).toBe(false)
  })

  it('an online rider sends the current location every 5 seconds, with its accuracy', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/rider/deliveries/pending']}>
          <Routes>
            <Route
              path="/rider/deliveries/pending"
              element={
                <RiderActiveTripProvider>
                  <DashboardLayout sections={[]} roleLabel="Rider" theme="tourism" profilePath="/rider/profile" bottomNavigation />
                </RiderActiveTripProvider>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await act(async () => { await Promise.resolve() })
    expect(locationPosts()).toHaveLength(1)
    expect(locationPosts()[0]![1]).toEqual({ latitude: 12.8601, longitude: 121.4501, accuracy: 8 })

    fix = { latitude: 12.8605, longitude: 121.4505, accuracy: 6 }
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve() })
    expect(locationPosts()).toHaveLength(2)
    expect(locationPosts()[1]![1]).toMatchObject({ latitude: 12.8605, longitude: 121.4505 })

    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(5000); await Promise.resolve() })
    expect(locationPosts()).toHaveLength(4) // 0 s, 5 s, 10 s, 15 s
  })
})
