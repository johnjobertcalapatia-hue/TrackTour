import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristOrderStatus from '@/features/tourist/pages/TouristOrderStatus'

const api = vi.hoisted(() => ({
  routeActive: false,
  get: vi.fn(async () => ({
    order: {
      id: 9,
      order_number: 'TT-009',
      status: 'preparing',
      order_type: 'delivery',
      subtotal: 500,
      delivery_fee: 80,
      system_fee: 20,
      rider_financed_amount: 520,
      rider_delivery_earnings: 80,
      total: 600,
      paid_amount: 600,
      payment_method: 'gcash',
      payment_status: 'paid',
      notes: null,
      delivery_address: 'Bansud Town',
      cancelled_at: null,
      cancellation_reason: null,
      completed_at: null,
      created_at: '2026-10-30T10:00:00Z',
      updated_at: '2026-10-30T10:00:00Z',
      business: { id: 1, name: 'Restaurant A', address: 'A Street', latitude: 12.51, longitude: 121.31 },
      items: [],
    },
    delivery: {
      id: 7,
      status: api.routeActive ? 'picked_up' : 'arrived_pickup',
      dispatch_status: 'assigned',
      pickup_address: 'Restaurant A',
      delivery_address: 'Bansud Town',
      pickup_latitude: 12.51,
      pickup_longitude: 121.31,
      delivery_latitude: 12.6,
      delivery_longitude: 121.4,
      assigned_at: '2026-10-30T10:00:00Z',
      picked_up_at: api.routeActive ? '2026-10-30T10:25:00Z' : null,
      delivered_at: null,
      rider: { id: 3, name: 'Rider A', phone: '09170000000' },
    },
    rider_location: null,
    tracking: api.routeActive ? { delivery_id: 7, room: 'trip:7', token: 'token', role: 'customer' } : null,
    delivery_route_active: api.routeActive,
    pickup_stops: [
      {
        business_id: 1,
        business_name: 'Restaurant A',
        address: 'A Street',
        latitude: 12.51,
        longitude: 121.31,
        item_count: 2,
        ready_item_count: 2,
        status: api.routeActive ? 'collected' : 'collected',
        is_ready: true,
        arrived_at: '2026-10-30T10:05:00Z',
        pickup_confirmed_at: '2026-10-30T10:10:00Z',
        waiting_seconds: 300,
      },
      {
        business_id: 2,
        business_name: 'Restaurant B',
        address: 'B Street',
        latitude: 12.52,
        longitude: 121.32,
        item_count: 1,
        ready_item_count: api.routeActive ? 1 : 0,
        status: api.routeActive ? 'collected' : 'pending',
        is_ready: api.routeActive,
        arrived_at: api.routeActive ? '2026-10-30T10:15:00Z' : null,
        pickup_confirmed_at: api.routeActive ? '2026-10-30T10:20:00Z' : null,
        waiting_seconds: api.routeActive ? 300 : null,
      },
    ],
  })),
}))

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: vi.fn(),
}))

vi.mock('@/shared/hooks/useCustomerMapSocket', () => ({
  useCustomerMapSocket: () => ({
    connection: 'connected',
    telemetry: null,
    tripCompleted: false,
    tripCancelled: false,
    rejectedReason: null,
    isStale: false,
  }),
}))

vi.mock('@/shared/hooks/useUserSocketNotifier', () => ({
  useUserSocketNotifier: () => ({ connection: 'connected' }),
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children: ReactNode }) => children,
  TileLayer: () => null,
  Marker: () => null,
  Popup: () => null,
  Polyline: () => null,
  useMap: () => ({ setView: vi.fn() }),
}))

function renderOrderStatus() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tourist/order/9']}>
        <Routes>
          <Route path="/tourist/order/:id" element={<TouristOrderStatus />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TouristOrderStatus multi-restaurant pickup journey', () => {
  beforeEach(() => {
    api.routeActive = false
    api.get.mockClear()
  })

  it('shows restaurant preparation and individual pickup progress before the delivery leg', async () => {
    renderOrderStatus()

    expect(await screen.findByRole('heading', { name: /preparing your order/i })).toBeInTheDocument()
    expect(screen.getByText('Restaurant A')).toBeInTheDocument()
    expect(screen.getByText('Restaurant B')).toBeInTheDocument()
    expect(screen.getByText('Pickup confirmed', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText('Live Tracking')).not.toBeInTheDocument()
  })

  it('activates live customer tracking only when the backend enables the delivery route', async () => {
    api.routeActive = true
    renderOrderStatus()

    expect(await screen.findByRole('heading', { name: /live tracking/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/rider a is on the way to you/i)).toBeInTheDocument())
  })
})
