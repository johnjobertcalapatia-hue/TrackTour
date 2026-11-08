import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RiderDeliveriesPending from '@/features/rider/pages/RiderDeliveriesPending'
import RiderDeliveryOffer from '@/features/rider/pages/RiderDeliveryOffer'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/shared/services/api', () => api)

const RIDER: User = {
  id: 8,
  name: 'Rider Test',
  email: 'rider-test@example.com',
  role: 'rider',
  account_status: 'approved',
  email_verified_at: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  rider_status: 'online',
  current_service: 'food',
  auto_accept: false,
}

const CARD = {
  id: 42,
  order_id: 73,
  order_number: 'TT-2026-00128',
  status: 'waiting',
  availability: 'available',
  pickup_address: 'Pag-asa, Bansud',
  delivery_address: 'Batingan, Gloria',
  created_at: '2026-10-30T12:00:00Z',
  delivery_speed: 'fast',
  delivery_type_label: 'Priority Delivery',
  pickup_names: ['Eksklusibo Grill'],
  items_count: 3,
  rider_tip: 20,
  delivery_fee: 60,
  distance_km: 4.8,
  payment_method: 'gcash',
  is_cod: false,
  pickup_distance_km: 0.8,
  pickup_stops: 1,
}

const inSeconds = (s: number) => new Date(Date.now() + s * 1000).toISOString()

const OFFER = {
  ...CARD,
  is_mine: false,
  offered_to_me: true,
  reviewing_by_me: true,
  review_expires_at: inSeconds(90),
  review_seconds: 90,
  estimated_duration_minutes: 12,
  pickup: { address: 'Pag-asa, Bansud', latitude: 12.86, longitude: 121.45 },
  dropoff: { address: 'Batingan, Gloria', latitude: 12.96, longitude: 121.46 },
  pickups: [{ id: 2, name: 'Eksklusibo Grill', address: 'Pag-asa, Bansud', logo: null, items_count: 3 }],
  items: [
    { id: 1, business_id: 2, product_name: 'Chicken BBQ', quantity: 2, unit_price: 120, subtotal: 240, notes: null, image: 'menu-items/bbq.jpg' },
    { id: 2, business_id: 2, product_name: 'Pork Sisig', quantity: 1, unit_price: 180, subtotal: 180, notes: 'Extra spicy', image: null },
  ],
  items_total: 420,
}

const restricted = (availability: 'taken' | 'reviewing', over: Record<string, unknown> = {}) => ({
  ...CARD,
  availability,
  status: availability,
  status_label: availability === 'taken' ? 'Already accepted by another rider' : 'Another rider is reviewing this offer',
  delivery_address: null,
  ...over,
})

function StatusStub() {
  const { deliveryId } = useParams()
  return <p>Trip Status Page {deliveryId}</p>
}

