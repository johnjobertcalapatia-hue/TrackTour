import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouristExploreMap from '@/features/tourist/pages/TouristExploreMap'
import { NAV_PERSPECTIVE_PX, NAV_TILT_DEG } from '@/features/rider/navigation-view'

const api = vi.hoisted(() => ({ get: vi.fn() }))
/** The props the page last gave the navigation camera (the camera has its own tests). */
const camera = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }))

vi.mock('@/shared/components/map/NavigationCamera', () => ({
  NAV_ZOOM: 18,
  NavigationCamera: (props: Record<string, unknown>) => {
    camera.props = props
    return null
  },
}))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: vi.fn(), default: { get: api.get, post: vi.fn() } }))
vi.mock('@/features/auth/services/auth-store', () => {
  const state = { user: { role: 'tourist', name: 'Test Tourist' }, token: 't' }
  return { useAuthStore: (selector?: (v: typeof state) => unknown) => (selector ? selector(state) : state) }
})
vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'map' }, children),
    TileLayer: Empty,
    Polyline: Empty,
    Marker: ({ title, eventHandlers }: { title?: string; eventHandlers?: { click?: () => void; mouseover?: (e: unknown) => void } }) =>
      title === 'Your location'
        ? React.createElement('span', { 'data-testid': 'user-map-marker' })
        : eventHandlers?.click
          ? React.createElement('button', {
              type: 'button',
              'aria-label': 'Hover marker',
              onClick: () => eventHandlers.mouseover?.({ target: { _map: { latLngToContainerPoint: () => ({ x: 200, y: 150 }), getContainer: () => ({ clientWidth: 800, clientHeight: 600 }) } } }),
            })
          : null,
    useMap: () => ({
      setView: vi.fn(), fitBounds: vi.fn(), invalidateSize: vi.fn(), getZoom: () => 13,
      getBounds: () => ({ contains: () => true }), panTo: vi.fn(), getContainer: () => document.createElement('div'),
    }),
    useMapEvents: () => undefined,
  }
})
vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})), latLngBounds: vi.fn(() => ({})), marker: vi.fn(), point: (x: number, y: number) => ({ x, y }) } }))

const USER = { lat: 12.84, lng: 121.47 }
const BUSINESS = {
  id: 7, name: 'Eksklusibo Grill', category: { id: 1, name: 'Restaurant' }, municipality: { id: 1, name: 'Bansud' }, barangay: null,
  address: '', latitude: 12.86, longitude: 121.46, logo: null, cover_photo: null, is_open: true, reviews_count: 0, reviews_avg_rating: 0, promotions: [], menu_items: [],
}
let emit: ((coords: Partial<GeolocationCoordinates>) => void) | null = null

const rotator = () => screen.getByTestId('map-rotator')
const bearing = () => Number(rotator().dataset.bearing)
const cam = () => camera.props as {
  active: boolean
  bearing: number
  freeLook: boolean
  recenterSignal: number
  screenOffset: { x: number; y: number }
  onFreeLookChange: (free: boolean) => void
  onBearingChange: (b: number) => void
  onGestureChange: (on: boolean) => void
  screenToPlanePoint: (p: { x: number; y: number }) => { x: number; y: number }
}

async function startNavigation() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TouristExploreMap /></MemoryRouter>
    </QueryClientProvider>,
  )
  await act(async () => emit?.({ latitude: USER.lat, longitude: USER.lng, heading: null, speed: 0 }))
  fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigate' })) })
  await waitFor(() => expect(rotator()).toHaveClass('map-rotator--nav'))
}

