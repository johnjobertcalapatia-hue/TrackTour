import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouristExploreMap from '@/features/tourist/pages/TouristExploreMap'

const api = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@/shared/services/api', () => ({ get: api.get, post: vi.fn(), default: { get: api.get, post: vi.fn() } }))
vi.mock('@/features/auth/services/auth-store', () => {
  const state = { user: { role: 'tourist', name: 'Test Tourist' }, token: 't' }
  return { useAuthStore: (selector?: (v: typeof state) => unknown) => (selector ? selector(state) : state) }
})

const fakeLeafletMap = {
  latLngToContainerPoint: () => ({ x: 200, y: 150 }),
  getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
}

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    TileLayer: Empty,
    Polyline: ({ pathOptions }: { pathOptions: { color: string } }) =>
      React.createElement('span', { 'data-testid': 'route-line', 'data-color': pathOptions.color }),
    // Each business marker renders "hover" and "click" test buttons wired to its handlers.
    Marker: ({ eventHandlers }: { eventHandlers?: { click?: () => void; mouseover?: (e: unknown) => void; mouseout?: () => void } }) =>
      eventHandlers?.click
        ? React.createElement(React.Fragment, null,
            React.createElement('button', { type: 'button', 'aria-label': 'Hover marker', onClick: () => eventHandlers.mouseover?.({ target: { _map: fakeLeafletMap } }) }),
            React.createElement('button', { type: 'button', 'aria-label': 'Click marker', onClick: eventHandlers.click }),
          )
        : null,
    useMap: () => ({ invalidateSize: vi.fn(), getZoom: () => 12, setView: vi.fn(), fitBounds: vi.fn(), getBounds: () => ({ contains: () => true }), panTo: vi.fn(), getContainer: () => document.createElement('div') }),
    useMapEvents: () => undefined,
  }
})

vi.mock('leaflet', () => ({
  default: {
    marker: () => { const m = { addTo: () => m, getElement: () => document.createElement('div'), setZIndexOffset: vi.fn(), setLatLng: vi.fn(), setIcon: vi.fn(), remove: vi.fn(), on: vi.fn() }; return m },
    divIcon: vi.fn(() => ({})),
    latLngBounds: vi.fn(() => ({})),
  },
}))

const BUSINESS = {
  id: 7, name: 'Eksklusibo Grill and Restaurant', category: { id: 1, name: 'Restaurant' }, municipality: { id: 1, name: 'Bansud' }, barangay: null,
  address: 'Poblacion', latitude: 12.86, longitude: 121.46, logo: null, cover_photo: null, is_open: true, reviews_count: 0, reviews_avg_rating: 0, promotions: [], menu_items: [],
}

const card = () => screen.getByTestId('map-hover-card')
const cardVisible = () => card().getAttribute('aria-hidden') === 'false' && card().style.opacity === '1'

function renderMap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TouristExploreMap /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  api.get.mockReset()
  api.get.mockResolvedValue({ data: { businesses: [BUSINESS], categories: [], municipalities: [] } })
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn() } })
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})

afterEach(() => vi.unstubAllGlobals())

