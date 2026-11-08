import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RiderActiveTripProvider, useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

/**
 * Regression: before the device reports GPS, the trip context holds a
 * placeholder (Bansud town centre, 12.8667, 121.45). A restaurant at those
 * coordinates made the rider look "near pickup" right after accepting, and the
 * context POSTed the placeholder to /rider/map/location — moving the delivery
 * to arrived_pickup without the rider ever being there. Proximity, arrival
 * prompts and location nudges must wait for a real position.
 */

const RESTAURANT_AT_PLACEHOLDER = { lat: 12.8667, lng: 121.45 }

const api = vi.hoisted(() => ({
  get: vi.fn(async (url: string) => {
    if (url === '/rider/map/location') {
      return {
        rider: { latitude: null, longitude: null },
        deliveries: [{
          id: 6, order_id: 6, status: 'assigned',
          pickup_lat: 12.8667, pickup_lng: 121.45, pickup_address: 'Pag-asa, Bansud',
          delivery_lat: 12.96, delivery_lng: 121.47, delivery_address: 'Batingan, Gloria',
        }],
      }
    }
    if (url.endsWith('/pickup-stops')) return null
    if (url === '/rider/deliveries/active') return []
    return null
  }),
  post: vi.fn(async () => ({})),
  patch: vi.fn(async () => ({})),
  apiErrorMessage: vi.fn(() => 'error'),
}))
vi.mock('@/shared/services/api', () => api)

const RIDER: User = {
  id: 8, name: 'Rider', email: 'r@test.com', role: 'rider', account_status: 'approved', email_verified_at: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', rider_status: 'busy', current_service: 'food', auto_accept: false,
}

let setPos: (lat: number, lng: number) => void = () => {}
function Probe() {
  const { tripState, positionKnown, setRiderPosition } = useRiderActiveTrip()
  setPos = setRiderPosition
  return (
    <div>
      <span data-testid="trip">{tripState}</span>
      <span data-testid="known">{String(positionKnown)}</span>
    </div>
  )
}

function renderProbe() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <RiderActiveTripProvider><Probe /></RiderActiveTripProvider>
    </QueryClientProvider>,
  )
}

const locationPosts = () => api.post.mock.calls.filter(([url]) => url === '/rider/map/location')

describe('rider trip never uses the placeholder position', () => {
  beforeEach(() => {
    api.post.mockClear()
    useAuthStore.setState({ user: RIDER, loading: false })
  })
  afterEach(() => useAuthStore.setState({ user: null, loading: false }))

  it('right after accepting, a restaurant at the placeholder is NOT treated as reached, and nothing is posted', async () => {
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent('EN_ROUTE_TO_PICKUP'))
    expect(screen.getByTestId('known')).toHaveTextContent('false')
    expect(locationPosts()).toHaveLength(0)
  })

  it('once real GPS puts the rider at the restaurant, arrival is detected and reported', async () => {
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent('EN_ROUTE_TO_PICKUP'))

    act(() => setPos(RESTAURANT_AT_PLACEHOLDER.lat, RESTAURANT_AT_PLACEHOLDER.lng))

    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent('ARRIVED_AT_PICKUP'))
    expect(screen.getByTestId('known')).toHaveTextContent('true')
    await waitFor(() => expect(locationPosts().length).toBeGreaterThan(0))
    expect(locationPosts()[0]![1]).toEqual({ latitude: 12.8667, longitude: 121.45 })
  })

  it('ignores an invalid 0,0 fix', async () => {
    renderProbe()
    await waitFor(() => expect(screen.getByTestId('trip')).toHaveTextContent('EN_ROUTE_TO_PICKUP'))

    act(() => setPos(0, 0))

    expect(screen.getByTestId('known')).toHaveTextContent('false')
    expect(locationPosts()).toHaveLength(0)
  })
})
