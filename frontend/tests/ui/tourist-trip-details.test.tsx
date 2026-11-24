import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, default: { get: api.get } }))
// No map on this page: if one were rendered, this mock would show it.
vi.mock('react-leaflet', () => ({ MapContainer: () => <div data-testid="map" /> }))

import TouristTripDetails, { durationBetween } from '@/features/tourist/pages/TouristTripDetails'

/** My Activities › Travels › a trip (2026-11-18): route names + coordinates (no map), fare, payment, driver, times. */

const COMPLETED = {
  id: 31, order_number: 'TRP-6AFC87A813AD4', status: 'completed',
  pickup_address: 'Gloria, Oriental Mindoro', pickup_latitude: '12.8600000', pickup_longitude: '121.4500000',
  destination_address: 'Ekslusibo Grill and Restaurant · Pag-asa, Bansud', destination_latitude: '12.8100000', destination_longitude: '121.4700000',
  vehicle_type: 'motorcycle', passenger_count: 1,
  payment_method: 'gcash', payment_status: 'paid', paid_amount: 214.04, paid_via: 'qrph', payment_reference: 'PAY-ABC123',
  fare: 214.04, ride_fare: 212.04, base_fare: 50, distance_fare: 162.04, service_fee: 0,
  additional_charges: [{ id: 1, type: 'pickup_waiting', label: 'Pickup waiting', amount: 2, duration_seconds: 360 }],
  distance_km: 10.8, duration_min: 33, booking_notes: null, rating: 5,
  rider: { name: 'Aldrin Robledo', rating: 4.9, contact_number: '09171234567', vehicle_type: 'motorcycle', vehicle_make: 'Honda', vehicle_model: 'Click', plate_number: 'ABC 1234' },
  created_at: '2026-11-18T00:00:00Z', started_at: '2026-11-18T00:08:00Z', completed_at: '2026-11-18T00:30:00Z',
  cancelled_at: null, cancellation_reason: null,
  trip_times: {
    booked_at: '2026-11-18T00:00:00Z', accepted_at: '2026-11-18T00:01:00Z', arrived_pickup_at: '2026-11-18T00:06:00Z',
    picked_up_at: '2026-11-18T00:08:00Z', arrived_destination_at: '2026-11-18T00:28:00Z', completed_at: '2026-11-18T00:30:00Z',
  },
}

function renderAt(trip: Record<string, unknown>) {
  api.get.mockResolvedValue(trip)
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tourist/transport/trips/31']}>
        <Routes><Route path="/tourist/transport/trips/:id" element={<TouristTripDetails />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => api.get.mockReset())

describe('Trip details', () => {
  it('shows pickup and destination names with coordinates, and no map', async () => {
    renderAt(COMPLETED)
    const route = await screen.findByRole('region', { name: 'Route' })
    expect(route).toHaveTextContent('Gloria, Oriental Mindoro')
    expect(within(route).getByTestId('pickup-coordinates')).toHaveTextContent('12.860000, 121.450000')
    expect(route).toHaveTextContent('Ekslusibo Grill and Restaurant · Pag-asa, Bansud')
    expect(within(route).getByTestId('destination-coordinates')).toHaveTextContent('12.810000, 121.470000')
    expect(screen.queryByTestId('map')).toBeNull()
    expect(api.get).toHaveBeenCalledWith('/tourist/transport/trip/31/status')
  })

  it('shows the fare calculation, payment and driver', async () => {
    renderAt(COMPLETED)
    const fare = await screen.findByRole('region', { name: 'Fare' })
    expect(fare).toHaveTextContent('Base fare₱50.00')
    expect(fare).toHaveTextContent('Distance (10.8 km)₱162.04')
    expect(fare).toHaveTextContent('Pickup waiting₱2.00')
    expect(within(fare).getByTestId('trip-total')).toHaveTextContent('₱214.04')

    const payment = screen.getByRole('region', { name: 'Payment' })
    expect(payment).toHaveTextContent('Payment methodQR Ph')
    expect(payment).toHaveTextContent('StatusPaid')
    expect(payment).toHaveTextContent('Amount paid₱214.04')

    const driver = screen.getByRole('region', { name: 'Driver' })
    expect(driver).toHaveTextContent('Aldrin Robledo')
    expect(within(driver).getByRole('link', { name: /09171234567/ })).toHaveAttribute('href', 'tel:09171234567')
    expect(driver).toHaveTextContent('Honda Click')
    expect(driver).toHaveTextContent('Plate numberABC 1234')
  })

  it('shows the date, each step’s time, travel and total durations, distance and references', async () => {
    renderAt(COMPLETED)
    const info = await screen.findByRole('region', { name: 'Trip information' })
    expect(info).toHaveTextContent(/Travel date.*2026/)
    expect(info).toHaveTextContent('Driver accepted')
    expect(info).toHaveTextContent('Driver arrived at pickup')
    expect(info).toHaveTextContent('Arrived at destination')
    expect(info).toHaveTextContent('Travel time (pickup to destination)20 min')
    expect(info).toHaveTextContent('Waiting at pickup2 min')
    expect(info).toHaveTextContent('Total trip time (booking to completion)30 min')
    expect(info).toHaveTextContent('Route distance (booked)10.8 km')
    expect(info).toHaveTextContent('Estimated travel time (booked)about 33 min')
    expect(info).toHaveTextContent('Trip numberTRP-6AFC87A813AD4')
    expect(info).toHaveTextContent('Payment referencePAY-ABC123')
    expect(info).toHaveTextContent('Your rating5 / 5')
  })

  it('a ride cancelled before any driver accepted: not charged, no driver', async () => {
    renderAt({
      ...COMPLETED, status: 'cancelled', rider: null, payment_method: 'cash', payment_status: 'pending', paid_via: null, payment_reference: null,
      additional_charges: [], fare: 212.04, completed_at: null, cancelled_at: '2026-11-18T00:03:00Z', cancellation_reason: 'changed_plans', rating: null,
      trip_times: { booked_at: '2026-11-18T00:00:00Z', accepted_at: null, arrived_pickup_at: null, picked_up_at: null, arrived_destination_at: null, completed_at: null },
    })
    expect(await screen.findByText('This ride was cancelled, so the fare was not charged.')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Payment' })).toHaveTextContent('StatusNot charged')
    expect(screen.getByRole('region', { name: 'Driver' })).toHaveTextContent('No driver was assigned to this ride.')
    const info = screen.getByRole('region', { name: 'Trip information' })
    expect(info).toHaveTextContent('Cancellation reasonchanged plans')
    expect(info).toHaveTextContent('Time until cancelled3 min')
    expect(info).not.toHaveTextContent('Travel time')
  })
})

describe('durationBetween', () => {
  it('formats seconds, minutes and hours; null when a time is missing', () => {
    expect(durationBetween('2026-11-18T00:00:00Z', '2026-11-18T00:00:45Z')).toBe('45 s')
    expect(durationBetween('2026-11-18T00:00:00Z', '2026-11-18T00:20:00Z')).toBe('20 min')
    expect(durationBetween('2026-11-18T00:00:00Z', '2026-11-18T01:05:00Z')).toBe('1 h 5 min')
    expect(durationBetween(null, '2026-11-18T01:05:00Z')).toBeNull()
  })
})
