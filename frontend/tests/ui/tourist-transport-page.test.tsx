import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristTransport, { RIDE_DRAFT_KEY } from '@/features/tourist/pages/TouristTransport'

/** Ride Hailing: Pickup and Drop-off cards, each set on a full-screen map (2026-11-10). */

const rides = vi.hoisted(() => ({ rows: [] as unknown[] }))
const api = vi.hoisted(() => ({
  get: vi.fn(async (url: string, config?: { params?: { lat: number; lng: number } }) => {
    if (url === '/tourist/transport') return { data: rides.rows }
    if (url.startsWith('/tourist/transport/locations/search')) {
      return [
        { id: 1, type: 'restaurant', name: 'Eksklusibo Grill', address: 'Pag-asa, Bansud', lat: 12.861, lng: 121.461 },
        { id: 2, type: 'stay', name: 'Gloria Bay Resort', address: 'Gloria', lat: 12.97, lng: 121.47 },
      ]
    }
    if (url === '/tourist/transport/locations/reverse-geocode') {
      return { id: null, type: 'custom', name: `Spot ${config?.params?.lat}`, address: 'Bansud, Oriental Mindoro', lat: config?.params?.lat, lng: config?.params?.lng }
    }
    return {}
  }),
}))
const sheet = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))
const mapTap = vi.hoisted(() => ({ handler: null as null | ((e: { latlng: { lat: number; lng: number } }) => void) }))

vi.mock('@/shared/services/api', () => ({ get: api.get, post: vi.fn(), default: { get: api.get, post: vi.fn() } }))

// The sheet has its own tests: here, only what the page opens it with.
vi.mock('@/features/tourist/components/BookRideSheet', () => ({
  default: (props: Record<string, unknown>) => {
    sheet.props = props
    return props.isOpen ? <div data-testid="ride-sheet" /> : null
  },
}))

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'leaflet-map' }, children),
    TileLayer: () => null,
    Marker: ({ position, draggable, eventHandlers }: { position: [number, number]; draggable?: boolean; eventHandlers?: { dragend?: (e: unknown) => void } }) =>
      React.createElement('button', {
        type: 'button',
        'data-testid': 'ride-marker',
        'data-pos': position.join(','),
        'data-draggable': String(!!draggable),
        // A test "drag": move the marker 0.001° north.
        onClick: () => eventHandlers?.dragend?.({ target: { getLatLng: () => ({ lat: position[0] + 0.001, lng: position[1] }) } }),
      }),
    useMap: () => ({ setView: vi.fn(), fitBounds: vi.fn(), getZoom: () => 13 }),
    useMapEvents: (h: { click?: (e: { latlng: { lat: number; lng: number } }) => void }) => {
      mapTap.handler = h.click ?? null
      return {}
    },
  }
})
vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})) } }))

function LocationProbe() {
  const { pathname, search } = useLocation()
  return <p data-testid="location">{pathname + search}</p>
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tourist/transport']}>
        <Routes>
          <Route path="/tourist/transport" element={<TouristTransport />} />
          <Route path="/tourist/transport/map" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const card = (kind: 'pickup' | 'dropoff') => screen.getByTestId(`ride-card-${kind}`)
const picker = () => screen.getByRole('dialog')

async function searchAndPick(searchLabel: string, result: string) {
  fireEvent.change(within(picker()).getByRole('searchbox', { name: searchLabel }), { target: { value: result.split(' ')[0] } })
  fireEvent.click(await within(picker()).findByRole('button', { name: new RegExp(result) }))
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  sheet.props = null
  rides.rows = []
  api.get.mockClear()
  mapTap.handler = null
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.8701, longitude: 121.4502 } } as GeolocationPosition) },
  })
})

