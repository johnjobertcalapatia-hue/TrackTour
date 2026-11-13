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
vi.mock('@/shared/services/api', () => ({ get: api.get, post: api.post, default: { get: api.get, post: api.post } }))
vi.mock('@/shared/services/payment', () => ({ createCheckoutSession: vi.fn() }))
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
  })

  // Decision 2026-11-11: no passenger pickup PIN in TrackTour ride hailing.
  it('3 · at pickup: the driver has arrived and no PIN is shown', async () => {
    renderTrip({ status: 'driver_arrived', rider: DRIVER })
    expect(await screen.findByTestId('ride-eta-banner')).toHaveTextContent('Your driver has arrived')
    expect(screen.queryByLabelText('Ride PIN')).toBeNull()
    expect(screen.queryByText(/PIN/)).toBeNull()
  })

  it('4 · in trip: ETA and distance, SOS opens the safety options', async () => {
    renderTrip({ status: 'in_progress', rider: DRIVER })
    const stats = await screen.findByTestId('ride-trip-stats')
    expect(stats).toHaveTextContent('8 min')
    expect(stats).toHaveTextContent('2.8 km')
    expect(screen.getByTestId('ride-eta-banner')).toHaveTextContent('Heading to your destination')
    fireEvent.click(screen.getByRole('button', { name: 'SOS' }))
    expect(screen.getByRole('dialog', { name: 'Safety' })).toBeInTheDocument()
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