describe('Tourist map hover card', () => {
  it('hover shows the card with the restaurant photo; clicking the marker hides it and opens the panel', async () => {
    api.get.mockResolvedValue({ data: { businesses: [{ ...BUSINESS, cover_photo: 'business-covers/eksklusibo.jpg' }], categories: [], municipalities: [] } })
    renderMap()

    fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
    expect(cardVisible()).toBe(true)
    const photo = card().querySelector('img')
    expect(photo?.getAttribute('src')).toContain('business-covers/eksklusibo.jpg')
    expect(photo).toHaveAttribute('alt', 'Eksklusibo Grill and Restaurant')

    fireEvent.click(screen.getByRole('button', { name: 'Click marker' }))
    expect(cardVisible()).toBe(false)
    expect(await screen.findByRole('heading', { name: 'Eksklusibo Grill and Restaurant' })).toBeInTheDocument()
  })

  it('appears on marker hover', async () => {
    renderMap()
    fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
    expect(cardVisible()).toBe(true)
  })

  it('disappears when the marker is clicked', async () => {
    renderMap()
    fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
    expect(cardVisible()).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Click marker' }))

    expect(cardVisible()).toBe(false)
    expect(await screen.findByRole('heading', { name: 'Eksklusibo Grill and Restaurant' })).toBeInTheDocument()
  })

  it('shows again on the next hover after a click, even for the open business', async () => {
    renderMap()
    fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
    fireEvent.click(screen.getByRole('button', { name: 'Click marker' }))
    await screen.findByRole('heading', { name: 'Eksklusibo Grill and Restaurant' })
    expect(cardVisible()).toBe(false)

    // Mouse leaves and hovers the pin (or its name label) again.
    fireEvent.click(screen.getByRole('button', { name: 'Hover marker' }))
    expect(cardVisible()).toBe(true)
  })

  it('the name label is rendered inside the marker element (so hovering the name = hovering the pin)', async () => {
    const { pinSvg } = await vi.importActual<typeof import('@/shared/utils/pin-icon')>('@/shared/utils/pin-icon')
    const host = document.createElement('div')
    host.innerHTML = pinSvg('Eksklusibo Grill')
    const label = host.querySelector('.marker-label')
    expect(label?.textContent).toBe('Eksklusibo Grill')
    expect(host.contains(label)).toBe(true)
  })

  it('disappears when "Get directions" on the hover card is clicked', async () => {
    renderMap()
    fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
    expect(cardVisible()).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Get directions' }))
    })

    expect(cardVisible()).toBe(false)
  })

  it('"Get directions" on the hover card creates the route without opening the details panel', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.84, longitude: 121.47 } } as GeolocationPosition) },
    })
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ routes: [{ distance: 4200, duration: 600, geometry: { coordinates: [[121.47, 12.84], [121.46, 12.86]] } }] }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0 })

    renderMap()
    fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
    expect(screen.queryByTestId('route-line')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Get directions' }))
    })

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('121.47,12.84;121.46,12.86'))
    expect((await screen.findAllByTestId('route-line')).map((l) => l.dataset.color)).toContain('#087F3F')
    expect(await screen.findByRole('complementary', { name: 'Route' })).toBeInTheDocument()
    // The restaurant information panel stays closed (no heading, no panel tabs).
    expect(screen.queryByRole('heading', { name: 'Eksklusibo Grill and Restaurant' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Show business details' })).not.toBeInTheDocument()
    // Closing the route clears it.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close route' })) })
    expect(screen.queryByTestId('route-line')).not.toBeInTheDocument()
  })

  it('is fully hidden before any hover (no placeholder card on the map)', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Hover marker' })
    expect(card().style.visibility).toBe('hidden')
    expect(card().style.opacity).toBe('0')
    expect(card()).toHaveAttribute('inert')
  })

  it('fades out in place with the same business, never jumping to the corner as "Business name"', async () => {
    renderMap()
    fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
    const { left, top } = card().style
    expect(left).not.toBe('')
    expect(card()).toHaveTextContent('Eksklusibo Grill and Restaurant')

    // Hover ends (clicking the marker dismisses it).
    fireEvent.click(screen.getByRole('button', { name: 'Click marker' }))

    expect(card().style.opacity).toBe('0')
    expect(card().style.left).toBe(left)
    expect(card().style.top).toBe(top)
    expect(card()).toHaveTextContent('Eksklusibo Grill and Restaurant')
    expect(card()).not.toHaveTextContent('Business name')
    // Hidden for good once the 300 ms fade is over, and not clickable meanwhile.
    expect(card().style.visibility).toBe('hidden')
    expect(card().style.transition).toContain('visibility 0s linear 300ms')
    expect(card()).toHaveAttribute('inert')
  })

  describe('"Navigate" vs "Get directions"', () => {
    beforeEach(() => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.84, longitude: 121.47 } } as GeolocationPosition) },
      })
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ routes: [{ distance: 4200, duration: 600, geometry: { coordinates: [[121.47, 12.84], [121.46, 12.86]] } }] }),
      })))
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => { cb(0); return 0 })
    })

    it('the hover card has a round arrow "Navigate" button next to "Get directions"', async () => {
      renderMap()
      fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
      const navigateBtn = screen.getByRole('button', { name: 'Navigate' })
      expect(navigateBtn.className).toContain('rounded-full')
      expect(navigateBtn.querySelector('svg')).not.toBeNull()
      expect(screen.getByRole('button', { name: 'Get directions' })).toBeInTheDocument()
    })

    it('"Navigate" draws the route and starts navigation', async () => {
      renderMap()
      fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Navigate' })) })

      expect((await screen.findAllByTestId('route-line')).length).toBeGreaterThan(0)
      expect(screen.getByTestId('map-rotator')).toHaveClass('map-rotator--nav')
      expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute('data-current-view', 'navigation')
    })

    it('"Get directions" only draws the route line (no navigation)', async () => {
      renderMap()
      fireEvent.click(await screen.findByRole('button', { name: 'Hover marker' }))
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Get directions' })) })

      expect((await screen.findAllByTestId('route-line')).length).toBeGreaterThan(0)
      expect(screen.getByTestId('map-rotator')).not.toHaveClass('map-rotator--nav')
      expect(screen.getByRole('button', { name: 'Navigation view' })).toHaveAttribute('data-current-view', 'overview')
    })
  })
})
