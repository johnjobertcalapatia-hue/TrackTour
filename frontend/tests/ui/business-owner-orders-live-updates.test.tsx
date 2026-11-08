import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BusinessOwnerOrders from '@/features/business-owner/pages/BusinessOwnerOrders'
import BusinessOwnerOrderShow from '@/features/business-owner/pages/BusinessOwnerOrderShow'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'

/**
 * Live updates on the business-owner Orders screens (P11.8).
 *
 * The order → rider-accept → preparing → countdown → auto-ready lifecycle is
 * backend-authoritative (NearestRiderService + PreparationStartService + the
 * minute `orders:advance-preparation` scheduler). These tests prove the Orders
 * list and Order detail pages subscribe to the authorized `business:{id}`
 * room and REFETCH when the canonical events arrive — so a rider acceptance
 * (order → preparing + countdown armed) and the timer reaching 00:00 (→ ready)
 * appear without a manual refresh. HTTP remains the recovery/fallback path.
 */

// Fake Socket.IO surface (same harness as use-rider-socket-receiver tests):
// `io()` returns a fake socket the app registers handlers on; the test
// "server" fires the canonical business-room events through `emit`.
const socketMock = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: never[]) => void>>()
  const fakeSocket = {
    id: 'fake-business-socket',
    connected: true,
    io: { engine: { transport: { name: 'websocket' } } },
    on(event: string, cb: (...args: never[]) => void) {
      const list = handlers.get(event) ?? []
      list.push(cb)
      handlers.set(event, list)
      return fakeSocket
    },
    emit: vi.fn(),
    removeAllListeners() {
      handlers.clear()
    },
    disconnect() {
      handlers.clear()
    },
  }
  const io = vi.fn(() => fakeSocket)
  const emit = (event: string, ...args: unknown[]) => {
    ;(handlers.get(event) ?? []).forEach((cb) => cb(...(args as never[])))
  }
  const reset = () => {
    handlers.clear()
    io.mockClear()
    fakeSocket.emit.mockClear()
    fakeSocket.connected = true
  }
  return { fakeSocket, io, emit, reset }
})

vi.mock('socket.io-client', () => ({
  io: socketMock.io,
  type: {},
}))

// API mock: returns the canonical envelopes exactly as the `get` wrapper
// already unwrapped them (the mock replaces the whole `@/shared/services/api`
// module, so it returns post-unwrap payloads).
const api = vi.hoisted(() => {
  const store = {
    orders: [] as Record<string, unknown>[],
    detail: {} as Record<string, unknown>,
    tokenCalls: 0,
  }
  return {
    store,
    get: vi.fn(async (url: string) => {
      if (url.includes('/business-owner/socket/token')) {
        store.tokenCalls++
        return { businessId: 5, room: 'business:5', token: 'test-token', role: 'business_owner' }
      }
      if (/^\/business-owner\/orders\/\d+/.test(url)) {
        return store.detail
      }
      if (url.startsWith('/business-owner/orders')) {
        return { data: store.orders }
      }
      return {}
    }),
    patch: vi.fn(async () => ({})),
    post: vi.fn(async () => ({})),
    apiErrorMessage: vi.fn(() => 'request failed'),
  }
})

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  patch: api.patch,
  post: api.post,
  apiErrorMessage: api.apiErrorMessage,
}))

const BASE_ITEM = {
  id: 11,
  product_name: 'Sisig',
  quantity: 1,
  unit_price: 300,
  subtotal: 300,
  total_price: 300,
  status: 'pending',
  preparation_time: 12,
}

function listOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    order_number: 'ORD-1001',
    customer_name: 'John Tourist',
    status: 'waiting_restaurant',
    total: 300,
    subtotal: 300,
    delivery_fee: 0,
    discount: 0,
    rider_tip: 0,
    created_at: '2026-09-24T01:00:00Z',
    items: [{ ...BASE_ITEM }],
    ...overrides,
  }
}

function detailOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    order_number: 'ORD-2002',
    customer_name: 'Jane Tourist',
    customer_email: 'jane@example.com',
    customer_phone: '09170000000',
    business_name: 'Restaurant A',
    order_type: 'delivery',
    status: 'preparing',
    subtotal: 300,
    delivery_fee: 40,
    discount: 0,
    total: 340,
    payment_method: 'cash',
    payment_status: 'pending',
    created_at: '2026-09-24T01:00:00Z',
    updated_at: '2026-09-24T01:00:00Z',
    delivery: null,
    preparation_time: 12,
    preparation_started_at: '2026-09-24T01:02:00Z',
    predicted_ready_at: new Date(Date.now() + 12 * 60 * 1000).toISOString(),
    items: [{ ...BASE_ITEM, status: 'preparing' }],
    ...overrides,
  }
}

