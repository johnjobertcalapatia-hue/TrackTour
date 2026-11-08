import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RestaurantRouteMap from '@/features/tourist/components/RestaurantRouteMap'

const fitBounds = vi.hoisted(() => vi.fn())

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'map' }, children),
    TileLayer: () => null,
    Marker: ({ position }: { position: [number, number] }) =>
      React.createElement('span', { 'data-testid': 'marker', 'data-pos': position.join(',') }),
    Polyline: ({ positions, pathOptions }: { positions: [number, number][]; pathOptions: { dashArray?: string } }) =>
      React.createElement('span', {
        'data-testid': 'route-line',
        'data-points': String(positions.length),
        'data-dashed': pathOptions.dashArray ? 'yes' : 'no',
      }),
    useMap: () => ({ fitBounds }),
  }
})

vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})) } }))

const RESTAURANT: [number, number] = [12.8617, 121.4594]
const TOURIST = { latitude: 12.8401, longitude: 121.4702 }

type Geo = { getCurrentPosition: ReturnType<typeof vi.fn> }
let geo: Geo

function mockGeolocation(result: 'ok' | 'denied') {
  geo = {
    getCurrentPosition: vi.fn((success: PositionCallback, error: PositionErrorCallback) => {
      if (result === 'ok') success({ coords: TOURIST } as GeolocationPosition)
      else error({ code: 1, message: 'denied' } as GeolocationPositionError)
    }),
  }
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true })
}

function renderMap() {
  return render(<RestaurantRouteMap restaurantName="Eksklusibo Grill" destination={RESTAURANT} locationLabel="Poblacion, Bansud" />)
}

beforeEach(() => {
  fitBounds.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('RestaurantRouteMap', () => {
  it('shows only the restaurant until the tourist asks for directions', () => {
    mockGeolocation('ok')
    vi.stubGlobal('fetch', vi.fn())
    renderMap()

    expect(screen.getAllByTestId('marker')).toHaveLength(1)
    expect(screen.queryByTestId('route-line')).not.toBeInTheDocument()
    expect(geo.getCurrentPosition).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('routes from the current GPS position to the restaurant on the road network', async () => {
    mockGeolocation('ok')
    const fetchMock = vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        routes: [{
          distance: 3450,
          duration: 540,
          geometry: { coordinates: [[121.4702, 12.8401], [121.465, 12.85], [121.4594, 12.8617]] },
        }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    renderMap()

    fireEvent.click(screen.getByRole('button', { name: 'Get directions from my location' }))

    // Origin = tourist GPS, destination = restaurant, in OSRM lng,lat order.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const url = String((fetchMock.mock.calls[0] as unknown[])[0])
    expect(url).toContain('121.4702,12.8401;121.4594,12.8617')

    expect(await screen.findByText('3.5 km')).toBeInTheDocument()
    expect(screen.getByText('9 min')).toBeInTheDocument()
    const line = screen.getByTestId('route-line')
    expect(line).toHaveAttribute('data-points', '3')
    expect(line).toHaveAttribute('data-dashed', 'no')
    expect(screen.getAllByTestId('marker').map((m) => m.getAttribute('data-pos'))).toEqual(
      expect.arrayContaining(['12.8401,121.4702', '12.8617,121.4594']),
    )
    expect(fitBounds).toHaveBeenCalled()
  })

  it('draws a dashed straight line while the road route is unavailable', async () => {
    mockGeolocation('ok')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))))
    renderMap()

    fireEvent.click(screen.getByRole('button', { name: 'Get directions from my location' }))

    expect(await screen.findByText(/Finding the best road route/)).toBeInTheDocument()
    const line = screen.getByTestId('route-line')
    expect(line).toHaveAttribute('data-points', '2')
    expect(line).toHaveAttribute('data-dashed', 'yes')
  })

  it('explains how to fix blocked location access and makes no route request', () => {
    mockGeolocation('denied')
    vi.stubGlobal('fetch', vi.fn())
    renderMap()

    fireEvent.click(screen.getByRole('button', { name: 'Get directions from my location' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Location access is blocked')
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByTestId('route-line')).not.toBeInTheDocument()
  })

  it('Clear route removes the route and the tourist marker', async () => {
    mockGeolocation('ok')
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ routes: [{ distance: 1000, duration: 120, geometry: { coordinates: [[121.4702, 12.8401], [121.4594, 12.8617]] } }] }),
    })))
    renderMap()

    fireEvent.click(screen.getByRole('button', { name: 'Get directions from my location' }))
    await screen.findByText('1.0 km')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Clear route' })) })

    expect(screen.queryByTestId('route-line')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('marker')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Get directions from my location' })).toBeInTheDocument()
  })
})
