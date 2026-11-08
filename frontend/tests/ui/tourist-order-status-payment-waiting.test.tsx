import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristOrderStatus from '@/features/tourist/pages/TouristOrderStatus'

type PayloadOverrides = {
  status?: string
  paymentMethod?: string
  delivery?: Record<string, unknown> | null
}

const api = vi.hoisted(() => ({
  overrides: {} as PayloadOverrides,
  get: vi.fn(async () => ({
    order: {
      id: 9,
      order_number: 'TT-009',
      status: api.overrides.status ?? 'waiting_restaurant',
      order_type: 'delivery',
      subtotal: 500,
      delivery_fee: 80,
      system_fee: 20,
      total: 600,
      paid_amount: 600,
      payment_method: api.overrides.paymentMethod ?? 'gcash',
      payment_status: 'paid',
      notes: null,
      delivery_address: 'Bansud Town',
      cancelled_at: null,
      cancellation_reason: null,
      completed_at: null,
      created_at: '2026-11-04T10:00:00Z',
      updated_at: '2026-11-04T10:00:00Z',
      business: { id: 1, name: 'Ekslusibo Grill and Restaurant', address: 'A Street', latitude: 12.51, longitude: 121.31 },
      items: [],
    },
    delivery: api.overrides.delivery === undefined
      ? {
          id: 7,
          status: 'waiting',
          dispatch_status: 'pending',
          pickup_address: 'Ekslusibo Grill and Restaurant',
          delivery_address: 'Bansud Town',
          pickup_latitude: 12.51,
          pickup_longitude: 121.31,
          delivery_latitude: 12.6,
          delivery_longitude: 121.4,
          assigned_at: null,
          picked_up_at: null,
          delivered_at: null,
          rider: null,
        }
      : api.overrides.delivery,
    rider_location: null,
    tracking: null,
    delivery_route_active: false,
    pickup_stops: [],
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

describe('TouristOrderStatus online payment waiting message', () => {
  beforeEach(() => {
    api.overrides = {}
    api.get.mockClear()
  })

  it('waits for a rider to accept the delivery offer, not the restaurant', async () => {
    renderOrderStatus()

    expect(await screen.findByRole('heading', { name: 'Payment Successful' })).toBeInTheDocument()
    expect(
      screen.getByText('Your payment has been processed. Waiting for a rider to accept your order delivery offer.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/to accept your order\./i)).not.toBeInTheDocument()
    expect(screen.getByText('Finding Rider')).toBeInTheDocument()
  })

  it('shows rider accepted once a rider accepted the online-paid delivery offer', async () => {
    api.overrides = {
      delivery: {
        id: 7,
        status: 'assigned',
        dispatch_status: 'assigned',
        pickup_address: 'Ekslusibo Grill and Restaurant',
        delivery_address: 'Bansud Town',
        assigned_at: '2026-11-04T10:05:00Z',
        picked_up_at: null,
        delivered_at: null,
        rider: { id: 3, name: 'Rider A', phone: '09170000000' },
      },
    }
    renderOrderStatus()

    expect(await screen.findByRole('heading', { name: 'Rider Accepted' })).toBeInTheDocument()
    expect(screen.queryByText('Payment Successful')).not.toBeInTheDocument()
    expect(screen.getByText(/A rider accepted your delivery offer/i)).toBeInTheDocument()
  })

  it('keeps the COD waiting-for-rider message unchanged', async () => {
    api.overrides = { paymentMethod: 'cash' }
    renderOrderStatus()

    expect(await screen.findByRole('heading', { name: 'Order Placed' })).toBeInTheDocument()
    expect(screen.getByText(/Your COD order has been placed/i)).toBeInTheDocument()
    expect(screen.queryByText('Payment Successful')).not.toBeInTheDocument()
  })
})