describe('Ride Hailing page: Pickup and Drop-off', () => {
  it('shows two cards in one column, Pickup above Drop-off, with nothing to book yet', async () => {
    renderPage()
    const section = await screen.findByRole('region', { name: 'Pickup and drop-off' })
    expect(section.className).toContain('grid-cols-1')
    const cards = within(section).getAllByRole('button')
    expect(cards.map((c) => c.dataset.testid)).toEqual(['ride-card-pickup', 'ride-card-dropoff'])
    expect(card('pickup')).toHaveAttribute('data-state', 'empty')
    expect(card('pickup')).toHaveTextContent('Set your pickup point')
    expect(card('dropoff')).toHaveTextContent('Where are you going?')
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
  })

  it('Pickup: search a place, adjust the marker, confirm', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Set pickup point' }))
    expect(picker()).toHaveAccessibleName('Set pickup point')
    expect(within(picker()).getByRole('button', { name: 'Confirm pickup point' })).toBeDisabled()

    await searchAndPick('Search pickup location', 'Eksklusibo Grill')
    const marker = within(picker()).getByTestId('ride-marker')
    expect(marker).toHaveAttribute('data-pos', '12.861,121.461')
    expect(marker).toHaveAttribute('data-draggable', 'true')
    expect(within(picker()).getByTestId('ride-point-label')).toHaveTextContent('Eksklusibo Grill')

    // Drag the marker: it moves and the address is looked up again.
    await act(async () => { fireEvent.click(marker) })
    expect(within(picker()).getByTestId('ride-marker').dataset.pos).toBe(`${12.861 + 0.001},121.461`)
    await waitFor(() => expect(within(picker()).getByTestId('ride-point-label')).toHaveTextContent(`Spot ${12.861 + 0.001}`))

    fireEvent.click(within(picker()).getByRole('button', { name: 'Confirm pickup point' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(card('pickup')).toHaveAttribute('data-state', 'set')
    expect(card('pickup')).toHaveTextContent(`Spot ${12.861 + 0.001}`)
    expect(card('pickup')).toHaveTextContent('Edit')
    expect(JSON.parse(sessionStorage.getItem(RIDE_DRAFT_KEY)!).pickup).toMatchObject({ lat: 12.861 + 0.001, lng: 121.461 })
  })

  it('Pickup: the current-location button marks where the tourist is', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Set pickup point' }))
    await act(async () => { fireEvent.click(within(picker()).getByRole('button', { name: 'Use my current location' })) })

    expect(within(picker()).getByTestId('ride-marker')).toHaveAttribute('data-pos', '12.8701,121.4502')
    await waitFor(() => expect(within(picker()).getByRole('button', { name: 'Confirm pickup point' })).toBeEnabled())
    fireEvent.click(within(picker()).getByRole('button', { name: 'Confirm pickup point' }))
    expect(card('pickup')).toHaveTextContent('Spot 12.8701')
  })

  it('Drop-off: search or tap the map; there is no current-location button', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Set drop-off' }))
    expect(within(picker()).queryByRole('button', { name: 'Use my current location' })).not.toBeInTheDocument()

    await act(async () => { mapTap.handler?.({ latlng: { lat: 12.9, lng: 121.48 } }) })
    expect(within(picker()).getByTestId('ride-marker')).toHaveAttribute('data-pos', '12.9,121.48')
    await waitFor(() => expect(within(picker()).getByRole('button', { name: 'Confirm drop-off' })).toBeEnabled())
    fireEvent.click(within(picker()).getByRole('button', { name: 'Confirm drop-off' }))
    expect(card('dropoff')).toHaveTextContent('Spot 12.9')
  })

  it('confirmed markers stay put: leaving the map without confirming keeps the old point', async () => {
    sessionStorage.setItem(RIDE_DRAFT_KEY, JSON.stringify({ pickup: { name: 'Hotel', address: 'Bansud', lat: 12.86, lng: 121.45 }, dropoff: null }))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit pickup: Hotel' }))
    expect(within(picker()).getByTestId('ride-marker')).toHaveAttribute('data-pos', '12.86,121.45')

    await act(async () => { mapTap.handler?.({ latlng: { lat: 12.7, lng: 121.3 } }) })
    fireEvent.click(within(picker()).getByRole('button', { name: 'Back' }))

    expect(card('pickup')).toHaveTextContent('Hotel')
    expect(JSON.parse(sessionStorage.getItem(RIDE_DRAFT_KEY)!).pickup).toMatchObject({ lat: 12.86, lng: 121.45 })
  })

  it('with both set: both markers on a fixed map, and Continue opens the trip summary with them', async () => {
    sessionStorage.setItem(RIDE_DRAFT_KEY, JSON.stringify({
      pickup: { name: 'Hotel', address: 'Bansud', lat: 12.86, lng: 121.45 },
      dropoff: { name: 'Tambangan Falls', address: 'Gloria', lat: 12.95, lng: 121.46 },
    }))
    renderPage()
    const preview = await screen.findByTestId('ride-points-preview')
    const markers = within(preview).getAllByTestId('ride-marker')
    expect(markers.map((m) => m.dataset.pos)).toEqual(['12.86,121.45', '12.95,121.46'])
    expect(markers.every((m) => m.dataset.draggable === 'false')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(screen.getByTestId('ride-sheet')).toBeInTheDocument()
    expect(sheet.props).toMatchObject({
      destination: 'Tambangan Falls',
      destinationAddress: 'Gloria',
      destinationCoords: { lat: 12.95, lng: 121.46 },
      pickupPoint: { name: 'Hotel, Bansud', lat: 12.86, lng: 121.45 },
    })

    // Booked: the points are kept, locked.
    act(() => { (sheet.props!.onBooked as () => void)() })
    expect(JSON.parse(sessionStorage.getItem(RIDE_DRAFT_KEY)!).booked).toBe(true)
  })

  it('while a ride is active the points cannot be edited', async () => {
    rides.rows = [{ id: 9, order_number: 'RIDE-9', status: 'arriving', delivery_address: 'Tambangan Falls' }]
    sessionStorage.setItem(RIDE_DRAFT_KEY, JSON.stringify({
      pickup: { name: 'Hotel', address: 'Bansud', lat: 12.86, lng: 121.45 },
      dropoff: { name: 'Tambangan Falls', address: 'Gloria', lat: 12.95, lng: 121.46 },
      booked: true,
    }))
    renderPage()
    expect(await screen.findByText('Driver Arriving')).toBeInTheDocument()
    for (const kind of ['pickup', 'dropoff'] as const) {
      expect(card(kind)).toBeDisabled()
      expect(card(kind)).toHaveAttribute('data-state', 'locked')
      expect(card(kind)).toHaveTextContent('Booked: cannot be changed')
    }
    fireEvent.click(card('pickup'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument()
  })

  it('after the booked ride ends, the cards start fresh', async () => {
    sessionStorage.setItem(RIDE_DRAFT_KEY, JSON.stringify({
      pickup: { name: 'Hotel', address: 'Bansud', lat: 12.86, lng: 121.45 },
      dropoff: { name: 'Tambangan Falls', address: 'Gloria', lat: 12.95, lng: 121.46 },
      booked: true,
    }))
    renderPage()
    await waitFor(() => expect(card('pickup')).toHaveAttribute('data-state', 'empty'))
    expect(card('dropoff')).toHaveAttribute('data-state', 'empty')
  })

  it('a place handed over from the map becomes the drop-off', async () => {
    localStorage.setItem('tracktour_pending_booking', JSON.stringify({
      destination: { name: 'Eksklusibo Grill and Restaurant', address: 'Bansud, Oriental Mindoro' }, distanceKm: 12.47, vehicle: 'car', lat: 12.86, lng: 121.46,
    }))
    renderPage()
    await waitFor(() => expect(card('dropoff')).toHaveTextContent('Eksklusibo Grill and Restaurant'))
    expect(localStorage.getItem('tracktour_pending_booking')).toBeNull()
  })

  it('ignores a broken hand-off', async () => {
    localStorage.setItem('tracktour_pending_booking', '{not json')
    renderPage()
    await screen.findByRole('heading', { name: 'Ride Hailing' })
    expect(card('dropoff')).toHaveAttribute('data-state', 'empty')
  })

  it('the Map button opens the Ride Hailing map', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Map' }))
    expect(await screen.findByTestId('location')).toHaveTextContent('/tourist/transport/map')
  })
})
