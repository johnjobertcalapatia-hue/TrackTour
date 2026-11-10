import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RiderActiveTripProvider, useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

/**
 * Production 2026-11-10: the server judged "Confirm Delivered" from the
 * rider's last SAVED fix (at the restaurant, 10.8 km away) while the map
 * showed the rider at the door — the stationary rider had not sent a fresh fix.
 * I've Arrived and Confirm Delivered now save the device's current fix first,
 * then run the action.
 */

const calls = vi.hoisted(() => ({ order: [] as string[] }))
const api = vi.hoisted(() => ({
  get: vi.fn(async (url: string) => {
    if (url === '/rider/map/location') {
      return {
        rider: { latitude: null, longitude: null },
        deliveries: [{
          id: 16, order_id: 16, status: 'in_transit',
          pickup_lat: 12.864, pickup_lng: 121.4547, pickup_address: 'Nia Rd',
          delivery_lat: 12.9604899, delivery_lng: 121.4678681, delivery_address: 'Kawit, Gloria',
        }],
      }
    }
    return null
  }),
  post: vi.fn(async (url: string) => { calls.order.push(`POST ${url}`); return {} }),
  patch: vi.fn(async (url: string) => { calls.order.push(`PATCH ${url}`); return {} }),
  apiErrorMessage: vi.fn(() => 'error'),
}))
vi.mock('@/shared/services/api', () => api)
// No real socket connections from a unit test.
vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), off: vi.fn() }) }))

const RIDER: User = {
  id: 2, name: 'Rider', email: 'r@test.com', role: 'rider', account_status: 'approved', email_verified_at: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', rider_status: 'busy', current_service: 'food', auto_accept: false,
}

let trip: ReturnType<typeof useRiderActiveTrip> | null = null
function Probe() {
  trip = useRiderActiveTrip()
  return null
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RiderActiveTripProvider><Probe /></RiderActiveTripProvider>
    </QueryClientProvider>,
  )
}

describe('location-gated drop-off actions save a fresh fix first', () => {
  beforeEach(() => {
    calls.order = []
    api.post.mockClear()
    api.patch.mockClear()
    useAuthStore.setState({ user: RIDER, loading: false })
  })
  afterEach(() => useAuthStore.setState({ user: null, loading: false }))

  it("I've Arrived posts the device's current fix, then the arrival", async () => {
    renderProbe()
    await waitFor(() => expect(trip?.activeDelivery?.id).toBe(16))
    act(() => trip!.setRiderPosition(12.96049, 121.46787))
    calls.order = []

    await act(async () => { trip!.onArrivedDrop() })
    await waitFor(() => expect(api.patch).toHaveBeenCalled())

    const arrive = calls.order.indexOf('PATCH /rider/deliveries/16/status')
    const fix = calls.order.lastIndexOf('POST /rider/map/location', arrive)
    expect(fix).toBeGreaterThanOrEqual(0)
    expect(fix).toBeLessThan(arrive)
    expect(api.post).toHaveBeenCalledWith('/rider/map/location', { latitude: 12.96049, longitude: 121.46787 })
  })

  it('Confirm Delivered posts the fix, then the proof photo', async () => {
    renderProbe()
    await waitFor(() => expect(trip?.activeDelivery?.id).toBe(16))
    act(() => trip!.setRiderPosition(12.96049, 121.46787))
    calls.order = []

    await act(async () => { trip!.onConfirmDelivery(new File(['x'], 'p.jpg', { type: 'image/jpeg' })) })
    await waitFor(() => expect(calls.order).toContain('POST /rider/deliveries/16/complete'))

    expect(calls.order.indexOf('POST /rider/map/location')).toBeLessThan(calls.order.indexOf('POST /rider/deliveries/16/complete'))
  })

  it('a reading missing its longitude is never used or sent', async () => {
    renderProbe()
    await waitFor(() => expect(trip?.activeDelivery?.id).toBe(16))
    act(() => trip!.setRiderPosition(12.96049, 0))
    expect(trip!.positionKnown).toBe(false)
    calls.order = []

    await act(async () => { trip!.onArrivedDrop() })
    await waitFor(() => expect(api.patch).toHaveBeenCalled())
    expect(api.post).not.toHaveBeenCalledWith('/rider/map/location', expect.anything())
  })
})
