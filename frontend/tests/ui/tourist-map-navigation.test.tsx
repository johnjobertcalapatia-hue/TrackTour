import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouristExploreMap from '@/features/tourist/pages/TouristExploreMap'
import { bearingAlongRoute, compassHeadingFrom, routeBearing } from '@/features/tourist/hooks/use-navigation-bearing'
import { bearingBetween } from '@/shared/utils/rider-heading'
import { planeOffsetForScreenY } from '@/features/rider/navigation-view'

const api = vi.hoisted(() => ({ get: vi.fn() }))
const map = vi.hoisted(() => ({
  zoom: 13,
  setView: vi.fn(),
  fitBounds: vi.fn(),
  invalidateSize: vi.fn(),
  dragging: { disable: vi.fn(), enable: vi.fn() },
  options: {} as Record<string, unknown>,
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
    Polyline: ({ positions, pathOptions }: { positions: [number, number][]; pathOptions: { color: string } }) =>
      pathOptions.color === '#087F3F'
        ? React.createElement('span', { 'data-testid': 'route-line', 'data-start': positions[0]?.join(','), 'data-points': positions.length })
        : null,
    Marker: ({ eventHandlers }: { eventHandlers?: { click?: () => void; mouseover?: (e: unknown) => void } }) =>
      eventHandlers?.click
        ? React.createElement(React.Fragment, null,
            React.createElement('button', { type: 'button', 'aria-label': 'Select map business', onClick: eventHandlers.click }),
            React.createElement('button', {
              type: 'button',
              'aria-label': 'Hover marker',
              onClick: () => eventHandlers.mouseover?.({ target: { _map: { latLngToContainerPoint: () => ({ x: 200, y: 150 }), getContainer: () => ({ clientWidth: 800, clientHeight: 600 }) } } }),
            }),
          )
        : null,
    useMap: () => ({
      ...map,
      getZoom: () => map.zoom,
      // 1 px = 0.00001 deg; y grows southwards like Leaflet pixel space.
      project: ([lat, lng]: [number, number]) => ({ x: lng * 100_000, y: -lat * 100_000 }),
      unproject: (p: { x: number; y: number }) => [-p.y / 100_000, p.x / 100_000],
      getBounds: () => ({ contains: () => true }), panTo: vi.fn(), getContainer: () => document.createElement('div') }),
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

function renderMap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TouristExploreMap /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const rotator = () => screen.getByTestId('map-rotator')
const bearing = () => Number(rotator().dataset.bearing)

/** Hover the restaurant and press the hover card's "Navigate" button. */
async function startDirections() {
  renderMap()
  await act(async () => emit?.({ latitude: USER.lat, longitude: USER.lng, heading: null, speed: 0 }))
  fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigate' })) })
  await waitFor(() => expect(screen.getByTestId('map-rotator')).toHaveClass('map-rotator--nav'))
}

/** Back to the north-up whole-route view, where the route card shows. */
async function toOverview() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Overview' })) })
}

beforeEach(() => {
  sessionStorage.clear()
  map.zoom = 13
  map.setView.mockReset()
  map.setView.mockImplementation((_c: unknown, z: number) => { map.zoom = z })
  map.fitBounds.mockReset()
  map.invalidateSize.mockReset()
  map.dragging.disable.mockReset()
  map.dragging.enable.mockReset()
  map.options = {}
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

describe('Explore map: navigation view after "Directions"', () => {
  it('centres on the tourist, locks panning, and turns the map to face the route', async () => {
    await startDirections()

    expect(rotator()).toHaveClass('map-rotator--nav')
    expect(map.setView).toHaveBeenLastCalledWith([USER.lat, USER.lng], 18, { animate: true })
    expect(map.dragging.disable).toHaveBeenCalled()
    // Pinch zooms about the centre (then snaps back onto the user); wheel and
    // double-click are handled by the camera, which zooms around the user.
    expect(map.options.touchZoom).toBe('center')
    expect(map.fitBounds).not.toHaveBeenCalled()
    // Standing still, no compass: face along the route.
    const expected = bearingBetween({ latitude: USER.lat, longitude: USER.lng }, { latitude: 12.85, longitude: 121.465 })
    expect(Math.abs(((bearing() % 360) + 360) % 360 - Math.round(expected))).toBeLessThanOrEqual(1)
  })

  it('keeps the route ahead at the top even when the phone turns or the GPS course differs', async () => {
    await startDirections()
    const along = bearing()

    await act(async () => {
      const e = new Event('deviceorientation') as Event & { webkitCompassHeading?: number }
      e.webkitCompassHeading = 90
      window.dispatchEvent(e)
    })
    expect(bearing()).toBe(along)

    // Walking along the route with a noisy course: still faces the road ahead, and the camera follows.
    await act(async () => emit?.({ latitude: 12.845, longitude: 121.4675, heading: 200, speed: 3 }))
    const ahead = bearingBetween({ latitude: 12.845, longitude: 121.4675 }, { latitude: 12.85, longitude: 121.465 })
    expect(Math.abs(((bearing() % 360) + 360) % 360 - Math.round(ahead))).toBeLessThanOrEqual(2)
    expect(map.setView).toHaveBeenLastCalledWith([12.845, 121.4675], 18, { animate: true })
  })

  it('"Navigate" zooms in and centres on the marker when there is no measured layout to anchor to', async () => {
    // A real, measured map area (not 0x0) and a zoomed-out starting view.
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    await startDirections()

    const [center, zoom] = map.setView.mock.lastCall as [[number, number], number]
    expect(center).toEqual([USER.lat, USER.lng]) // centred on the marker, no offset
    expect(zoom).toBe(18) // zoomed in from 13
    expect(map.invalidateSize).toHaveBeenCalled() // re-measured after the rotator resized
  })

  it('puts the marker above the mobile bottom bar: 30 px over the top of the bar, right above "Stays"', async () => {
    // Phone layout: map area 400x700 at y=100; bottom bar 64 px tall at y=736; "Stays" centred at x=200.
    const bar = document.createElement('nav')
    bar.setAttribute('aria-label', 'Tourist bottom navigation')
    const stays = document.createElement('a')
    stays.setAttribute('aria-label', 'Stays')
    bar.appendChild(stays)
    document.body.appendChild(bar)
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === bar) return rect(0, 736, 400, 64)
      if (this === stays) return rect(171, 736, 58, 64)
      if (this.querySelector(':scope > [data-testid="map-rotator"]')) return rect(0, 100, 400, 700)
      return rect(0, 0, 0, 0)
    })

    try {
      await startDirections()
      await act(async () => { window.dispatchEvent(new Event('resize')) })

      const [center, zoom] = map.setView.mock.lastCall as [[number, number], number]
      // Map pixels (mock projection), then turn by the map rotation to get screen pixels.
      const toPx = ([lat, lng]: [number, number]) => ({ x: lng * 100_000, y: -lat * 100_000 })
      const u = toPx([USER.lat, USER.lng])
      const c = toPx(center)
      const b = (bearing() * Math.PI) / 180
      const mx = u.x - c.x
      const my = u.y - c.y
      const screen = { x: mx * Math.cos(b) + my * Math.sin(b), y: -mx * Math.sin(b) + my * Math.cos(b) }

      // Area centre is (200, 450); target is (200, 736 - 30 = 706) -> 256 px below centre, straight down.
      // The map is tilted back (3D, like the rider's), so the camera places the
      // tourist at the point of the tilted plane that shows 256 px down...
      expect(screen.x).toBeCloseTo(0, 0)
      expect(screen.y).toBeCloseTo(Math.round(planeOffsetForScreenY(256)), 0)
      expect(zoom).toBe(18)
      // ...where the fixed puck is drawn on screen.
      expect(document.querySelector<HTMLElement>('[data-testid="rider-nav-puck"]')!.style.transform)
        .toBe('translate(calc(-50% + 0px), calc(-50% + 256px))')
    } finally {
      bar.remove()
    }
  })

  it('keeps a closer zoom the tourist already had', async () => {
    renderMap()
    await act(async () => emit?.({ latitude: USER.lat, longitude: USER.lng, heading: null, speed: 0 }))
    map.zoom = 19
    fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigate' })) })

    expect(map.setView).toHaveBeenLastCalledWith([USER.lat, USER.lng], 19, { animate: true })
  })

  it('the compass button switches to the north-up whole-route view and back', async () => {
    await startDirections()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Overview' })) })
    expect(rotator()).not.toHaveClass('map-rotator--nav')
    expect(bearing()).toBe(0)
    expect(map.dragging.enable).toHaveBeenCalled()
    expect(map.fitBounds).toHaveBeenCalled()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigation view' })) })
    expect(rotator()).toHaveClass('map-rotator--nav')
  })

  it('shows the tourist ON the line and centres there, so the line runs straight up from the marker', async () => {
    await startDirections()
    // ~10 m east of the first road segment (still on route, below the 40 m re-plan threshold).
    await act(async () => emit?.({ latitude: 12.845, longitude: 121.4676, heading: null, speed: 1 }))

    const [[lat, lng]] = map.setView.mock.lastCall as [[number, number], number]
    expect([lat, lng]).not.toEqual([12.845, 121.4676]) // not the raw GPS point
    // On the segment (12.84, 121.47) -> (12.85, 121.465): same fraction along in lat and lng.
    expect((lat - 12.84) / 0.01).toBeCloseTo((121.47 - lng) / 0.005, 3)
    // "Up" is that segment's direction, so the drawn line leaves the centre straight up.
    const segment = bearingBetween({ latitude: 12.84, longitude: 121.47 }, { latitude: 12.85, longitude: 121.465 })
    expect(Math.abs(((bearing() % 360) + 360) % 360 - Math.round(segment))).toBeLessThanOrEqual(1)
  })

  it('shows a small travel-only card while navigating: time, distance left and speed (no fares or booking)', async () => {
    await startDirections()
    const card = screen.getByRole('complementary', { name: 'Navigation' })

    // 2.5 km by motorcycle (30 km/h) = 5 min.
    expect(within(card).getByTestId('nav-eta')).toHaveTextContent('5 min')
    expect(within(card).getByTestId('nav-distance')).toHaveTextContent('2.5 km')
    expect(within(card).getByTestId('nav-speed')).toHaveTextContent('0 km/h')
    expect(card).toHaveTextContent('To Eksklusibo Grill')
    // Horizontal: Time, Distance and Speed side by side in one row.
    const list = card.querySelector('dl')!
    expect(list.className).toContain('grid-cols-3')
    expect(list.className).not.toContain('flex-col')
    expect([...list.querySelectorAll('dt')].map((d) => d.textContent)).toEqual(['Time', 'Distance', 'Speed'])
    // No fare computation, booking, or travel-mode picker; the full route card is not shown.
    expect(card.textContent).not.toMatch(/₱|fare/i)
    expect(screen.queryByRole('button', { name: 'Book a Rider' })).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Travel mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Route' })).not.toBeInTheDocument()

    // GPS speed is shown in km/h as the tourist moves (5 m/s = 18 km/h).
    await act(async () => emit?.({ latitude: 12.845, longitude: 121.4675, heading: null, speed: 5 }))
    expect(within(card).getByTestId('nav-speed')).toHaveTextContent('18 km/h')
    expect(Number(/([\d.]+) km/.exec(within(card).getByTestId('nav-distance').textContent ?? '')?.[1])).toBeLessThan(2.5)
  })

  it('"Exit navigation" on the small card returns to the full route card', async () => {
    await startDirections()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Exit navigation' })) })

    expect(screen.queryByRole('complementary', { name: 'Navigation' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Route' })).toBeInTheDocument()
    expect(screen.getByTestId('map-rotator')).not.toHaveClass('map-rotator--nav')
  })

  it('closing the route ends the navigation view', async () => {
    await startDirections()
    await toOverview()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close route' })) })

    expect(rotator()).not.toHaveClass('map-rotator--nav')
    expect(screen.queryByRole('button', { name: /north up|Follow me/ })).not.toBeInTheDocument()
  })
})

describe('Explore map: the route follows the tourist', () => {
  const line = () => screen.getByTestId('route-line')
  const kmText = () => screen.getByRole('complementary', { name: 'Route' }).textContent ?? ''

  it('is consumed as the tourist walks: it starts at them and the distance left shrinks', async () => {
    await startDirections()
    expect(line().dataset.start).toBe('12.84,121.47')

    // Walk along the route to the middle point.
    await act(async () => emit?.({ latitude: 12.85, longitude: 121.465, heading: null, speed: 1 }))

    const [lat, lng] = line().dataset.start!.split(',').map(Number)
    expect(lat).toBeCloseTo(12.85, 4)
    expect(lng).toBeCloseTo(121.465, 4)
    expect(Number(line().dataset.points)).toBe(2) // only the stretch still ahead
    // The card (whole-route view) shows the distance left, not the full 2.50 km.
    await toOverview()
    expect(kmText()).not.toContain('2.50 km')
    const left = Number(/([\d.]+) km/.exec(kmText())?.[1])
    expect(left).toBeGreaterThan(0)
    expect(left).toBeLessThan(2.5)
    expect(fetch).toHaveBeenCalledTimes(1) // still on the route: no re-plan
  })

  it('re-plans from where the tourist is once they leave the route', async () => {
    await startDirections()
    vi.mocked(fetch).mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ routes: [{ distance: 3900, duration: 700, geometry: { coordinates: [[121.49, 12.84], [121.47, 12.86], [121.46, 12.86]] } }] }),
    }) as never)
    // About 2 km east of the route, well past the 40 m threshold. Lifts the reroute cooldown.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000)

    await act(async () => emit?.({ latitude: 12.84, longitude: 121.49, heading: null, speed: 1 }))

    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('121.49,12.84;121.46,12.86'))
    expect(line().dataset.start).toBe('12.84,121.49') // the new, longer route starts at the tourist
    expect(screen.getByTestId('map-rotator')).toHaveClass('map-rotator--nav') // still navigating
  })
})

