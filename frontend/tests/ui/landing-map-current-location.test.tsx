import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LandingPage from '@/pages/LandingPage'

const api = vi.hoisted(() => ({ get: vi.fn() }))
const leaflet = vi.hoisted(() => ({
  openPopup: vi.fn(),
  moveEnd: [] as Array<() => void>,
  // Business marker elements (pin + overflowing name label), as Leaflet builds them.
  markerEls: [] as HTMLElement[],
}))

/** Map container 1000 x 600 px at the page origin. */
const container = (() => {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientWidth', { value: 1000 })
  Object.defineProperty(el, 'clientHeight', { value: 600 })
  el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600 }) as DOMRect
  return el
})()

function rect(left: number, width: number): () => DOMRect {
  return () => ({ left, right: left + width, width, top: 180, bottom: 220, height: 40 }) as DOMRect
}

const map = {
  invalidateSize: vi.fn(),
  getZoom: vi.fn(() => 11),
  getCenter: vi.fn(() => ({ lat: 0, lng: 0 })),
  getBounds: vi.fn(() => ({ contains: () => true })),
  flyTo: vi.fn(),
  fitBounds: vi.fn(),
  panTo: vi.fn(),
  once: vi.fn((event: string, cb: () => void) => { if (event === 'moveend') leaflet.moveEnd.push(cb) }),
  getContainer: vi.fn(() => container),
  latLngToContainerPoint: vi.fn(() => ({ x: 124, y: 200 })),
  setMaxBounds: vi.fn(),
  setMinZoom: vi.fn(),
  setZoom: vi.fn(),
  setView: vi.fn(),
  getBoundsZoom: vi.fn(() => 13),
  on: vi.fn(),
  off: vi.fn(),
  options: {} as Record<string, unknown>,
}

vi.mock('@/shared/services/api', () => ({ get: api.get, post: vi.fn(), default: { get: api.get } }))
vi.mock('@/features/auth/services/auth-store', () => {
  const state = { user: null, token: null }
  return { useAuthStore: (selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state) }
})

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  // The user marker exposes openPopup like a Leaflet marker; its Popup content renders inline.
  const Marker = React.forwardRef(({ children }: { children?: React.ReactNode }, ref) => {
    React.useImperativeHandle(ref, () => ({ openPopup: leaflet.openPopup }))
    return children ? React.createElement('div', { 'data-testid': 'user-marker' }, children) : null
  })
  return {
    MapContainer: ({ children, worldCopyJump, maxBoundsViscosity }: { children: React.ReactNode; worldCopyJump?: boolean; maxBoundsViscosity?: number }) =>
      React.createElement('div', { 'data-testid': 'map', 'data-world-copy-jump': String(worldCopyJump), 'data-viscosity': String(maxBoundsViscosity) }, children),
    TileLayer: ({ url, noWrap }: { url: string; noWrap?: boolean }) =>
      React.createElement('span', { 'data-testid': 'tiles', 'data-url': url, 'data-nowrap': String(!!noWrap) }),
    Marker,
    Popup: ({ children }: { children: React.ReactNode }) => React.createElement('div', { role: 'tooltip' }, children),
    Polyline: Empty,
    useMap: () => map,
    useMapEvents: () => undefined,
  }
})

vi.mock('leaflet', () => ({
  default: {
    marker: () => {
      // Pin box 100-148 px; its name label overflows to the right, 118-260 px.
      const element = document.createElement('div')
      element.getBoundingClientRect = rect(100, 48)
      const label = document.createElement('span')
      label.textContent = 'Bansud Cafe'
      label.getBoundingClientRect = rect(118, 142)
      element.append(label)
      leaflet.markerEls.push(element)
      const marker = {
        addTo: () => marker,
        getElement: () => element,
        setZIndexOffset: vi.fn(),
        setLatLng: vi.fn(),
        setIcon: vi.fn(),
        on: vi.fn(),
        remove: vi.fn(),
      }
      return marker
    },
    divIcon: vi.fn(() => ({})),
    latLngBounds: vi.fn((a: number[], b: number[]) => ({ corners: [a, b], pad: () => ({ corners: [a, b] }) })),
    DomEvent: { disableClickPropagation: vi.fn(), disableScrollPropagation: vi.fn() },
  },
}))

