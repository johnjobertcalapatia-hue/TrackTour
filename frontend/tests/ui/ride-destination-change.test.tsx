import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DestinationChange } from '@/features/tourist/services/destination-change'

/**
 * Ride hailing — one-time destination change (2026-11-17): the tourist's
 * Change destination page (pick → revised route and fare → confirm once),
 * the tracking card, and the rider's alert + acknowledgement.
 */

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  patch: vi.fn(),
  apiErrorMessage: (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? fallback,
  default: { get: api.get, post: api.post },
}))
vi.mock('react-leaflet', async () => {
  const React = await import('react')
  return {
    MapContainer: ({ children }: { children: ReactNode }) => React.createElement('div', { 'data-testid': 'map' }, children),
    TileLayer: () => null,
    Marker: () => null,
    Polyline: ({ positions }: { positions: unknown[] }) => React.createElement('div', { 'data-testid': 'route-line', 'data-points': positions.length }),
    useMap: () => ({ fitBounds: vi.fn() }),
  }
})
vi.mock('leaflet', () => ({ default: { latLngBounds: vi.fn(() => ({})), divIcon: vi.fn(() => ({})), icon: vi.fn(() => ({})) } }))
vi.mock('@/shared/utils/map-markers', () => ({ riderMarkerIcon: {}, destinationMarkerIcon: {} }))
// The picker has its own tests: here it hands back a chosen place.
vi.mock('@/features/tourist/components/ride/RideLocationPicker', () => ({
  default: ({ onConfirm, onClose }: { onConfirm: (p: unknown) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Choose a place">
      <button type="button" onClick={() => onConfirm({ name: 'Tambangan Falls', address: 'Tambangan, Bansud', lat: 12.53, lng: 121.31 })}>Pick Tambangan Falls</button>
      <button type="button" onClick={onClose}>Close picker</button>
    </div>
  ),
}))

import TouristChangeDestination from '@/features/tourist/pages/TouristChangeDestination'
import DestinationChangeCard from '@/features/tourist/components/ride/DestinationChangeCard'

const PREVIEW = {
  quote_token: 'signed-quote', expires_at: '2026-11-17T08:06:00Z',
  destination: { name: 'Tambangan Falls', address: 'Tambangan, Bansud', latitude: 12.53, longitude: 121.31 },
  traveled_km: 1.11, remaining_km: 1.5, route_source: 'osrm', route: [[12.52, 121.31], [12.525, 121.312], [12.53, 121.31]],
  from: { latitude: 12.52, longitude: 121.31 }, original_fare: 120, estimated_fare: 76.1, max_fare: 87.52, base_fare: 40, per_km: 13.83, changes_left: 1,
}

const CHANGE: DestinationChange = {
  id: 1, status: 'confirmed',
  original: { address: 'Pagasa', latitude: 12.6, longitude: 121.4 },
  new: { name: 'Tambangan Falls', address: 'Tambangan, Bansud', latitude: 12.53, longitude: 121.31 },
  confirmed_at: '2026-11-17T08:04:00Z', original_fare: 120, estimated_fare: 76.1, max_fare: 87.52,
  traveled_km_at_change: 1.11, remaining_km_estimate: 1.5, rider_notification_status: 'sent', rider_acknowledged_at: null,
  verified_km: null, unverified_km: null, computed_fare: null, final_fare: null, cap_adjustment: null,
  original_commission: 48, final_commission: null, fare_review_status: null, review_reasons: [], finalized_at: null,
}

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function renderPage(trip: Record<string, unknown> = {}) {
  api.get.mockResolvedValue({
    id: 18, order_number: 'TRP-18', destination_address: 'Pagasa', destination_latitude: 12.6, destination_longitude: 121.4,
    destination_change_allowed: true, destination_changes_left: 1, ...trip,
  })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tourist/transport/tracking/18/change-destination']}>
        <Routes>
          <Route path="/tourist/transport/tracking/:id/change-destination" element={<TouristChangeDestination />} />
          <Route path="/tourist/transport/tracking/:id" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
})

