import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import MapLayerTile, { type MapLayerKind } from '@/shared/components/MapLayerTile'
import TouristExploreMap from '@/features/tourist/pages/TouristExploreMap'

vi.mock('@/shared/services/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  default: { get: vi.fn(() => Promise.resolve({ data: { businesses: [], categories: [], municipalities: [] } })), post: vi.fn() },
}))
vi.mock('@/features/auth/services/auth-store', () => {
  const state = { user: { role: 'tourist', name: 'T' }, token: 't' }
  return { useAuthStore: (selector?: (v: typeof state) => unknown) => (selector ? selector(state) : state) }
})
vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'map' }, children),
    TileLayer: ({ url }: { url: string }) => React.createElement('span', { 'data-testid': 'tiles', 'data-url': url }),
    Marker: Empty,
    Polyline: Empty,
    useMap: () => ({ invalidateSize: vi.fn(), getZoom: () => 12, setView: vi.fn(), fitBounds: vi.fn(), getBounds: () => ({ contains: () => true }), panTo: vi.fn(), getContainer: () => document.createElement('div') }),
    useMapEvents: () => undefined,
  }
})
vi.mock('leaflet', () => ({ default: { marker: () => ({ addTo: () => ({}) }), divIcon: vi.fn(() => ({})), latLngBounds: vi.fn() } }))

function Harness() {
  const [layer, setLayer] = useState<MapLayerKind>('street')
  return <><MapLayerTile value={layer} onChange={setLayer} /><output data-testid="layer">{layer}</output></>
}

describe('MapLayerTile', () => {
  it('previews and switches to the other layer, then back', () => {
    render(<Harness />)

    const tile = screen.getByRole('button', { name: 'Switch to satellite view' })
    expect(tile).toHaveTextContent('Satellite')
    expect(tile.querySelector('img')?.getAttribute('src')).toContain('World_Imagery')

    fireEvent.click(tile)
    expect(screen.getByTestId('layer')).toHaveTextContent('satellite')
    const back = screen.getByRole('button', { name: 'Switch to map view' })
    expect(back).toHaveTextContent('Map')
    expect(back.querySelector('img')?.getAttribute('src')).toContain('tile.openstreetmap.org')

    fireEvent.click(back)
    expect(screen.getByTestId('layer')).toHaveTextContent('street')
  })
})

describe('Tourist map uses the layer tile instead of the dropdown', () => {
  it('sits at the top right of the map and swaps the map tiles', async () => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: vi.fn() } })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><TouristExploreMap /></MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('combobox', { name: 'Change map layer' })).not.toBeInTheDocument()
    const tile = await screen.findByRole('button', { name: 'Switch to satellite view' })
    // Positioned by the map-controls column it shares with "Show my location".
    expect(tile.parentElement!.className).toContain('top-3')
    expect(tile.parentElement!.className).toContain('right-3')
    // Tile is inside the map area (same container as the map), not in the filter bar.
    expect(tile.parentElement!.parentElement).toBe(screen.getByTestId('map').parentElement!.parentElement)
    expect(screen.getByTestId('tiles').getAttribute('data-url')).toContain('openstreetmap')

    fireEvent.click(tile)
    expect(screen.getByTestId('tiles').getAttribute('data-url')).toContain('World_Imagery')
    expect(screen.getByRole('button', { name: 'Switch to map view' })).toBeInTheDocument()
  })
})