function renderAt(path: string, node: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/business-owner/orders" element={node} />
          <Route path="/business-owner/orders/:id" element={node} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('BusinessOwnerOrders — live updates from the authorized business room', () => {
  beforeEach(() => {
    socketMock.reset()
    api.store.tokenCalls = 0
    api.get.mockClear()
    api.patch.mockClear()
  })

  it('refetches on delivery.assigned so a rider acceptance reveals preparing + countdown', async () => {
    useBusinessOwnerStore.setState({ selectedBusinessId: 5 })
    api.store.orders = [listOrder()]
    renderAt('/business-owner/orders', <BusinessOwnerOrders />)

    await waitFor(() => expect(screen.getByText(/finding rider/i)).toBeInTheDocument())
    await waitFor(() => expect(api.store.tokenCalls).toBeGreaterThan(0))
    expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/business-owner/orders'))

    const callsBefore = api.get.mock.calls.length

    // A rider accepts: the order becomes preparing and the countdown is armed.
    api.store.orders = [
      listOrder({
        status: 'preparing',
        preparation_started_at: '2026-09-24T01:02:00Z',
        predicted_ready_at: new Date(Date.now() + 12 * 60 * 1000).toISOString(),
        items: [{ ...BASE_ITEM, status: 'preparing' }],
      }),
    ]

    act(() => {
      socketMock.emit('delivery.assigned', { delivery_id: 5, rider_id: 7 })
    })

    await waitFor(() =>
      expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument()
    )
    expect(api.get.mock.calls.length).toBeGreaterThan(callsBefore)
  })

  it('shows a restaurant-confirmed payment without marking the tourist COD as paid', async () => {
    // Reconciled 2026-11-08 (Stage B): the panel follows the RESTAURANT's own
    // payment confirmation, not the rider's purchase ledger.
    useBusinessOwnerStore.setState({ selectedBusinessId: 5 })
    api.store.detail = detailOrder({
      status: 'ready',
      payment_status: 'pending',
      restaurant_purchases: [{ business_id: 5, status: 'paid', paid_at: '2026-09-24T01:15:00Z', payment_confirmed_at: '2026-09-24T01:15:00Z' }],
      items: [{ ...BASE_ITEM, status: 'ready' }],
    })
    renderAt('/business-owner/orders/42', <BusinessOwnerOrderShow />)

    expect(await screen.findByText('Restaurant Purchase')).toBeInTheDocument()
    expect(screen.getByText('Payment received')).toBeInTheDocument()
    expect(screen.getByText(/you can mark the food ready/)).toBeInTheDocument()
    expect(screen.getByText('Payment Status').parentElement?.parentElement).toHaveTextContent(/pending/i)
    expect(screen.getByText(/Tourism Office purchasing cash is separate/)).toBeInTheDocument()
  })

  it('COD: food cannot be marked ready until the restaurant confirms the rider paid', async () => {
    useBusinessOwnerStore.setState({ selectedBusinessId: 5 })
    api.post.mockClear()
    api.store.detail = detailOrder({
      status: 'preparing',
      restaurant_purchases: [{ business_id: 5, status: 'pending', paid_at: null, purchase_amount: 300, payment_confirmed_at: null, rider_arrived_at: null, can_confirm_payment: false }],
      items: [{ ...BASE_ITEM, status: 'preparing' }],
    })
    const { unmount } = renderAt('/business-owner/orders/42', <BusinessOwnerOrderShow />)

    // Rider not here yet: no confirm button, Ready locked.
    expect(await screen.findByText(/Waiting for the rider to arrive and pay/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Payment received' })).not.toBeInTheDocument()
    const itemReady = screen.getByRole('button', { name: /Mark Ready/ })
    expect(itemReady).toBeDisabled()
    expect(itemReady).toHaveAttribute('title', 'Confirm "Payment received" from the rider first')
    unmount()

    // Rider checked in: confirm the payment.
    api.store.detail = detailOrder({
      status: 'preparing',
      restaurant_purchases: [{ business_id: 5, status: 'pending', paid_at: null, purchase_amount: 300, payment_confirmed_at: null, rider_arrived_at: '2026-09-24T01:10:00Z', can_confirm_payment: true }],
      items: [{ ...BASE_ITEM, status: 'preparing' }],
    })
    renderAt('/business-owner/orders/42', <BusinessOwnerOrderShow />)
    expect(await screen.findByText(/The rider is at your restaurant/)).toBeInTheDocument()
    expect(screen.getByText(/Collect ₱300\.00/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Payment received' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/business-owner/orders/42/cod-payment-received', { business_id: 5 }))
  })

  it('shows the auto-ready state on the detail page when the countdown fires', async () => {
    useBusinessOwnerStore.setState({ selectedBusinessId: 5 })
    api.store.detail = detailOrder()
    renderAt('/business-owner/orders/42', <BusinessOwnerOrderShow />)

    await waitFor(() =>
      expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument()
    )
    await waitFor(() => expect(api.store.tokenCalls).toBeGreaterThan(0))

    const detailCallsBefore = api.get.mock.calls.filter(([u]) =>
      /^\/business-owner\/orders\/\d+/.test(String(u))
    ).length

    // Countdown reached 00:00: backend flipped order + items to ready.
    api.store.detail = detailOrder({
      status: 'ready',
      predicted_ready_at: new Date(Date.now() - 1000).toISOString(),
      food_ready_at: '2026-09-24T01:16:00Z',
      items: [{ ...BASE_ITEM, status: 'ready', ready_at: '2026-09-24T01:16:00Z' }],
    })

    act(() => {
      socketMock.emit('order.status.changed', {
        order_id: 42,
        old_status: 'preparing',
        new_status: 'ready',
      })
    })

    await waitFor(() => expect(screen.queryByText(/^\d{2}:\d{2}$/)).toBeNull())
    expect(screen.getAllByText(/ready/i).length).toBeGreaterThan(0)

    const detailCallsAfter = api.get.mock.calls.filter(([u]) =>
      /^\/business-owner\/orders\/\d+/.test(String(u))
    ).length
    expect(detailCallsAfter).toBeGreaterThan(detailCallsBefore)
  })

  it('still loads via HTTP when no business is selected (socket never opened)', async () => {
    useBusinessOwnerStore.setState({ selectedBusinessId: null })
    api.store.orders = [listOrder()]
    renderAt('/business-owner/orders', <BusinessOwnerOrders />)

    await waitFor(() => expect(screen.getByText(/finding rider/i)).toBeInTheDocument())
    expect(api.store.tokenCalls).toBe(0)

    fireEvent.click(screen.getByRole('button', { name: /ORD-1001/i }))
    expect(screen.getByText(/customer information/i)).toBeInTheDocument()
  })

  it('renders a per-item countdown and manual mark-ready button for training items', async () => {
    useBusinessOwnerStore.setState({ selectedBusinessId: 5 })
    api.store.orders = [
      listOrder({
        status: 'preparing',
        preparation_started_at: '2026-09-24T01:02:00Z',
        predicted_ready_at: new Date(Date.now() + 12 * 60 * 1000).toISOString(),
        items: [
          {
            ...BASE_ITEM,
            status: 'preparing',
            preparation_started_at: '2026-09-24T01:02:00Z',
          },
        ],
      }),
    ]
    renderAt('/business-owner/orders', <BusinessOwnerOrders />)

    await waitFor(() => expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /ORD-1001/i }))
    expect(screen.getByRole('button', { name: /mark ready for pickup/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /mark ready for pickup/i }))
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        '/business-owner/orders/1/items/11/status',
        { status: 'ready' }
      )
    )
  })

  it('arms a live countdown + per-item readiness even when predicted_ready_at is missing', async () => {
    useBusinessOwnerStore.setState({ selectedBusinessId: 5 })
    const startedAt = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    api.store.detail = detailOrder({
      predicted_ready_at: null,
      preparation_started_at: startedAt,
      preparation_time: 12,
      items: [
        { ...BASE_ITEM, status: 'preparing', preparation_started_at: startedAt },
        { ...BASE_ITEM, id: 12, product_name: 'Pares', status: 'ready' },
      ],
    })
    renderAt('/business-owner/orders/42', <BusinessOwnerOrderShow />)

    // The order-level "Time Remaining" derives now + prep_time when the server
    // never armed predicted_ready_at (manual "Start Preparing" path).
    await waitFor(() => expect(screen.getAllByText(/^\d{2}:\d{2}$/).length).toBeGreaterThan(0))
    expect(screen.getByText(/estimated ready/i)).toBeInTheDocument()

    // Per-item readiness block replaces the order-level priority row.
    expect(screen.getByText(/item readiness/i)).toBeInTheDocument()
    expect(screen.getByText(/1× Sisig/i)).toBeInTheDocument()
    expect(screen.getByText(/1× Pares/i)).toBeInTheDocument()
    expect(screen.getAllByText(/^Ready$/).length).toBeGreaterThan(0)
  })

  it('does not offer a Complete action on the detail page (business owner cannot complete)', async () => {
    useBusinessOwnerStore.setState({ selectedBusinessId: 5 })
    api.store.detail = detailOrder({
      status: 'ready',
      predicted_ready_at: new Date(Date.now() - 1000).toISOString(),
      food_ready_at: '2026-09-24T01:16:00Z',
      items: [{ ...BASE_ITEM, status: 'ready', ready_at: '2026-09-24T01:16:00Z' }],
    })
    renderAt('/business-owner/orders/42', <BusinessOwnerOrderShow />)

    await waitFor(() => expect(screen.getByText(/order items/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /complete/i })).toBeNull()
    expect(screen.getByText(/no actions available for this status/i)).toBeInTheDocument()
  })
})