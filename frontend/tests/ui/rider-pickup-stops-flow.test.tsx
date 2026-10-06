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
 * Unified pickup-stop flow ([COD + prepaid] per-restaurant "Confirm Item
 * Pickup" sequence + the delivered "Payment settled?" step).
 *
 * Reality checks:
 *  - The pickup gate blocks `picked_up` until EVERY restaurant stop is
 *    confirmed — for prepaid group orders too, not just COD.
 *  - Confirming a stop hits the canonical POST
 *    `/rider/deliveries/{d}/pickup-stops/{business}/confirm` and the gate flips
 *    open once the authoritative refetch reports `fully_collected`.
 *  - A delivered-but-unsettled COD delivery surfaces the "Payment settled?"
 *    step (from `/rider/deliveries/active`, which keeps `delivered` rows that
 *    the map poll drops) and settling posts `/settle-cod`.
 */

const api = vi.hoisted(() => {
  const store = {
    mapStatus: 'arrived_pickup' as string,
    stops: [
      {
        id: 11,
        business_id: 1,
        business_name: 'Restaurant A',
        sequence: 1,
        preparation_time: 5,
        pickup_lat: 12.51,
        pickup_lng: 121.31,
        pickup_address: 'Rue A',
        status: 'collected',
        pickup_confirmed_at: '2026-09-24T01:00:00Z',
        is_ready: true,
        ready_label: 'ready',
        ready_item_count: 2,
        active_item_count: 2,
        distance_meters: 5,
        can_confirm: false,
        reason: null,
        items: [],
        cod_purchase: null,
      },
      {
        id: 12,
        business_id: 2,
        business_name: 'Restaurant B',
        sequence: 2,
        preparation_time: 10,
        pickup_lat: 12.52,
        pickup_lng: 121.32,
        pickup_address: 'Rue B',
        status: 'pending',
        pickup_confirmed_at: null,
        is_ready: true,
        ready_label: 'ready',
        ready_item_count: 1,
        active_item_count: 1,
        distance_meters: 3,
        can_confirm: true,
        reason: null,
        items: [{ id: 7, product_name: 'Adobo', quantity: 2, unit_price: 99, subtotal: 198, notes: null, status: 'ready' }],
        cod_purchase: null,
      },
    ],
    activeDeliveries: [] as Array<Record<string, unknown>>,
  }

  const fullyCollected = () => store.stops.every((s) => s.status === 'collected')

  return {
    store,
    fullyCollected,
    get: vi.fn(async (url: string) => {
      if (url === '/rider/map/location') {
        return {
          rider: { latitude: 12.8667, longitude: 121.45 },
          deliveries: [
            {
              id: 7,
              order_id: 9,
              status: store.mapStatus,
              pickup_address: 'Restaurant St, Bansud',
              pickup_lat: 12.5,
              pickup_lng: 121.3,
              delivery_address: 'Droppoint St, Bansud',
              delivery_lat: 12.55,
              delivery_lng: 121.2,
              business_name: 'GPS Cafe',
            },
          ],
        }
      }
      if (url === '/rider/deliveries/7/pickup-stops') {
        return {
          delivery_id: 7,
          is_cod: false,
          purchasing_cash: null,
          purchasing_cash_issued_at: null,
          purchasing_cash_received_at: null,
          fully_collected: fullyCollected(),
          pickup_origin: null,
          dropoff: { latitude: 12.55, longitude: 121.2, address: 'Droppoint St, Bansud' },
          stops: store.stops.map((s) => ({ ...s })),
        }
      }
      if (url === '/rider/deliveries/active') {
        return { data: store.activeDeliveries.map((d) => ({ ...d })) }
      }
      return {}
    }),
    post: vi.fn(async (url: string, body?: unknown) => {
      if (url === '/rider/deliveries/7/pickup-stops/2/confirm') {
        const stop = store.stops.find((s) => s.business_id === 2)
        if (stop) {
          stop.status = 'collected'
          stop.pickup_confirmed_at = '2026-09-24T01:05:00Z'
        }
        return { success: true, all_confirmed: fullyCollected(), stop: { ...stop } }
      }
      if (url.endsWith('/settle-cod')) {
        return { cash_due: 355, cash_received: (body as { cash_received: number }).cash_received }
      }
      return {}
    }),
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
  const {
    tripState,
    pickupGateMessage,
    pickupStopsData,
    onMarkPickedUp,
    confirmPickupStop,
    pendingSettlement,
    settleCod,
  } = useRiderActiveTrip()
  return (
    <div>
      <span data-testid="trip-state">{tripState}</span>
      <span data-testid="gate-message">{pickupGateMessage ?? ''}</span>
      <span data-testid="fully-collected">{String(pickupStopsData?.fully_collected ?? false)}</span>
      <span data-testid="stops-confirmed">
        {(pickupStopsData?.stops ?? []).filter((s) => s.status === 'collected').length}
      </span>
      <span data-testid="settlement">{pendingSettlement ? `COD#${pendingSettlement.deliveryId}` : 'none'}</span>
      <button type="button" onClick={onMarkPickedUp}>
        Confirm Pickup
      </button>
      <button type="button" onClick={() => confirmPickupStop(2)}>
        Confirm Stop 2
      </button>
      <button type="button" onClick={() => settleCod(355)}>
        Settle COD
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

describe('RiderActiveTripProvider — unified pickup stops (prepaid/COD) + payment settled', () => {
  beforeEach(() => {
    api.store.mapStatus = 'arrived_pickup'
    api.store.stops[0].status = 'collected'
    api.store.stops[1].status = 'pending'
    api.store.activeDeliveries = []
    api.get.mockClear()
    api.post.mockClear()
    api.patch.mockClear()
    useAuthStore.setState({ user: USER, loading: false })
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, loading: false })
  })

  it('keeps the pickup gate shut until every restaurant stop is confirmed (prepaid too)', async () => {
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('gate-message')).toHaveTextContent(/collect food from every restaurant/i))
    expect(screen.getByTestId('fully-collected')).toHaveTextContent('false')
    expect(screen.getByTestId('stops-confirmed')).toHaveTextContent('1')

    fireEvent.click(screen.getByRole('button', { name: /confirm pickup/i }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(0))

    fireEvent.click(screen.getByRole('button', { name: /confirm stop 2/i }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/rider/deliveries/7/pickup-stops/2/confirm')
    )

    await waitFor(() => expect(screen.getByTestId('fully-collected')).toHaveTextContent('true'))
    await waitFor(() => expect(screen.getByTestId('gate-message')).toHaveTextContent(''))

    fireEvent.click(screen.getByRole('button', { name: /confirm pickup/i }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1))
  })

  it('surfaces the delivered-unsettled COD payment step and settles it via /settle-cod', async () => {
    api.store.activeDeliveries = [
      {
        id: 77,
        order_id: 99,
        status: 'delivered',
        is_cod: true,
        cash_due: 355,
        cash_received: null,
        cash_settled_at: null,
      },
    ]
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('settlement')).toHaveTextContent('COD#77'))

    fireEvent.click(screen.getByRole('button', { name: /settle cod/i }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/rider/deliveries/77/settle-cod',
      { cash_received: 355 }
    ))
  })

  it('does not show the payment step for a delivered non-COD delivery', async () => {
    api.store.activeDeliveries = [
      {
        id: 78,
        order_id: 100,
        status: 'delivered',
        is_cod: false,
        cash_due: null,
        cash_settled_at: null,
      },
    ]
    renderProbe()

    await waitFor(() => expect(screen.getByTestId('settlement')).toHaveTextContent('none'))
  })
})