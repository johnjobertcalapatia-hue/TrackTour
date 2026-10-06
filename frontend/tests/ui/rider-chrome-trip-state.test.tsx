import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardLayout from '@/shared/layouts/DashboardLayout'
import { RiderActiveTripProvider } from '@/features/rider/context/RiderActiveTripContext'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

/**
 * The Go Online / Go Offline floating chrome must NEVER show a misleading
 * "Go Online" while the rider is actually bound to a trip.
 *
 * Root cause this locks down: a rider whose `rider_status` drifted to
 * 'offline' (e.g. a logout clobbering the flag mid-trip) still holds a live
 * Delivery row — the backend toggle guard 409s any tap ("you are currently on
 * a delivery or trip"), so clicking a grey "Go Online" button always failed.
 * The chrome now derives the trip state from the authoritative active-trip
 * context and renders "On a trip" with the toggle disabled.
 */

const api = vi.hoisted(() => {
  const store = {
    mapStatus: 'in_transit' as string,
    locationDeliveries: [] as Array<Record<string, unknown>>,
    activeDeliveries: [] as Array<Record<string, unknown>>,
  }
  return {
    store,
    get: vi.fn(async (url: string) => {
      if (url === '/rider/map/location') {
        return { rider: { latitude: 12.8667, longitude: 121.45 }, deliveries: store.locationDeliveries }
      }
      if (url === '/rider/deliveries/active') {
        return { data: store.activeDeliveries }
      }
      return {}
    }),
    post: vi.fn(async () => ({ rider_status: 'available' })),
    patch: vi.fn(async () => ({})),
    apiErrorMessage: vi.fn(() => 'server rejected'),
  }
})

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  patch: api.patch,
  apiErrorMessage: api.apiErrorMessage,
}))

const USER: User = {
  id: 9,
  name: 'Rider Trip',
  email: 'rider-trip@test.com',
  role: 'rider',
  account_status: 'approved',
  email_verified_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-24T00:00:00Z',
  rider_status: 'offline',
  current_service: 'food',
  auto_accept: false,
}

function renderChrome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/rider/map']}>
        <Routes>
          <Route
            path="/rider/map"
            element={
              <RiderActiveTripProvider>
                <DashboardLayout sections={[]} roleLabel="Rider" theme="tourism" profilePath="/rider/profile" bottomNavigation />
              </RiderActiveTripProvider>
            }
          >
            <Route index element={null} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('Rider go-online chrome — mid-trip state', () => {
  beforeEach(() => {
    api.store.mapStatus = 'in_transit'
    api.store.locationDeliveries = []
    api.store.activeDeliveries = []
    api.get.mockClear()
    api.post.mockClear()
    api.patch.mockClear()
    useAuthStore.setState({ user: USER, loading: false })
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, loading: false })
  })

  it('rider marked offline but holding an active in-trip delivery shows "On a trip" with the toggle locked — no toggle request fires', async () => {
    api.store.locationDeliveries = [
      {
        id: 42,
        order_id: 99,
        status: 'in_transit',
        pickup_address: 'Pickup St, Bansud',
        pickup_lat: 12.5,
        pickup_lng: 121.3,
        delivery_address: 'Drop St, Bansud',
        delivery_lat: 12.55,
        delivery_lng: 121.2,
        business_name: 'GPS Cafe',
      },
    ]

    renderChrome()

    // The chrome fronted on the trip state, not the drifted flag.
    await waitFor(() => expect(screen.getByRole('button', { name: /on a trip/i })).toBeInTheDocument())
    expect(screen.getByText('On a trip')).toBeInTheDocument()
    expect(screen.queryByText('Go Online')).not.toBeInTheDocument()
    expect(screen.queryByText('Offline')).not.toBeInTheDocument()

    // And it can never even attempt the guaranteed-409 toggle.
    const toggle = screen.getByRole('button', { name: /on a trip/i })
    expect(toggle).toBeDisabled()

    fireEvent.click(toggle)
    expect(api.post).not.toHaveBeenCalledWith('/rider/availability/toggle')
  })

  it('rider offline with no trip still gets an enabled "Go Online" button that drives the toggle', async () => {
    renderChrome()

    await waitFor(() => expect(screen.getByRole('button', { name: /go online/i })).toBeEnabled())
    expect(screen.getByText('Offline')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /go online/i }))

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(api.post.mock.calls.some(([url]) => url === '/rider/availability/toggle')).toBe(true)
    await waitFor(() => expect(screen.getByText('Online')).toBeInTheDocument())
  })

  it('a delivered-but-unsettled COD still counts as mid-trip (backend keeps the rider until settlement)', async () => {
    api.store.activeDeliveries = [
      {
        id: 7,
        order_id: 77,
        status: 'delivered',
        is_cod: true,
        cash_due: 300,
        pickup_address: 'Pickup St, Bansud',
        delivery_address: 'Drop St, Bansud',
      },
    ]

    renderChrome()

    await waitFor(() => expect(screen.getByRole('button', { name: /on a trip/i })).toBeInTheDocument())
    expect(screen.getByText('On a trip')).toBeInTheDocument()
    expect(screen.queryByText('Go Online')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /on a trip/i })
    expect(toggle).toBeDisabled()
    fireEvent.click(toggle)
    expect(api.post).not.toHaveBeenCalledWith('/rider/availability/toggle')
  })
})