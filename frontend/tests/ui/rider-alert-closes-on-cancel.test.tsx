import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RiderActiveTripProvider, useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

/**
 * 2026-11-18: the passenger cancelled while the rider's "You've Arrived /
 * Passenger On Board" alert was showing, and the alert stayed up (with
 * "Passenger · Address unavailable · Destination Location") because the trip
 * had left the active list and nothing closed it.
 */

const server = vi.hoisted(() => ({ deliveries: [] as unknown[] }))
const api = vi.hoisted(() => ({
  get: vi.fn(async (url: string) => {
    if (url === '/rider/map/location') return { rider: { latitude: null, longitude: null }, deliveries: server.deliveries }
    if (url.endsWith('/pickup-stops')) return { stops: [] }
    if (url === '/rider/deliveries/active') return { data: [] }
    return null
  }),
  post: vi.fn(async () => ({})),
  patch: vi.fn(async () => ({})),
  apiErrorMessage: vi.fn(() => 'error'),
}))
vi.mock('@/shared/services/api', () => api)
vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), emit: vi.fn(), disconnect: vi.fn(), off: vi.fn() }) }))

const RIDER: User = {
  id: 2, name: 'Rider', email: 'r@test.com', role: 'rider', account_status: 'approved', email_verified_at: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', rider_status: 'busy', current_service: 'transport', auto_accept: false,
}

const RIDE = {
  id: 31, order_id: 31, order_type: 'transport', status: 'arrived_pickup', customer_name: 'Jayvie De Torres',
  pickup_lat: 12.864, pickup_lng: 121.4547, pickup_address: 'Bansud Plaza',
  delivery_lat: 12.9604899, delivery_lng: 121.4678681, delivery_address: 'Kawit, Gloria',
}

let trip: ReturnType<typeof useRiderActiveTrip> | null = null
function Probe() {
  trip = useRiderActiveTrip()
  return null
}

describe('rider arrival alert after the passenger cancels', () => {
  beforeEach(() => {
    server.deliveries = [RIDE]
    useAuthStore.setState({ user: RIDER, loading: false })
  })
  afterEach(() => useAuthStore.setState({ user: null, loading: false }))

  it('closes when the trip leaves the active list', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <RiderActiveTripProvider><Probe /></RiderActiveTripProvider>
      </QueryClientProvider>,
    )

    // At the pickup: the arrival alert is up.
    await waitFor(() => expect(trip?.activeDelivery?.id).toBe(31))
    await waitFor(() => expect(trip?.arrivalAlert).toBe('PICKUP'))

    // The passenger cancels: the next poll no longer lists the trip.
    server.deliveries = []
    await act(async () => { await client.invalidateQueries({ queryKey: ['rider-map-location'] }) })

    await waitFor(() => expect(trip?.activeDelivery).toBeFalsy())
    expect(trip?.arrivalAlert).toBeNull()
  })
})