beforeEach(() => {
  sessionStorage.clear()
  camera.props = null
  emit = null
  api.get.mockReset()
  api.get.mockResolvedValue({ data: { businesses: [BUSINESS], categories: [], municipalities: [] } })
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (ok: PositionCallback) => {
        emit = (coords) => ok({ coords: { accuracy: 5, ...coords } as GeolocationCoordinates, timestamp: Date.now() } as GeolocationPosition)
        return 1
      },
      clearWatch: vi.fn(),
      getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: USER.lat, longitude: USER.lng } } as GeolocationPosition),
    },
  })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ routes: [{ distance: 2500, duration: 400, geometry: { coordinates: [[121.47, 12.84], [121.465, 12.85], [121.46, 12.86]] } }] }),
  })))
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0 })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Tourist navigation view: the rider’s navigation features', () => {
  it('is the tilted 3D heading-up view with a horizon and a fixed position puck', async () => {
    // A measured map area (jsdom reports 0x0 otherwise).
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(300)
    await startNavigation()
    // The tilted plane is larger than the screen diagonal (500 px) so no corner shows.
    expect(parseFloat(rotator().style.width)).toBeGreaterThan(500)

    expect(rotator().style.transform).toContain(`rotateX(${NAV_TILT_DEG}deg)`)
    const turned = /rotate\((-?[\d.]+)deg\)/.exec(rotator().style.transform)
    expect(Math.round(Number(turned?.[1]))).toBe(-bearing())
    const area = rotator().parentElement!
    expect(area.style.perspective).toBe(`${NAV_PERSPECTIVE_PX}px`)
    expect(area).toHaveClass('tourist-map-area')
    expect(area.querySelector('.nav-horizon')).not.toBeNull()
    // Following: a fixed screen puck instead of the map marker.
    expect(screen.getByTestId('rider-nav-puck')).toBeInTheDocument()
    expect(screen.queryByTestId('user-map-marker')).not.toBeInTheDocument()
  })

  it('turns on the camera’s explore gestures (drag pans, pinch / wheel zoom, twist rotates)', async () => {
    await startNavigation()
    expect(cam().active).toBe(true)
    expect(typeof cam().onFreeLookChange).toBe('function')
    expect(typeof cam().onBearingChange).toBe('function')
    expect(typeof cam().screenToPlanePoint).toBe('function')
    expect(cam().freeLook).toBe(false)
  })

  it('exploring: the map keeps the tourist’s bearing, the marker is back on the map, and "Show my location" follows again', async () => {
    await startNavigation()
    const heading = bearing()

    // First pan: free look, starting from the view on screen.
    act(() => cam().onFreeLookChange(true))
    expect(cam().freeLook).toBe(true)
    expect(bearing()).toBe(heading)
    expect(screen.queryByTestId('rider-nav-puck')).not.toBeInTheDocument()
    expect(screen.getByTestId('user-map-marker')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show my location' })).toHaveAttribute('aria-pressed', 'false')

    // A twist turns the map; while the fingers move, no easing.
    act(() => cam().onGestureChange(true))
    expect(rotator()).toHaveClass('map-rotator--gesture')
    act(() => cam().onBearingChange(123))
    expect(bearing()).toBe(123)
    act(() => cam().onGestureChange(false))
    expect(rotator()).not.toHaveClass('map-rotator--gesture')

    const before = cam().recenterSignal
    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))
    expect(cam().freeLook).toBe(false)
    expect(cam().recenterSignal).toBe(before + 1)
    expect(bearing()).toBe(heading)
    expect(screen.getByRole('button', { name: 'Show my location' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('rider-nav-puck')).toBeInTheDocument()
  })

  it('compass: following, a tap faces north and another goes back to the travel direction; exploring, a tap faces north', async () => {
    await startNavigation()
    const heading = bearing()
    expect(heading).not.toBe(0)
    const compass = () => screen.getByRole('button', { name: /^Compass:/ })

    fireEvent.click(compass())
    expect(bearing()).toBe(0)
    expect(compass()).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(compass())
    expect(bearing()).toBe(heading)

    act(() => cam().onFreeLookChange(true))
    act(() => cam().onBearingChange(77))
    fireEvent.click(compass())
    expect(bearing()).toBe(0)
    expect(cam().freeLook).toBe(true) // still exploring, now north-up
  })

  it('one view switch like the rider’s: "Overview" leaves navigation, "Navigation view" comes back following', async () => {
    await startNavigation()
    act(() => cam().onFreeLookChange(true))

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))
    expect(rotator()).not.toHaveClass('map-rotator--nav')
    expect(screen.queryByRole('button', { name: /^Compass:/ })).not.toBeInTheDocument()
    expect(rotator().parentElement!.style.perspective).toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Navigation view' }))
    expect(rotator()).toHaveClass('map-rotator--nav')
    expect(cam().freeLook).toBe(false)
  })
})