describe('Change destination page', () => {
  it('pick a place → revised route, estimate and maximum → confirm once with a signed quote', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/destination-change/preview')) return PREVIEW
      if (url.endsWith('/destination-change')) return { destination_change: CHANGE, replayed: false }
      return {}
    })
    renderPage()

    expect(await screen.findByText('1 change left')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pick Tambangan Falls' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/transport/trip/18/destination-change/preview', {
      destination_name: 'Tambangan Falls', destination_address: 'Tambangan, Bansud', destination_lat: 12.53, destination_lng: 121.31,
    }))

    const revised = within(await screen.findByRole('region', { name: 'Revised trip' }))
    expect(screen.getByTestId('route-line')).toHaveAttribute('data-points', '3')
    expect(revised.getByText('1.11 km')).toBeInTheDocument()
    expect(revised.getByText(/To the new destination \(road route\)/)).toBeInTheDocument()
    expect(revised.getByText('Estimated new fare').nextSibling).toHaveTextContent('76.10')
    expect(revised.getByText('Maximum you will pay').nextSibling).toHaveTextContent('87.52')
    // Nothing is changed until confirmed.
    expect(api.post).toHaveBeenCalledTimes(1)

    fireEvent.click(revised.getByRole('button', { name: /Change destination/ }))
    const dialog = within(screen.getByRole('dialog', { name: 'Confirm the new destination' }))
    expect(dialog.getByText('You can change the destination only once on this ride.')).toBeInTheDocument()
    await act(async () => { fireEvent.click(dialog.getByRole('button', { name: 'Yes, change it' })) })

    const confirmCall = api.post.mock.calls.find(([u]) => u === '/tourist/transport/trip/18/destination-change')!
    expect(confirmCall[1]).toMatchObject({ quote_token: 'signed-quote' })
    expect(String(confirmCall[1].idempotency_key).length).toBeGreaterThanOrEqual(8)
    expect(await screen.findByTestId('location')).toHaveTextContent('/tourist/transport/tracking/18')
  })

  it('a refused confirmation shows why and changes nothing', async () => {
    api.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/preview')) return PREVIEW
      throw { response: { status: 409, data: { message: 'You have already changed the destination of this ride.' } } }
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Pick Tambangan Falls' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Change destination$/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, change it' })) })

    expect(await screen.findByRole('alert')).toHaveTextContent('You have already changed the destination of this ride.')
    expect(screen.queryByTestId('location')).not.toBeInTheDocument()
  })

  it('says so when the ride has no change left', async () => {
    renderPage({ destination_change_allowed: false, destination_changes_left: 0, destination_change_unavailable_reason: 'You have already changed the destination of this ride.' })
    expect(await screen.findByRole('alert')).toHaveTextContent('You have already changed the destination of this ride.')
    expect(screen.queryByRole('dialog', { name: 'Choose a place' })).not.toBeInTheDocument()
  })
})

describe('Tracking card', () => {
  it('offers the change with the allowance while the trip is under way', () => {
    const onChange = vi.fn()
    render(<DestinationChangeCard change={null} changesLeft={1} canChange onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Change destination\s*1 change left/ }))
    expect(onChange).toHaveBeenCalled()
  })

  it('after a change: original → new, the estimate and maximum, no changes left', () => {
    render(<DestinationChangeCard change={CHANGE} changesLeft={0} canChange={false} onChange={vi.fn()} />)
    const card = within(screen.getByRole('region', { name: 'Destination changed' }))
    expect(card.getByText('Pagasa')).toHaveClass('line-through')
    expect(card.getByText('Tambangan Falls')).toBeInTheDocument()
    expect(card.getByText('No changes left')).toBeInTheDocument()
    expect(card.getByText('Estimated fare').nextSibling).toHaveTextContent('76.10')
    expect(card.getByText('You will pay at most').nextSibling).toHaveTextContent('87.52')
    expect(card.getByText(/being told about the new destination/)).toBeInTheDocument()
  })

  it('at the end: the final fare from the verified distance, and any cap', () => {
    render(<DestinationChangeCard change={{ ...CHANGE, status: 'finalized', rider_acknowledged_at: '2026-11-17T08:04:30Z', verified_km: 3.1, computed_fare: 92.87, final_fare: 87.52, cap_adjustment: 5.35 }} changesLeft={0} canChange={false} onChange={vi.fn()} />)
    const card = within(screen.getByRole('region', { name: 'Destination changed' }))
    expect(card.getByText('Final fare').nextSibling).toHaveTextContent('87.52')
    expect(card.getByText('3.10 km')).toBeInTheDocument()
    expect(card.getByText('Capped at your maximum').nextSibling).toHaveTextContent('5.35')
    expect(card.getByText('Your driver has the new destination')).toBeInTheDocument()
  })
})
