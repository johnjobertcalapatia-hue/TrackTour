import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouristExploreMap from '@/features/tourist/pages/TouristExploreMap'

const api = vi.hoisted(() => ({ get: vi.fn() }))
const mapClick = vi.hoisted(() => ({ handler: null as null | (() => void) }))
const fitBounds = vi.hoisted(() => vi.fn())

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: vi.fn(),
  default: { get: api.get, post: vi.fn() },
}))

vi.mock('@/features/auth/services/auth-store', () => {
  const state = { user: { role: 'tourist', name: 'Test Tourist' }, token: 't' }
  return { useAuthStore: (selector?: (v: typeof state) => unknown) => (selector ? selector(state) : state) }
})

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    TileLayer: Empty,
    Marker: ({ eventHandlers }: { eventHandlers?: { click?: () => void } }) =>
      eventHandlers?.click
        ? React.createElement('button', { type: 'button', 'aria-label': 'Select map business', onClick: eventHandlers.click })
        : null,
    Polyline: ({ pathOptions }: { pathOptions: { color: string } }) =>
      React.createElement('span', { 'data-testid': 'route-line', 'data-color': pathOptions.color }),
    useMap: () => ({
      invalidateSize: vi.fn(),
      getZoom: () => 12,
      setView: vi.fn(),
      fitBounds,
      getBounds: () => ({ contains: () => true }),
      panTo: vi.fn(),
      getContainer: () => document.createElement('div'),
    }),
    useMapEvents: (handlers: { click?: () => void }) => {
      mapClick.handler = handlers.click ?? null
      return undefined
    },
  }
})

vi.mock('leaflet', () => ({
  default: {
    marker: () => {
      const el = document.createElement('div')
      const m = { addTo: () => m, getElement: () => el, setZIndexOffset: vi.fn(), setLatLng: vi.fn(), setIcon: vi.fn(), remove: vi.fn(), on: vi.fn() }
      return m
    },
    divIcon: vi.fn(() => ({})),
    latLngBounds: vi.fn(() => ({})),
  },
}))

const BUSINESS = {
  id: 7,
  name: 'Eksklusibo Grill and Restaurant',
  category: { id: 1, name: 'Restaurant' },
  municipality: { id: 1, name: 'Bansud' },
  barangay: null,
  address: 'Poblacion',
  latitude: 12.86,
  longitude: 121.46,
  logo: null,
  cover_photo: null,
  is_open: true,
  reviews_count: 0,
  reviews_avg_rating: 0,
  promotions: [],
  menu_items: [],
}

function renderMap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tourist/explore/map']}>
        <TouristExploreMap />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  fitBounds.mockReset()
  mapClick.handler = null
  api.get.mockReset()
  api.get.mockResolvedValue({ data: { businesses: [BUSINESS], categories: [], municipalities: [] } })
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.84, longitude: 121.47 } } as GeolocationPosition),
    },
  })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      routes: [{ distance: 12300, duration: 1500, geometry: { coordinates: [[121.47, 12.84], [121.465, 12.85], [121.46, 12.86]] } }],
    }),
  })))
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0 })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function openBusinessAndRoute() {
  fireEvent.click(await screen.findByRole('button', { name: 'Select map business' }))
  await screen.findByRole('heading', { name: 'Eksklusibo Grill and Restaurant' })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Directions/ }))
  })
  return screen.findByRole('complementary', { name: 'Route' })
}

describe('Tourist map — business sheet and routing UX', () => {
  it('shows "No ratings yet" instead of a fabricated 0.0 rating', async () => {
    renderMap()
    fireEvent.click(await screen.findByRole('button', { name: 'Select map business' }))

    expect((await screen.findAllByText('No ratings yet')).length).toBeGreaterThan(0)
    expect(screen.queryByText('0.0')).not.toBeInTheDocument()
  })

  it('renders a compact route card with a one-line summary and a green route line', async () => {
    renderMap()
    const card = await openBusinessAndRoute()

    expect(within(card).getByText('Your location')).toBeInTheDocument()
    expect(within(card).getByRole('radiogroup', { name: 'Travel mode' })).toBeInTheDocument()
    expect(within(card).getByText(/12\.3 km/)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Close route' })).toBeInTheDocument()
    expect(screen.getAllByTestId('route-line').map((l) => l.getAttribute('data-color'))).toEqual(['#ffffff', '#087F3F'])
    // "Directions" only draws the route: the whole route is framed, north up.
    // (Navigation is the separate "Navigate" button / the compass toggle.)
    expect(fitBounds).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Navigation view' })).toHaveAttribute('data-current-view', 'overview')
  })

  it('minimises the business sheet once the route is shown, and the handle re-expands it', async () => {
    renderMap()
    await openBusinessAndRoute()

    const handle = screen.getByRole('button', { name: 'Show business details' })
    expect(handle).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(handle)
    expect(screen.getByRole('button', { name: 'Minimize business details' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('tapping the map during a route keeps the route and only minimises the sheet', async () => {
    renderMap()
    await openBusinessAndRoute()
    fireEvent.click(screen.getByRole('button', { name: 'Show business details' }))

    act(() => mapClick.handler?.())

    expect(screen.getByRole('complementary', { name: 'Route' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show business details' })).toBeInTheDocument()
  })

  it('closing the route restores the expanded sheet', async () => {
    renderMap()
    const card = await openBusinessAndRoute()

    fireEvent.click(within(card).getByRole('button', { name: 'Close route' }))

    expect(screen.queryByRole('complementary', { name: 'Route' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Minimize business details' })).toBeInTheDocument()
  })
})