function renderAt(path: string | string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const entries = Array.isArray(path) ? path : [path]
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="/rider/deliveries/pending" element={<RiderDeliveriesPending />} />
          <Route path="/rider/deliveries/offer/:deliveryId" element={<RiderDeliveryOffer />} />
          <Route path="/rider/map" element={<p>Active Delivery Map</p>} />
          <Route path="/rider/deliveries/:deliveryId/status" element={<StatusStub />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Available Deliveries → delivery offer', () => {
  beforeEach(() => {
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/rider/deliveries/pending' ? [CARD] : null))
    api.post.mockImplementation((url: string) => Promise.resolve(url === '/rider/deliveries/42/review' ? { ...OFFER, review_expires_at: inSeconds(90) } : null))
    api.patch.mockResolvedValue({ success: true })
    api.del.mockResolvedValue(null)
    useAuthStore.setState({ user: RIDER, loading: false })
  })

  afterEach(() => {
    useAuthStore.setState({ user: null, loading: false })
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('shows the decision facts on each card', async () => {
    renderAt('/rider/deliveries/pending')
    const card = await screen.findByRole('link', { name: 'View offer for order #TT-2026-00128' })
    const c = within(card)
    expect(c.getByText('Order #TT-2026-00128')).toBeInTheDocument()
    expect(c.getByText('Priority')).toBeInTheDocument()
    expect(c.getByText('Eksklusibo Grill')).toBeInTheDocument()
    expect(c.getByText('4.8 km')).toBeInTheDocument()
    expect(c.getByText('₱60.00')).toBeInTheDocument()
    expect(c.getByText('₱20.00')).toBeInTheDocument()
    expect(c.getByText('3 items')).toBeInTheDocument()
    expect(c.getByTestId('board-summary')).toHaveTextContent('0.8 km to first pickup · Eksklusibo Grill · 3 items · 1 pickup stop')
    expect(c.getByText('View Delivery Offer')).toBeInTheDocument()
    expect(card).toHaveAttribute('href', '/rider/deliveries/offer/42')
    // Accepting happens on the offer page, not from the list.
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument()
  })

  it('opening the offer claims the review hold and shows order, type, money, route and items', async () => {
    renderAt('/rider/deliveries/pending')
    fireEvent.click(await screen.findByRole('link', { name: /View offer for order/ }))

    expect(await screen.findByRole('heading', { name: 'Delivery Offer' })).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith('/rider/deliveries/42/review')
    expect(screen.getByText('Order #TT-2026-00128')).toBeInTheDocument()
    expect(screen.getByText('Priority Delivery')).toBeInTheDocument()
    // No visible timer on the review page (the countdown belongs to the ping popup).
    expect(screen.queryByRole('timer')).not.toBeInTheDocument()
    expect(screen.queryByText(/left to decide/)).not.toBeInTheDocument()
    expect(screen.getByText(/Other riders can't view or accept this offer while you review it/)).toBeInTheDocument()

    const overview = within(screen.getByRole('region', { name: 'Delivery overview' }))
    expect(overview.getByText('4.8 km')).toBeInTheDocument()
    expect(overview.getByText('₱60.00')).toBeInTheDocument()
    expect(overview.getByText('₱20.00')).toBeInTheDocument()
    expect(overview.getByText('12 min')).toBeInTheDocument()
    expect(overview.getByText('Paid online')).toBeInTheDocument()

    const route = within(screen.getByRole('region', { name: 'Delivery information' }))
    expect(route.getByText('Eksklusibo Grill')).toBeInTheDocument()
    expect(route.getByText('Batingan, Gloria')).toBeInTheDocument()

    const items = within(screen.getByRole('region', { name: 'Ordered items' }))
    expect(items.getByText('Chicken BBQ')).toBeInTheDocument()
    expect(items.getByText('Quantity: 2')).toBeInTheDocument()
    expect(items.getByText('₱240.00')).toBeInTheDocument()
    expect(items.getByText('Note: Extra spicy')).toBeInTheDocument()
    expect(items.getByText('₱420.00')).toBeInTheDocument()
  })

  it('accepts from the offer page and opens the trip status page without releasing the hold', async () => {
    renderAt('/rider/deliveries/offer/42')
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Accept Delivery/ })) })
    expect(api.patch).toHaveBeenCalledWith('/rider/dispatch/accept', { delivery_id: 42 })
    expect(await screen.findByText('Trip Status Page 42')).toBeInTheDocument()
    expect(api.del).not.toHaveBeenCalled()
  })

  it('declines a pinged offer, releases the hold and returns to the list', async () => {
    renderAt('/rider/deliveries/offer/42')
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Decline Offer' })) })
    expect(api.patch).toHaveBeenCalledWith('/rider/dispatch/decline', { delivery_id: 42 })
    expect(api.del).toHaveBeenCalledWith('/rider/deliveries/42/review')
    expect(await screen.findByRole('link', { name: /View offer for order/ })).toBeInTheDocument()
  })

  it('"Find other offers" releases an open board offer and returns to the list', async () => {
    api.post.mockResolvedValue({ ...OFFER, offered_to_me: false, review_expires_at: inSeconds(90) })
    renderAt('/rider/deliveries/offer/42')
    expect(screen.queryByRole('button', { name: 'Decline Offer' })).not.toBeInTheDocument()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Find other offers' })) })
    expect(api.del).toHaveBeenCalledWith('/rider/deliveries/42/review')
    expect(await screen.findByRole('link', { name: /View offer for order/ })).toBeInTheDocument()
  })

  it('shows an offer another rider is reviewing without details, and lets this rider check again', async () => {
    api.post.mockResolvedValue(restricted('reviewing'))
    renderAt('/rider/deliveries/offer/42')

    expect(await screen.findByRole('status')).toHaveTextContent('Another rider is reviewing this offer')
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Chicken BBQ')).not.toBeInTheDocument()
    expect(screen.queryByText('Batingan, Gloria')).not.toBeInTheDocument()

    // The reviewer let it go: checking again opens it for this rider.
    api.post.mockResolvedValue({ ...OFFER, review_expires_at: inSeconds(90) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check again' })) })
    expect(await screen.findByRole('button', { name: /Accept Delivery/ })).toBeInTheDocument()
  })

  it('lists offers other riders are reviewing or accepted as inert cards', async () => {
    api.get.mockResolvedValue([
      { ...CARD, reviewing_by_me: true },
      restricted('reviewing', { id: 44, order_number: 'TT-2026-00130' }),
      restricted('taken', { id: 43, order_number: 'TT-2026-00129' }),
    ])
    renderAt('/rider/deliveries/pending')

    const mine = await screen.findByRole('link', { name: 'View offer for order #TT-2026-00128' })
    expect(within(mine).getByText("You're reviewing")).toBeInTheDocument()
    expect(within(mine).getByText('Continue reviewing')).toBeInTheDocument()

    const reviewing = screen.getByRole('article', { name: 'order #TT-2026-00130' })
    expect(reviewing).toHaveAttribute('aria-disabled', 'true')
    expect(within(reviewing).getByText('Another rider is reviewing this offer')).toBeInTheDocument()
    expect(within(reviewing).getByText('Being reviewed by another rider')).toBeInTheDocument()
    expect(within(reviewing).queryByRole('link')).not.toBeInTheDocument()

    const taken = screen.getByRole('article', { name: 'order #TT-2026-00129' })
    expect(within(taken).getByText('Already accepted by another rider')).toBeInTheDocument()
    expect(within(taken).getByText('Accepted by another rider')).toBeInTheDocument()
  })

  it('switches the offer page to "already accepted" when another rider wins the race', async () => {
    let won = false
    api.post.mockImplementation(() => Promise.resolve(
      won ? restricted('taken', { pickup_address: 'Pag-asa, Bansud' }) : { ...OFFER, review_expires_at: inSeconds(90) },
    ))
    api.patch.mockImplementation(() => { won = true; return Promise.reject({ response: { status: 409, data: { message: 'This delivery was already accepted by another rider.' } } }) })
    renderAt('/rider/deliveries/offer/42')

    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /Accept Delivery/ })) })

    expect(await screen.findByRole('status')).toHaveTextContent('Already accepted by another rider')
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Batingan, Gloria')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See other deliveries' })).toHaveAttribute('href', '/rider/deliveries/pending')
  })

  it('keeps the review hold alive while the page is open, with no countdown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.patch.mockImplementation((url: string) => Promise.resolve(url.endsWith('/review') ? { held: true } : { success: true }))
    renderAt('/rider/deliveries/offer/42')
    expect(await screen.findByRole('button', { name: /Accept Delivery/ })).toBeInTheDocument()

    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(api.patch).toHaveBeenCalledWith('/rider/deliveries/42/review')
    await act(async () => { vi.advanceTimersByTime(30_000) })
    expect(api.patch.mock.calls.filter(([u]) => u === '/rider/deliveries/42/review')).toHaveLength(2)
    // Still reviewable two minutes in: no expiry state, no timer.
    expect(screen.getByRole('button', { name: /Accept Delivery/ })).toBeInTheDocument()
    expect(screen.queryByText(/review time ended/i)).not.toBeInTheDocument()
  })

  it('shows the current state when the heartbeat reports the hold was lost', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.patch.mockImplementation((url: string) => Promise.resolve(url.endsWith('/review') ? { held: false, reason: 'reviewing' } : { success: true }))
    renderAt('/rider/deliveries/offer/42')
    expect(await screen.findByRole('button', { name: /Accept Delivery/ })).toBeInTheDocument()

    api.post.mockResolvedValue(restricted('reviewing'))
    await act(async () => { vi.advanceTimersByTime(30_000) })

    expect(await screen.findByRole('status')).toHaveTextContent('Another rider is reviewing this offer')
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument()
  })

  it('leaving the page without accepting releases the hold', async () => {
    const view = renderAt('/rider/deliveries/offer/42')
    await screen.findByRole('button', { name: /Accept Delivery/ })
    view.unmount()
    expect(api.del).toHaveBeenCalledWith('/rider/deliveries/42/review')
  })

  it('explains when the offer is no longer available', async () => {
    api.post.mockRejectedValue({ response: { status: 404, data: { message: 'This delivery offer is no longer available.' } } })
    renderAt('/rider/deliveries/offer/99')
    expect(await screen.findByText('This delivery offer is no longer available.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument()
  })

  it('Back from the list never loops into the offer page (map → list → offer → list → Back)', async () => {
    renderAt(['/rider/map', '/rider/deliveries/pending', '/rider/deliveries/offer/42'])
    await act(async () => { fireEvent.click(await screen.findByRole('link', { name: 'Available deliveries' })) })
    expect(await screen.findByRole('heading', { name: 'Available Deliveries' })).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Back' })) })
    expect(await screen.findByText('Active Delivery Map')).toBeInTheDocument()
  })

  it('Back from the list goes to the map even when opened directly', async () => {
    renderAt('/rider/deliveries/pending')
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Back' })) })
    expect(await screen.findByText('Active Delivery Map')).toBeInTheDocument()
  })
})