const HERE = { coords: { latitude: 12.81, longitude: 121.47 } }

function mockGeolocation(result: 'ok' | 'denied') {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn((ok: (p: typeof HERE) => void, fail: () => void) =>
        result === 'ok' ? ok(HERE) : fail()),
    },
  })
}

function renderMap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/?view=map']}>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom has no ResizeObserver; the map's resize helper needs one.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  // /?view=map scrolls the map into view; jsdom has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn()
  leaflet.moveEnd.splice(0)
  leaflet.markerEls.splice(0)
  api.get.mockResolvedValue([])
})

afterEach(() => {
  vi.unstubAllGlobals()
  // @ts-expect-error test cleanup of the stubbed browser API
  delete navigator.geolocation
})

describe('landing map — current location', () => {
  it('shows "You are here" in the current-location marker pop-up', async () => {
    mockGeolocation('ok')
    renderMap()

    const marker = await screen.findByTestId('user-marker')
    expect(marker).toHaveTextContent('You are here')
  })

  it('focuses the map on the current location and opens the pop-up', async () => {
    mockGeolocation('ok')
    renderMap()
    await screen.findByTestId('user-marker')

    fireEvent.click(screen.getByRole('button', { name: 'Focus on my current location' }))

    expect(map.flyTo).toHaveBeenLastCalledWith([12.81, 121.47], 15, expect.objectContaining({ duration: 0.8 }))
    act(() => leaflet.moveEnd.forEach((cb) => cb()))
    expect(leaflet.openPopup).toHaveBeenCalled()
  })

  it('says the location is unavailable when the browser denies it', async () => {
    mockGeolocation('denied')
    renderMap()

    fireEvent.click(await screen.findByRole('button', { name: 'Focus on my current location' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Location unavailable'))
    expect(map.flyTo).not.toHaveBeenCalled()
    expect(screen.queryByTestId('user-marker')).not.toBeInTheDocument()
  })
})

describe('landing map — map type menu', () => {
  it('is a tile button above the focus button that opens a menu to change the map', async () => {
    mockGeolocation('denied')
    renderMap()

    const tile = await screen.findByRole('button', { name: 'Change map type' })
    const focus = screen.getByRole('button', { name: 'Focus on my current location' })
    // The tile sits above the focus button in the same corner stack.
    expect(tile.compareDocumentPosition(focus) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // The old always-visible Street / Satellite list is gone.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Satellite' })).not.toBeInTheDocument()
    expect(screen.getByTestId('tiles').getAttribute('data-url')).toContain('openstreetmap')

    fireEvent.click(tile)
    expect(tile).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu', { name: 'Map type' })
    expect(within(menu).getByRole('menuitemradio', { name: 'Street' })).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Satellite' }))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('tiles').getAttribute('data-url')).toContain('World_Imagery')

    fireEvent.click(tile)
    expect(screen.getByRole('menuitemradio', { name: 'Satellite' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

const WORLD = expect.objectContaining({ corners: [[-85.05, -180], [85.05, 180]] })
const TOWN = expect.objectContaining({ corners: [[12.79, 121.36], [12.93, 121.51]] })

describe('landing map — one Earth, town view, tourist at the centre', () => {
  it('never repeats the world: no tile wrap, no world-copy jump, panning stops at the edges', async () => {
    mockGeolocation('denied')
    renderMap()

    expect((await screen.findByTestId('tiles')).getAttribute('data-nowrap')).toBe('true')
    expect(screen.getByTestId('map')).toHaveAttribute('data-world-copy-jump', 'false')
    expect(screen.getByTestId('map')).toHaveAttribute('data-viscosity', '1')
    // Farthest zoom-out and pan limit = one whole Earth.
    expect(map.setMaxBounds).toHaveBeenCalledWith(WORLD)
    expect(map.getBoundsZoom).toHaveBeenCalledWith(WORLD, false)
    expect(map.setMinZoom).toHaveBeenCalledWith(13)
  })

  it('opens on the whole town of Bansud, then centres it on the tourist', async () => {
    mockGeolocation('ok')
    renderMap()
    await screen.findByTestId('user-marker')

    expect(map.fitBounds).toHaveBeenCalledWith(TOWN, { animate: false })
    // Town-wide zoom, with the tourist's marker in the middle.
    await waitFor(() => expect(map.setView).toHaveBeenCalledWith([12.81, 121.47], 13, { animate: true }))
  })

  it('stays on the town when the location is unavailable', async () => {
    mockGeolocation('denied')
    renderMap()
    await screen.findByRole('button', { name: 'Focus on my current location' })

    expect(map.fitBounds).toHaveBeenCalledWith(TOWN, { animate: false })
    await new Promise((r) => setTimeout(r, 200))
    expect(map.setView).not.toHaveBeenCalled()
  })
})

describe('landing map — business hover card', () => {
  const BUSINESS = { id: 7, name: 'Bansud Cafe', latitude: 12.86, longitude: 121.45, municipality: 'Bansud', category: 'Restaurant' }
  const card = () => document.querySelector<HTMLElement>('[class~="w-64"][class*="z-[500]"]')!

  beforeEach(() => {
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/map/businesses' ? [BUSINESS] : []))
  })

  it('opens beside the restaurant name, never over it (no flicker)', async () => {
    mockGeolocation('denied')
    renderMap()
    await waitFor(() => expect(leaflet.markerEls).toHaveLength(1))

    fireEvent.mouseEnter(leaflet.markerEls[0]!)

    await waitFor(() => expect(card().style.opacity).toBe('1'))
    // Name label ends at 260 px; the card starts 10 px after it, not on top of it.
    expect(card().style.left).toBe('270px')
  })

  it('stays open when the cursor moves from the card back onto the marker', async () => {
    mockGeolocation('denied')
    renderMap()
    await waitFor(() => expect(leaflet.markerEls).toHaveLength(1))
    fireEvent.mouseEnter(leaflet.markerEls[0]!)
    await waitFor(() => expect(card().style.opacity).toBe('1'))

    fireEvent.mouseEnter(card())
    fireEvent.mouseLeave(card())
    // Leaving the card no longer hides it at once...
    expect(card().style.opacity).toBe('1')
    fireEvent.mouseEnter(leaflet.markerEls[0]!)
    await new Promise((r) => setTimeout(r, 250))
    // ...so re-entering the marker keeps it open.
    expect(card().style.opacity).toBe('1')

    fireEvent.mouseLeave(leaflet.markerEls[0]!)
    await waitFor(() => expect(card().style.opacity).toBe('0'))
  })
})

describe('landing map — filter bar', () => {
  const PLACES = [
    { id: 1, name: 'Bansud Cafe', latitude: 12.86, longitude: 121.45, municipality: 'Bansud', category: 'Restaurant' },
    { id: 2, name: 'Grill House', latitude: 12.87, longitude: 121.46, municipality: 'Bansud', category: 'Restaurant' },
    { id: 3, name: 'Tigbao Falls', latitude: 12.85, longitude: 121.44, municipality: 'Bansud', category: 'Tourist Spot' },
  ]

  beforeEach(() => {
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/map/businesses' ? PLACES : []))
  })

  it('shows each category with its icon and live count, and filters the map', async () => {
    mockGeolocation('denied')
    renderMap()

    const bar = screen.getByRole('group', { name: 'Filter map places' })
    const all = within(bar).getByRole('button', { name: /^All/ })
    expect(all).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(within(all).getByLabelText('3 places')).toBeInTheDocument())
    expect(within(within(bar).getByRole('button', { name: /^Restaurants/ })).getByLabelText('2 places')).toBeInTheDocument()
    expect(within(within(bar).getByRole('button', { name: /^Resorts/ })).getByLabelText('0 places')).toBeInTheDocument()
    await waitFor(() => expect(leaflet.markerEls).toHaveLength(3))

    fireEvent.click(within(bar).getByRole('button', { name: /^Restaurants/ }))
    expect(within(bar).getByRole('button', { name: /^Restaurants/ })).toHaveAttribute('aria-pressed', 'true')
    expect(all).toHaveAttribute('aria-pressed', 'false')
  })

  it('switches back to the content view', async () => {
    mockGeolocation('denied')
    renderMap()

    fireEvent.click(screen.getByRole('button', { name: 'Toggle content and map' }))
    expect(screen.queryByRole('group', { name: 'Filter map places' })).not.toBeInTheDocument()
  })
})
