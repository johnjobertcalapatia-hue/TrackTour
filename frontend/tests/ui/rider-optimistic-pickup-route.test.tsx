import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  RiderActiveTripProvider,
  useRiderActiveTrip,
} from '@/features/rider/context/RiderActiveTripContext'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

/**
 * Optimistic drop-off leg on pickup confirm.
 *
 * Requirement: after confirming pickup, the map must render the route to the
 * destination drop-off location the INSTANT the rider taps confirm — not only
 * once the next authoritative status poll/refetch (up to 10s) reports the
 * delivery as `picked_up`. The context derives tripState from an optimistic
 * `picked_up` override so OUT_FOR_DELIVERY (the drop leg) is reached
 * synchronously, then reconciles to the server status once the poll catches up
 * and reverts if the server rejects the transition.
 */

const api = vi.hoisted(() => {
  const store = {
    status: 'arrived_pickup' as string,
    deferPatch: false,
  }
  let release: (() => void) | null = null
  return {
    store,
    release() {
      release?.()
      release = null
    },
    get: vi.fn(async (url: string) => {
      if (url === '/rider/map/location') {
        return {
          rider: { latitude: 12.8667, longitude: 121.45 },
          deliveries: [
            {
              id: 7,
              order_id: 9,
              status: store.status,
              pickup_address: 'Restaurant St, Bansud',
              pickup_lat: 12.86,
              pickup_lng: 121.44,
              delivery_address: 'Droppoint St, Bansud',
              delivery_lat: 12.55,
              delivery_lng: 121.2,
              business_name: 'GPS Cafe',
            },
          ],
        }
      }
      return {}
    }),
    patch: vi.fn(async (url: string) => {
      if (url === '/rider/deliveries/7/status') {
        if (store.deferPatch) {
          await new Promise<void>((res) => {
            release = res
          })
        }
        store.status = 'picked_up'
      }
      return {}
    }),
    post: vi.fn(async () => ({})),
    apiErrorMessage: vi.fn(() => 'server rejected pickup'),
  }
})

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  patch: api.patch,
  apiErrorMessage: api.apiErrorMessage,
}))

const USER: User = {
  id: 7,
  name: 'Rider A',
  email: 'rider@test.com',
  role: 'rider',
  account_status: 'approved',
  email_verified_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-24T00:00:00Z',
  rider_status: 'online',
  current_service: 'food',
  auto_accept: false,
}

function Probe() {
  const { tripState, onMarkPickedUp } = useRiderActiveTrip()
  return (
    <div>
      <span data-testid="trip-state">{tripState}</span>
      <button type="button" onClick={onMarkPickedUp}>
        Confirm Pickup
      </button>
    </div>
  )
}

function renderProbe() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RiderActiveTripProvider>
        <Probe />
      </RiderActiveTripProvider>
    </QueryClientProvider>
  )
}

describe('RiderActiveTripProvider — optimistic drop-off leg on pickup confirm', () => {
  beforeEach(() => {
    api.store.status = 'arrived_pickup'
    api.store.deferPatch = false
    api.get.mockClear()
    api.patch.mockClear()
    api.post.mockClear()
    useAuthStore.setState({ user: USER, loading: false })
  })

  afterEach(() => {
    api.release()
    useAuthStore.setState({ user: null, loading: false })
  })

  it('flips to OUT_FOR_DELIVERY the instant pickup is confirmed while the PATCH is still in flight', async () => {
    // Hold the confirm request open so the ONLY reason the drop leg appears is
    // the optimistic override — the authoritative status still says
    // `arrived_pickup` for the whole assertion.
    api.store.deferPatch = true
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('trip-state')).toHaveTextContent('ARRIVED_AT_PICKUP'))

    fireEvent.click(screen.getByRole('button', { name: /confirm pickup/i }))

    await waitFor(() => expect(screen.getByTestId('trip-state')).toHaveTextContent('OUT_FOR_DELIVERY'))
    expect(api.store.status).toBe('arrived_pickup')

    api.release()
  })

  it('keeps OUT_FOR_DELIVERY once the authoritative poll reflects the pickup', async () => {
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('trip-state')).toHaveTextContent('ARRIVED_AT_PICKUP'))

    fireEvent.click(screen.getByRole('button', { name: /confirm pickup/i }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(api.store.status).toBe('picked_up'))
    await waitFor(() => expect(screen.getByTestId('trip-state')).toHaveTextContent('OUT_FOR_DELIVERY'))
  })

  it('reverts to ARRIVED_AT_PICKUP when the server rejects the pickup', async () => {
    api.patch.mockRejectedValueOnce({ response: { status: 422, data: { message: 'Collect food first' } } })
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('trip-state')).toHaveTextContent('ARRIVED_AT_PICKUP'))

    fireEvent.click(screen.getByRole('button', { name: /confirm pickup/i }))

    await waitFor(() => expect(screen.getByTestId('trip-state')).toHaveTextContent('ARRIVED_AT_PICKUP'))
    expect(api.store.status).toBe('arrived_pickup')
  })
})