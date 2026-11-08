import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Rider map Stage C: Overview / Navigation view buttons (above the map-type
 * button; the Start button was removed 2026-11-08), the tilted heading-up
 * navigation view with the
 * Google-style puck, and collected restaurants disappearing from the map.
 */

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: ReactNode }) => <div data-testid="leaflet-map">{children}</div>,
  TileLayer: () => null,
  Marker: ({ children, icon }: { children?: ReactNode; icon?: { options?: { className?: string } } }) => (
    <div data-testid="marker" data-icon={icon?.options?.className ?? ''}>{children}</div>
  ),
  Popup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Polyline: ({ positions }: { positions: unknown[] }) => <div data-testid="route-line" data-points={positions.length} />,
}))
vi.mock('@/features/rider/components/RiderMapFollow', () => ({
  RiderMapFollow: ({ overview }: { overview?: { key: string } | null }) => <div data-testid="follow-mode" data-overview-key={overview?.key ?? ''} />,
}))
vi.mock('@/shared/components/map/NavigationCamera', () => ({
  NavigationCamera: ({ bearing, screenOffset }: { bearing: number; screenOffset: { y: number } }) => (
    <div data-testid="nav-camera" data-bearing={bearing} data-offset-y={screenOffset.y} />
  ),
}))
vi.mock('@/features/rider/components/MapZoomOutLimit', () => ({ MapZoomOutLimit: () => null }))
// Stable results, like the real hook's state (a new array per render would
// make every route-derived memo recompute on every render).
const osrm = vi.hoisted(() => ({
  route: { points: [[12.5105, 121.31], [12.515, 121.315], [12.52, 121.32]], distanceKm: 1.2, durationMin: 4, loading: false },
  none: { points: [], distanceKm: null, durationMin: null, loading: false },
}))
vi.mock('@/features/rider/hooks/useOsrmRoute', () => ({
  useOsrmRoute: (waypoints: unknown) => (waypoints ? osrm.route : osrm.none),
}))

const trip = vi.hoisted(() => ({
  value: {} as Record<string, unknown>,
}))
vi.mock('@/features/rider/context/RiderActiveTripContext', () => ({ useRiderActiveTrip: () => trip.value }))

const api = vi.hoisted(() => ({
  get: vi.fn(async (url: string) => {
    if (url === '/rider/map/location') return { rider: { latitude: 12.51, longitude: 121.31 }, deliveries: [] }
    return null
  }),
  post: vi.fn(async () => ({})),
  patch: vi.fn(async () => ({})),
}))
vi.mock('@/shared/services/api', () => ({ ...api, default: api, apiErrorMessage: () => 'error' }))

import RiderMap from '@/features/rider/pages/RiderMap'
import { useAuthStore } from '@/features/auth/services/auth-store'

const STOPS = [
  { id: 1, business_id: 1, business_name: 'Restaurant A', sequence: 1, pickup_lat: 12.51, pickup_lng: 121.31, pickup_address: 'A St', status: 'collected', preparation_time: 5 },
  { id: 2, business_id: 2, business_name: 'Restaurant B', business_logo: 'logos/b.png', sequence: 2, pickup_lat: 12.52, pickup_lng: 121.32, pickup_address: 'B St', status: 'pending', preparation_time: 10 },
]

function renderMap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><RiderMap /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  useAuthStore.setState({ user: { id: 8, name: 'Rider', role: 'rider', current_service: 'food' } as never, loading: false })
  trip.value = {
    setRiderPosition: vi.fn(),
    activeDelivery: { id: 6, status: 'assigned', pickup_lat: 12.52, pickup_lng: 121.32, delivery_lat: 12.6, delivery_lng: 121.4, business_name: 'Restaurant B', delivery_address: 'Tourist stay' },
    tripState: 'EN_ROUTE_TO_PICKUP',
    pickupStopsData: { stops: STOPS, fully_collected: false, dropoff: { latitude: 12.6, longitude: 121.4 }, pickup_origin: null, is_cod: true },
  }
  // A real GPS fix right away.
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    geolocation: {
      getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.5105, longitude: 121.31, accuracy: 5, heading: null, speed: 0 } as GeolocationCoordinates, timestamp: Date.now() } as GeolocationPosition),
      watchPosition: () => 1,
      clearWatch: () => {},
    },
  }))
})

describe('Rider map: Overview and Navigation views', () => {
  it('stacks the Overview and Navigation buttons directly above the map-type button', async () => {
    renderMap()
    const group = await screen.findByRole('group', { name: 'Map view' })
    const stack = group.parentElement as HTMLElement
    const labels = within(stack).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
    expect(labels).toEqual(['Overview', 'Navigation view', 'Map type', 'Center map on my location'])
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens in the overview with the route framed and no Start button', async () => {
    renderMap()
    expect(await screen.findByTestId('follow-mode')).toHaveAttribute('data-overview-key', '6:pickup:0')
    expect(screen.queryByTestId('nav-camera')).not.toBeInTheDocument()
    expect(screen.getByTestId('route-line')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start' })).not.toBeInTheDocument()
    expect(screen.getByTestId('leaflet-map').closest('[data-view-mode]')).toHaveAttribute('data-view-mode', 'overview')
  })

  it('Navigation view switches to the tilted, heading-up view with the position puck', async () => {
    renderMap()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Navigation view' })) })

    expect(screen.getByTestId('nav-camera')).toBeInTheDocument()
    expect(screen.queryByTestId('follow-mode')).not.toBeInTheDocument()
    expect(screen.getByTestId('rider-nav-puck')).toBeInTheDocument()
    // Same marker as the overview, lying back at the map's tilt like the map's own markers.
    expect(screen.getByTestId('rider-nav-puck-marker').style.transform).toBe('perspective(1000px) rotateX(50deg)')
    expect(screen.getByRole('button', { name: 'Navigation view' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('leaflet-map').closest('[data-view-mode]')).toHaveAttribute('data-view-mode', 'navigation')
  })

  it('Overview returns to the flat bird\'s-eye view and re-frames the route', async () => {
    renderMap()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Navigation view' })) })
    expect(screen.getByTestId('nav-camera')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Overview' })) })
    expect(screen.queryByTestId('nav-camera')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rider-nav-puck')).not.toBeInTheDocument()
    expect(screen.getByTestId('follow-mode')).toHaveAttribute('data-overview-key', '6:pickup:1')
  })

  it('hides restaurants that were already collected; the next one stays', async () => {
    renderMap()
    await screen.findByTestId('follow-mode')
    // Stop markers read "#<sequence> <name>".
    expect(screen.queryByText('#1 Restaurant A')).not.toBeInTheDocument()
    expect(screen.getByText('#2 Restaurant B')).toBeInTheDocument()
  })

  it('tapping the "Going to Pickup" pill frames the whole route again', async () => {
    renderMap()
    expect(await screen.findByTestId('follow-mode')).toHaveAttribute('data-overview-key', '6:pickup:0')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Going to Pickup.*Show the whole route/ })) })
    expect(screen.getByTestId('follow-mode')).toHaveAttribute('data-overview-key', '6:pickup:1')
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('restaurants use the tourist map business marker (photo pin with the name)', async () => {
    renderMap()
    await screen.findByTestId('follow-mode')
    const restaurant = screen.getByText('#2 Restaurant B').closest('[data-testid="marker"]') as HTMLElement
    // businessLogoIcon (tourist map): the round photo pin; label keeps the pickup order.
    expect(restaurant.getAttribute('data-icon')).toBe('landing-pin')
  })
})
