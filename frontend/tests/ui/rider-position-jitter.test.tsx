import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RiderActiveTripProvider, useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

/**
 * Navigation lag on a PC (2026-11-12): repeated or jittering GPS readings
 * re-rendered every trip screen on each tick. The shared position now only
 * changes when the rider really moved (≥ 1 m); the latest fix is still kept
 * for the drop-off actions.
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

describe('rider position ignores GPS jitter', () => {
  beforeEach(() => {
    calls.order = []
    useAuthStore.setState({ user: RIDER, loading: false })
  })
  afterEach(() => useAuthStore.setState({ user: null, loading: false }))

  it('keeps the same position under 1 m and updates it beyond', async () => {
    renderProbe()
    await waitFor(() => expect(trip?.activeDelivery?.id).toBe(16))

    act(() => trip!.setRiderPosition(12.96049, 121.46787, 20))
    const first = trip!.riderPosition

    // ~0.3 m north, and a slightly different accuracy: nothing re-renders.
    act(() => trip!.setRiderPosition(12.960493, 121.46787, 20.4))
    expect(trip!.riderPosition).toBe(first)
    expect(trip!.deviceAccuracy).toBe(20)

    // ~5.6 m north: the rider moved.
    act(() => trip!.setRiderPosition(12.96054, 121.46787, 20))
    expect(trip!.riderPosition).not.toBe(first)
    expect(trip!.riderPosition).toEqual([12.96054, 121.46787])
  })
})
