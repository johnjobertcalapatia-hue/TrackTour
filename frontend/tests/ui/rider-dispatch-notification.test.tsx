import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RiderDispatchNotification from '@/features/rider/components/RiderDispatchNotification'
import type { RiderDeliveryRequestData } from '@/features/rider/components/RiderDeliveryRequestAlert'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

// ---- Shared mocks (hoisted so vi.mock factories can use them) ----

const socketMock = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...args: never[]) => void>>()
  const fakeSocket = {
    id: 'fake-socket-riderno',
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

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}))

vi.mock('socket.io-client', () => ({ io: socketMock.io, type: {} }))
vi.mock('@/shared/services/api', () => apiMock)

// ---- Fixtures ----

const RIDER_USER: User = {
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

const OFFER: RiderDeliveryRequestData = {
  id: 1,
  delivery_id: 42,
  order_id: 99,
  order_number: 'TT-00099',
  business_name: 'Restaurant A',
  business_address: '123 Aquino St, Bansud',
  pickup_address: '123 Aquino St, Bansud',
  delivery_address: '456 Mabini St, Bansud',
  subtotal: 480,
  rider_payout: 60,
  distance_km: 2.4,
  duration_minutes: 15,
  items: [
    { name: 'Burger', quantity: 1, price: 120, subtotal: 120 },
    { name: 'Fries', quantity: 1, price: 80, subtotal: 80 },
  ],
  restaurant_count: 1,
  expires_in: 45,
  dispatched_at: '2026-09-24T00:00:00Z',
}

// ---- Harness ----

function renderDispatch() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/rider/notifications']}>
        <RiderDispatchNotification />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

/** Advance the alert out of the "loading" drawer into the actual request card. */
function revealReceipt() {
  const simulate = screen.getByRole('button', { name: /simulate receipt pop/i })
  fireEvent.click(simulate)
}

// ---- Tests ----

describe('RiderDispatchNotification — real incoming order ping renders rider UI', () => {
  beforeEach(() => {
    socketMock.reset()
    apiMock.get.mockReset()
    apiMock.patch.mockReset()
    localStorage.setItem('auth_token', 'test-token')
    useAuthStore.setState({ user: RIDER_USER, loading: false })
  })

  it('shows NO card before the ping when there are no offers', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/rider/dispatch/offers') return Promise.resolve({ offers: [] })
      if (url === '/user') return Promise.resolve(RIDER_USER)
      return Promise.resolve({})
    })

    renderDispatch()

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/rider/dispatch/offers'))

    expect(screen.queryByText(/new booking request/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept order request/i })).not.toBeInTheDocument()
  })

  it('socket ping → React state → rendered card with order details + Accept', async () => {
    let offersResponse: unknown[] = []
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/rider/dispatch/offers') return Promise.resolve({ offers: offersResponse })
      if (url === '/user') return Promise.resolve(RIDER_USER)
      return Promise.resolve({})
    })

    renderDispatch()
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/rider/dispatch/offers'))
    expect(screen.queryByText(/new booking request/i)).not.toBeInTheDocument()

    // A rider backend offer now exists for THIS rider.
    offersResponse = [OFFER]

    // The socket engine delivers a fresh ping → onOrderPing refetches offers.
    act(() => {
      socketMock.emit('order_received_ping', {
        deliveryId: '42',
        restaurantName: 'Restaurant A',
        timeoutSeconds: 45,
        distanceKm: 1.2,
      })
    })

    // The "Request Incoming" drawer is the instantaneous new-order signal…
    await screen.findByText(/new booking detected/i)
    // …and the HTTP-recovered receipt card follows.
    revealReceipt()
    await screen.findByRole('heading', { name: /new booking request/i })

    // Order details the rider actually sees.
    expect(screen.getByText(/TT-00099/)).toBeInTheDocument()
    expect(screen.getAllByText('Restaurant A').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('123 Aquino St, Bansud')).toBeInTheDocument()
    expect(screen.getByText('456 Mabini St, Bansud')).toBeInTheDocument()
    expect(screen.getByText('Burger')).toBeInTheDocument()
    expect(screen.getByText('Fries')).toBeInTheDocument()
    expect(screen.getByText(/2.4 km/)).toBeInTheDocument()
    expect(screen.getByText('15 mins')).toBeInTheDocument()
    expect(screen.getByText(/₱\s*60\.00/)).toBeInTheDocument()

    const accept = screen.getByRole('button', { name: /accept order request/i })
    const decline = screen.getByRole('button', { name: /decline offer/i })
    expect(accept).toBeInTheDocument()
    expect(decline).toBeInTheDocument()
  })

  it('Accept calls the canonical dispatch API and shows the accepted confirmation', async () => {
    let offersResponse: unknown[] = [OFFER]
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/rider/dispatch/offers') return Promise.resolve({ offers: offersResponse })
      if (url === '/user') return Promise.resolve(RIDER_USER)
      return Promise.resolve({})
    })
    apiMock.patch.mockResolvedValue({ success: true, data: { success: true } })

    renderDispatch()
    await screen.findByText(/new booking detected/i)
    revealReceipt()
    await screen.findByRole('heading', { name: /new booking request/i })
    await screen.findByRole('button', { name: /accept order request/i })

    fireEvent.click(screen.getByRole('button', { name: /accept order request/i }))

    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/rider/dispatch/accept', { delivery_id: 42 })
    )
    await screen.findByText(/order accepted/i)
    void offersResponse
  })

  it('polling recovery: no socket ping at all — the HTTP offers poll still surfaces the card', async () => {
    // Socket never emits a ping (server unreachable / events missed). The only
    // recovery source is the /rider/dispatch/offers HTTP poll.
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/rider/dispatch/offers') return Promise.resolve({ offers: [OFFER] })
      if (url === '/user') return Promise.resolve(RIDER_USER)
      return Promise.resolve({})
    })
    apiMock.patch.mockResolvedValue({ success: true, data: { success: true } })

    renderDispatch()

    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/rider/dispatch/offers'))
    await screen.findByText(/new booking detected/i)
    revealReceipt()

    await screen.findByRole('heading', { name: /new booking request/i })
    expect(screen.getByText('456 Mabini St, Bansud')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /accept order request/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /accept order request/i }))
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/rider/dispatch/accept', { delivery_id: 42 })
    )
  })

  it('duplicate pings for the same delivery never create a second card', async () => {
    let offersResponse: unknown[] = []
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/rider/dispatch/offers') return Promise.resolve({ offers: offersResponse })
      if (url === '/user') return Promise.resolve(RIDER_USER)
      return Promise.resolve({})
    })

    renderDispatch()
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/rider/dispatch/offers'))

    offersResponse = [OFFER]

    act(() => {
      socketMock.emit('order_received_ping', { deliveryId: '42', restaurantName: 'Restaurant A', timeoutSeconds: 45, distanceKm: 1.2 })
    })
    act(() => {
      socketMock.emit('order_received_ping', { deliveryId: '42', restaurantName: 'Restaurant A', timeoutSeconds: 45, distanceKm: 1.2 })
    })

    await screen.findByText(/new booking detected/i)
    revealReceipt()
    await screen.findByRole('heading', { name: /new booking request/i })

    // A repeated ping for an already-shown delivery just reconciles the same
    // single offer — exactly one accept action, one card.
    act(() => {
      socketMock.emit('order_received_ping', { deliveryId: '42', restaurantName: 'Restaurant A', timeoutSeconds: 45, distanceKm: 1.2 })
    })

    expect(screen.getAllByRole('button', { name: /accept order request/i })).toHaveLength(1)
    expect(screen.getAllByRole('heading', { name: /new booking request/i })).toHaveLength(1)
  })

  it('a rider with no server-side offer never renders the ping card (wrong-rider isolation)', async () => {
    // The backend only returns THIS rider's offers; an offer aimed at another
    // rider never reaches this client, and the UI must stay silent.
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/rider/dispatch/offers') return Promise.resolve({ offers: [] })
      if (url === '/user') return Promise.resolve(RIDER_USER)
      return Promise.resolve({})
    })

    renderDispatch()
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith('/rider/dispatch/offers'))

    // Even a stray ping on the socket (which the server should never send to
    // this rider) can only reconcile the empty HTTP list → nothing renders.
    act(() => {
      socketMock.emit('order_received_ping', { deliveryId: '999', restaurantName: 'Other Rider Offer', timeoutSeconds: 30, distanceKm: 5 })
    })

    expect(screen.queryByRole('heading', { name: /new booking request/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept order request/i })).not.toBeInTheDocument()
  })
})