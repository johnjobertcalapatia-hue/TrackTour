import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RiderActiveTripProvider } from '@/features/rider/context/RiderActiveTripContext'
import RiderOrderInfoSheet from '@/features/rider/components/RiderOrderInfoSheet'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

/**
 * The "Pickup Stops · X/Y confirmed" block lives inside the "Order details"
 * panel (RiderOrderInfoSheet) — the sheet that renders directly below the
 * Service Types quick-action grid on the rider layout. This test locks that
 * placement in: expanding the sheet must surface the per-restaurant pickup
 * stop cards as a VIEW-ONLY status summary. All pickup confirmation moved to
 * the appearing message (GlobalRiderAlert), so the sheet must expose no
 * confirm/navigate/cash actions.
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
        return { data: [] }
      }
      return {}
    }),
    post: vi.fn(async (url: string) => {
      if (url === '/rider/deliveries/7/pickup-stops/2/confirm') {
        const stop = store.stops.find((s) => s.business_id === 2)
        if (stop) {
          stop.status = 'collected'
          stop.pickup_confirmed_at = '2026-09-24T01:05:00Z'
        }
        return { success: true, all_confirmed: fullyCollected(), stop: { ...stop } }
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

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RiderActiveTripProvider>
        <RiderOrderInfoSheet />
      </RiderActiveTripProvider>
    </QueryClientProvider>
  )
}

describe('RiderOrderInfoSheet — pickup stops inside the Order details panel', () => {
  beforeEach(() => {
    api.store.mapStatus = 'arrived_pickup'
    api.store.stops[0].status = 'collected'
    api.store.stops[1].status = 'pending'
    api.get.mockClear()
    api.post.mockClear()
    api.patch.mockClear()
    useAuthStore.setState({ user: USER, loading: false })
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, loading: false })
  })

  it('surfaces the pickup-stop panel below Service Types once the Order details sheet is expanded', async () => {
    renderSheet()

    await waitFor(() => expect(screen.getByRole('button', { name: /show order details/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /show order details/i }))

    await waitFor(() => expect(screen.getByText(/pickup stops · 1\/2 confirmed/i)).toBeInTheDocument())
    expect(screen.getByText(/confirm the item pickup at every restaurant in order/i)).toBeInTheDocument()
    expect(screen.getAllByText('Restaurant A').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Restaurant B').length).toBeGreaterThan(0)
    expect(screen.getByText(/collected ✓/i)).toBeInTheDocument()
  })

  it('keeps the sheet view-only: no per-stop confirm, navigate, cash-confirm, or Start Delivery actions', async () => {
    renderSheet()

    await waitFor(() => expect(screen.getByRole('button', { name: /show order details/i })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /show order details/i }))

    await waitFor(() => expect(screen.getByText(/pickup stops · 1\/2 confirmed/i)).toBeInTheDocument())

    // The appearing message (GlobalRiderAlert) owns pickup confirmation now.
    expect(screen.queryByRole('button', { name: /confirm item pickup/i })).not.toBeInTheDocument()

    // No navigation/settlement actions remain in the read-only panel.
    expect(screen.queryByText(/navigate/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirm cash received/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /start delivery/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/all food collected — you can now leave for delivery/i)).not.toBeInTheDocument()

    // The confirmation cannot be triggered from the sheet at all.
    expect(api.post).not.toHaveBeenCalled()
  })
})