import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BookRideSheet from '@/features/tourist/components/BookRideSheet'

/** Rides are booked with Cash or GCash (online, PayMongo) only — 2026-11-10. */

const api = vi.hoisted(() => ({
  get: vi.fn(async () => ({ name: 'Picked location', address: '', lat: 12.86, lng: 121.45 })),
  post: vi.fn(async (url: string) => {
    if (url === '/tourist/transport/estimate') {
      return {
        distance_km: 3.2, distance_text: '3.2 km', duration_min: 10, duration_text: '10 min', service_fee: 0,
        fares: Object.fromEntries(['motorcycle', 'tricycle', 'car', 'van'].map((v, i) => [v, {
          base_fare: 40 + i * 10, distance_fare: 30, fare: 70 + i * 10, total_fare: 70 + i * 10, fare_text: '', duration_min: 10,
        }])),
      }
    }
    if (url === '/tourist/transport/route') return { polyline: [[12.86, 121.45], [12.87, 121.46]], distance_km: 3.2, duration_min: 10, source: 'osrm' }
    if (url === '/tourist/transport/book') return { order_id: 31, redirect: '/tourist/transport/tracking/31', fare: 70 }
    return {}
  }),
}))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: api.post, default: { get: api.get, post: api.post } }))
vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    TileLayer: Empty, Marker: Empty, Popup: Empty, Polyline: Empty,
    useMap: () => ({ fitBounds: vi.fn(), setView: vi.fn() }),
    useMapEvents: () => undefined,
  }
})
vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})), icon: vi.fn(() => ({})) } }))

beforeEach(() => {
  api.post.mockClear()
  localStorage.clear()
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.86, longitude: 121.45 } } as GeolocationPosition) },
  })
})

async function openSummary() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <BookRideSheet isOpen onClose={vi.fn()} destination="Ekslusibo Grill" destinationCoords={{ lat: 12.875, lng: 121.462 }} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Use current location/ })) })
  return screen.findByRole('radiogroup', { name: 'Payment method' })
}

describe('Ride booking payment', () => {
  it('offers only Cash and GCash (online), with a note for each', async () => {
    const pay = await openSummary()
    expect(within(pay).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Cash', 'GCash (online)'])
    expect(within(pay).getByRole('radio', { name: 'Cash' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Pay your driver in cash at drop-off.')).toBeInTheDocument()

    fireEvent.click(within(pay).getByRole('radio', { name: 'GCash (online)' }))
    expect(screen.getByText('Pay online with GCash through PayMongo when the ride ends.')).toBeInTheDocument()
  })

  it('books the ride with the chosen method', async () => {
    const pay = await openSummary()
    fireEvent.click(within(pay).getByRole('radio', { name: 'GCash (online)' }))
    const book = await screen.findByRole('button', { name: /Book Ride Now/ })
    await waitFor(() => expect(book).toBeEnabled())
    await act(async () => { fireEvent.click(book) })

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/transport/book', expect.objectContaining({ payment_method: 'gcash' })))
  })

  // Stage 4: the server books only the fare the tourist saw. A changed fare
  // comes back as 409: the sheet says so, re-quotes and lets them book again.
  it('shows a changed fare, re-quotes and stays bookable', async () => {
    const original = api.post.getMockImplementation()!
    let refused = false
    api.post.mockImplementation(async (url: string) => {
      if (url === '/tourist/transport/book' && !refused) {
        refused = true
        throw { response: { status: 409, data: { message: 'The fare changed to ₱75.00. Please review it and book again.', data: { fare: 75 } } } }
      }
      return original(url)
    })
    await openSummary()
    const book = await screen.findByRole('button', { name: /Book Ride Now/ })
    await waitFor(() => expect(book).toBeEnabled())
    const quotesBefore = api.post.mock.calls.filter(([u]) => u === '/tourist/transport/estimate').length
    await act(async () => { fireEvent.click(book) })

    expect(await screen.findByRole('alert')).toHaveTextContent('The fare changed to ₱75.00')
    await waitFor(() => expect(api.post.mock.calls.filter(([u]) => u === '/tourist/transport/estimate').length).toBeGreaterThan(quotesBefore))
    await waitFor(() => expect(screen.getByRole('button', { name: /Book Ride Now/ })).toBeEnabled())
    api.post.mockImplementation(original)
  })
})
