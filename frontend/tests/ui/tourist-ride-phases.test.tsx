import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristTransportTracking from '@/features/tourist/pages/TouristTransportTracking'

/**
 * Ride-hailing redesign (2026-11-10): the tourist's ride screens after
 * booking follow the "5 seamless phases" mockup — 2 finding your driver,
 * 3 driver on the way (ETA card, driver card, progress, PIN at pickup),
 * 4 in-trip (ETA + distance, SOS, share), 5 completed (fare, paid via,
 * stars + feedback → rate endpoint).
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: api.post, apiErrorMessage: (_e: unknown, f: string) => f, default: { get: api.get, post: api.post } }))
vi.mock('@/shared/services/payment', async (orig) => ({ ...(await orig<typeof import('@/shared/services/payment')>()), createCheckoutSession: vi.fn() }))
vi.mock('@/shared/hooks/useCustomerMapSocket', () => ({
  useCustomerMapSocket: () => ({ connection: 'connected', telemetry: null, tripCompleted: false, tripCancelled: false, isStale: false }),
}))
vi.mock('@/shared/hooks/useUserSocketNotifier', () => ({ useUserSocketNotifier: () => ({ connection: 'connected' }) }))
vi.mock('@/features/rider/hooks/useOsrmRoute', () => ({ useOsrmRoute: () => ({ points: [], distanceKm: 2.8, durationMin: 8 }) }))
vi.mock('@/shared/utils/map-markers', () => ({ riderMarkerIcon: {}, pickupMarkerIcon: {}, destinationMarkerIcon: {} }))
vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'map' }, children),
    TileLayer: Empty, Marker: Empty, Popup: Empty, Polyline: Empty,
    useMap: () => ({ setView: vi.fn() }),
  }
})

const TRIP = {
  id: 31, order_number: 'TR-31', status: 'searching',
  pickup_address: 'Bansud Municipal Hall', pickup_latitude: 12.86, pickup_longitude: 121.45,
  destination_address: 'Ekslusibo Grill', destination_latitude: 12.87, destination_longitude: 121.46,
  vehicle_type: 'car', vehicle_color: 'white', passenger_count: 1, payment_method: 'gcash', payment_status: 'pending', paid_amount: 0,
  fare: 120, base_fare: 50, distance_fare: 70, service_fee: 0, estimate_fare: 120, distance_km: 3.2, duration_min: 10, eta_minutes: 10,
  rider: null, rider_location: null, tracking: null,
  is_rated: false, rating: null, review: null, rating_tags: [], allowed_rating_tags: ['Safe driving', 'Friendly'],
  created_at: new Date(Date.now() - 18_000).toISOString(), started_at: null, completed_at: null, cancelled_at: null, cancellation_reason: null, cancellation_fee: 0,
}
const DRIVER = {
  id: 7, name: 'Juan Dela Cruz', rating: 4.9, contact_number: '09171234567', photo: null,
  vehicle_type: 'car', vehicle_make: 'Toyota', vehicle_model: 'Vios', plate_number: 'NDC 7421',
}

function renderTrip(over: Record<string, unknown>) {
  api.get.mockResolvedValue({ ...TRIP, ...over })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tourist/transport/tracking/31']}>
        <Routes>
          <Route path="/tourist/transport/tracking/:id" element={<TouristTransportTracking />} />
          <Route path="/tourist/transport" element={<p>Transport home</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  api.post.mockResolvedValue({})
})

describe('Ride screens after booking', () => {
  it('2 · finding your driver: full-screen search with a timer and Cancel Request', async () => {
    renderTrip({ status: 'searching' })
    const screenEl = await screen.findByRole('region', { name: 'Finding your driver' })
    expect(within(screenEl).getByText('Finding your driver…')).toBeInTheDocument()
    expect(within(screenEl).getByText(/nearby car driver/)).toBeInTheDocument()
    expect(within(screenEl).getByLabelText(/^Searching for \d\d:\d\d$/)).toBeInTheDocument()
    expect(screen.queryByTestId('map')).not.toBeInTheDocument()
    // Fills exactly the space under the header (.tourist-map-page): nothing around it
    // is a full screen tall, so the page never scrolls.
    expect(screenEl).toHaveClass('tourist-map-page')
    expect(document.body.querySelector('[class*="min-h-[100dvh]"], .min-h-screen')).toBeNull()

    fireEvent.click(within(screenEl).getByRole('button', { name: 'Cancel Request' }))
    expect(screen.getByRole('dialog', { name: 'Cancel Ride' })).toBeInTheDocument()
  })

  it('3 · driver on the way: ETA card, driver card with call, progress and the trip', async () => {
    renderTrip({ status: 'arriving', rider: DRIVER })
    expect(await screen.findByTestId('ride-eta-banner')).toHaveTextContent('Arriving in 8 min')
    const card = screen.getByTestId('ride-driver-card')
    expect(card).toHaveTextContent('Juan Dela Cruz')
    expect(card).toHaveTextContent('4.9')
    expect(card).toHaveTextContent('Toyota Vios')
    expect(card).toHaveTextContent('NDC 7421')
    expect(within(card).getByRole('link', { name: 'Call Juan Dela Cruz' })).toHaveAttribute('href', 'tel:09171234567')
    expect(screen.getByRole('list', { name: 'Ride progress' })).toBeInTheDocument()
    expect(screen.getByText('Bansud Municipal Hall')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Share trip/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'SOS' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel ride' })).toBeInTheDocument()

    // Cancel ride opens its dialog ABOVE the map and the bottom panel (2026-11-18:
    // at z-50 it opened hidden behind them, so the button seemed to do nothing).
    fireEvent.click(screen.getByRole('button', { name: 'Cancel ride' }))
    const dialog = screen.getByRole('dialog', { name: 'Cancel Ride' })
    const zOf = (el: Element | null) => Number(/(?:^|\s)z-\[(\d+)\]/.exec(el?.className ?? '')?.[1] ?? 0)
    const panel = screen.getByRole('button', { name: 'Cancel ride' }).closest('[class*="z-["]')
    expect(zOf(dialog)).toBeGreaterThan(zOf(panel))
    expect(zOf(dialog)).toBeGreaterThan(1000) // Leaflet panes and controls

    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm Cancel' })) })
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/transport/trip/31/cancel', { reason: '' }))
  })

  // Decision 2026-11-11: no passenger pickup PIN in TrackTour ride hailing.
  it('3 · at pickup: the driver has arrived and no PIN is shown', async () => {
    renderTrip({ status: 'driver_arrived', rider: DRIVER })
    expect(await screen.findByTestId('ride-eta-banner')).toHaveTextContent('Your driver has arrived')
    expect(screen.queryByLabelText('Ride PIN')).toBeNull()
    expect(screen.queryByText(/PIN/)).toBeNull()
  })

  it('4 · in trip: ETA and distance; holding SOS for 3 s alerts the Tourism Office and opens the safety options', async () => {
    renderTrip({ status: 'in_progress', rider: DRIVER })
    const stats = await screen.findByTestId('ride-trip-stats')
    expect(stats).toHaveTextContent('8 min')
    expect(stats).toHaveTextContent('2.8 km')
    expect(screen.getByTestId('ride-eta-banner')).toHaveTextContent('Heading to your destination')

    // The phone's GPS answers with a position.
    vi.mocked(navigator.geolocation.getCurrentPosition).mockImplementation((ok) => ok({ coords: { latitude: 12.861, longitude: 121.452, accuracy: 15 } } as GeolocationPosition))

    // SOS (2026-11-18): a tap or a short press sends nothing.
    const sos = screen.getByRole('button', { name: /^SOS: hold for 3 seconds/ })
    vi.useFakeTimers()
    try {
      fireEvent.click(sos)
      fireEvent.pointerDown(sos)
      act(() => { vi.advanceTimersByTime(2000) })
      expect(sos).toHaveTextContent(/Keep holding… 1/)
      fireEvent.pointerUp(sos)
      act(() => { vi.advanceTimersByTime(3000) })
      expect(api.post).not.toHaveBeenCalledWith('/tourist/transport/trip/31/sos', expect.anything())

      // Held for 3 seconds: sent with the phone's location.
      // Once sent, the trip status carries the tourist's SOS.
      api.post.mockImplementation(async (url: string) => {
        if (url === '/tourist/transport/trip/31/sos') {
          api.get.mockResolvedValue({
            ...TRIP, status: 'in_progress', rider: DRIVER,
            sos: { id: 1, reference: 'SOS-261118-AB12', status: 'pending', active: true, raised_at: new Date().toISOString(), acknowledged_at: null, responding_at: null, responder: null, sender_safe_at: null, resolved_at: null },
          })
          return { sos: { id: 1, reference: 'SOS-261118-AB12', status: 'pending', active: true } }
        }
        return {}
      })
      const sosAgain = screen.getByRole('button', { name: /^SOS: hold for 3 seconds/ })
      fireEvent.pointerDown(sosAgain)
      // Past the hold, and let the queued request start before real timers return.
      await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
    } finally {
      vi.useRealTimers()
    }
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/transport/trip/31/sos', { latitude: 12.861, longitude: 121.452, accuracy: 15 }))

    const dialog = await screen.findByRole('dialog', { name: 'Safety' })
    const card = await within(dialog).findByRole('status', { name: 'Your SOS' })
    expect(card).toHaveTextContent('SOS sent')
    expect(card).toHaveTextContent('SOS-261118-AB12')
    expect(within(card).getByRole('link', { name: /Call 911/ })).toHaveAttribute('href', 'tel:911')

    // "I'm safe now" tells the office; the SOS stays open until they close it.
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: "I'm safe now" })) })
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/transport/trip/31/sos/safe'))
  })

  it('the trip panel collapses to a bar that still has the SOS hold button, and expands again', async () => {
    renderTrip({ status: 'in_progress', rider: DRIVER })
    await screen.findByTestId('ride-trip-stats')

    fireEvent.click(screen.getByRole('button', { name: 'Hide trip details' }))
    expect(screen.queryByTestId('ride-trip-stats')).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Show trip details' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: /^SOS: hold for 3 seconds/ })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Show trip details' }))
    expect(screen.getByTestId('ride-trip-stats')).toBeVisible()
  })

  it('5 · completed: fare, payment, stars + feedback sent to the rate endpoint', async () => {
    renderTrip({ status: 'completed', rider: DRIVER, payment_status: 'paid', paid_amount: 120 })
    const done = await screen.findByRole('region', { name: 'Ride completed' })
    expect(within(done).getByText('Ride Completed!')).toBeInTheDocument()
    expect(within(done).getByText('₱120.00')).toBeInTheDocument()
    expect(within(done).getByText('Paid via GCash')).toBeInTheDocument()

    const submit = within(done).getByRole('button', { name: 'Submit Review' })
    expect(submit).toBeDisabled()
    fireEvent.click(within(done).getByRole('radio', { name: '5 stars' }))
    fireEvent.click(within(done).getByRole('button', { name: 'Safe driving' }))
    fireEvent.change(within(done).getByPlaceholderText(/Leave a feedback/), { target: { value: 'Great ride' } })
    await act(async () => { fireEvent.click(submit) })

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/transport/trip/31/rate', { rating: 5, review: 'Great ride', tags: ['Safe driving'] }))
  })

  it('5 · cash ride reads "Pay your driver in cash"; a rated ride shows the thanks', async () => {
    renderTrip({ status: 'completed', rider: DRIVER, payment_method: 'cash', is_rated: true, rating: 4 })
    const done = await screen.findByRole('region', { name: 'Ride completed' })
    expect(within(done).getByText('Pay your driver in cash')).toBeInTheDocument()
    expect(within(done).getByText('Thanks for your review!')).toBeInTheDocument()
    expect(within(done).queryByRole('button', { name: 'Submit Review' })).not.toBeInTheDocument()
  })

  it('a cancelled ride offers to book another', async () => {
    renderTrip({ status: 'cancelled', cancellation_reason: 'No driver available' })
    expect(await screen.findByText('Ride cancelled')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Book another ride' }))
    expect(await screen.findByText('Transport home')).toBeInTheDocument()
  })
})

describe('QR Ph (2026-11-18)', () => {
  it('a ride paid on PayMongo with QR Ph says so; before paying it offers GCash or QR Ph', async () => {
    const { unmount } = renderTrip({ status: 'completed', rider: DRIVER, payment_status: 'paid', paid_amount: 120, paid_via: 'qrph' })
    const done = await screen.findByRole('region', { name: 'Ride completed' })
    expect(within(done).getByText('Paid via QR Ph')).toBeInTheDocument()
    unmount()

    renderTrip({ status: 'in_progress', rider: DRIVER, payment_method: 'gcash', payment_status: 'pending' })
    expect(await screen.findByText(/· GCash or QR Ph$/)).toBeInTheDocument()
  })
})

describe('Cancellation fee alert (2026-11-18)', () => {
  it('right after cancelling, the tourist is told about the ₱50 fee and why', async () => {
    renderTrip({ status: 'arriving', rider: DRIVER })
    api.post.mockImplementation(async (url: string) => url === '/tourist/transport/trip/31/cancel'
      ? {
          status: 'cancelled', cancellation_fee: 50,
          cancellation_penalty: {
            id: 7, amount: 50, status: 'under_review', rider_name: 'Juan Dela Cruz', seconds_after_acceptance: 1018, review_reasons: [],
            disputed_at: null, dispute_reason: null, can_dispute: true, can_pay: false,
            notice: { title: '₱50.00 cancellation fee under review', message: 'You cancelled ride TRP-31 17 min after your driver accepted (cancelling is free for the first 5 minutes). A ₱50.00 cancellation fee may apply. The Tourism Office will review it first; nothing is charged until then.' },
          },
        }
      : {})

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel ride' }))
    await act(async () => { fireEvent.click(within(screen.getByRole('dialog', { name: 'Cancel Ride' })).getByRole('button', { name: 'Confirm Cancel' })) })

    const alert = await screen.findByRole('alertdialog', { name: '₱50.00 cancellation fee under review' })
    expect(alert).toHaveTextContent('17 min after your driver accepted')
    expect(alert).toHaveTextContent('nothing is charged until then')
    expect(within(alert).queryByRole('button', { name: 'Pay now' })).toBeNull() // under review: nothing to pay
    fireEvent.click(within(alert).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })
})