describe('navigation bearing helpers', () => {
  it('reads iOS and absolute-orientation compass events; ignores relative ones', () => {
    expect(compassHeadingFrom({ webkitCompassHeading: 370 } as never)).toBe(10)
    expect(compassHeadingFrom({ absolute: true, alpha: 90, type: 'deviceorientation' } as never)).toBe(270)
    expect(compassHeadingFrom({ absolute: false, alpha: 90, type: 'deviceorientation' } as never)).toBeNull()
  })

  it('"up" follows the road right under the tourist, not a point far ahead past a turn', () => {
    // 22 m north, then a sharp turn east for 500 m.
    const turn: [number, number][] = [[12.84, 121.47], [12.8402, 121.47], [12.8402, 121.4746]]
    expect(bearingAlongRoute(turn)).toBeCloseTo(0, 0) // straight up = along the first stretch
    // The old 50 m look-ahead pointed well east of the road under the tourist.
    expect(routeBearing({ lat: 12.84, lng: 121.47 }, turn)!).toBeGreaterThan(60)
    expect(bearingAlongRoute([[12.84, 121.47]])).toBeNull()
  })

  it('route bearing looks past points right beside the tourist', () => {
    const near: [number, number] = [12.84001, 121.47001] // about 1.5 m away: skipped
    expect(routeBearing(USER, [near, [12.85, 121.47]])).toBeCloseTo(0, 0) // due north
    expect(routeBearing(null, [near])).toBeNull()
  })
})
