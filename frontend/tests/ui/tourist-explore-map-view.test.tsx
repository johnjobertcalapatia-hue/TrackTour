import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristExplore from '@/features/tourist/pages/TouristExplore'
import TouristExploreMap from '@/features/tourist/pages/TouristExploreMap'

const api = vi.hoisted(() => ({ get: vi.fn() }))

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
    Marker: Empty,
    Polyline: Empty,
    useMap: () => ({ invalidateSize: vi.fn(), getZoom: () => 11, getBounds: () => ({ contains: () => true }), panTo: vi.fn(), getContainer: () => document.createElement('div') }),
    useMapEvents: () => undefined,
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

function CurrentLocation() {
  const { pathname, search } = useLocation()
  return <output data-testid="location">{pathname + search}</output>
}

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tourist/explore" element={<TouristExplore />} />
          <Route path="/tourist/explore/map" element={<TouristExploreMap />} />
          <Route path="/tourist/explore/:id" element={<div>Place page</div>} />
        </Routes>
        <CurrentLocation />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.get.mockReset()
  api.get.mockImplementation((url: string) => {
    if (url === '/tourist/explore') {
      return Promise.resolve({
        places: [],
        food: [{ id: 7, name: 'Bansud Cafe', cover_photo: null, rating: null, municipality: 'Bansud', type: 'food' }],
        stays: [{ id: 9, name: 'Bansud Bay Resort', cover_photo: null, rating: null, municipality: 'Bansud', type: 'stay' }],
      })
    }
    return Promise.resolve({ data: { businesses: [], categories: [], municipalities: [] } })
  })
})

describe('Explore → Map view', () => {
  it('Map view opens the map on the category of the current tab', async () => {
    renderAt('/tourist/explore')

    const mapView = await screen.findByRole('link', { name: 'Map view' })
    expect(mapView).toHaveAttribute('href', '/tourist/explore/map')

    fireEvent.click(screen.getByRole('button', { name: 'Food' }))
    expect(screen.getByRole('link', { name: 'Map view' })).toHaveAttribute('href', '/tourist/explore/map?category=food')

    fireEvent.click(screen.getByRole('button', { name: 'Stays' }))
    expect(screen.getByRole('link', { name: 'Map view' })).toHaveAttribute('href', '/tourist/explore/map?category=stays')
  })

  it('the map starts on the requested category and List view returns to that tab', async () => {
    renderAt('/tourist/explore/map?category=food')

    expect(await screen.findByRole('button', { name: 'Food' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('link', { name: 'List view' })).toHaveAttribute('href', '/tourist/explore?tab=food')

    fireEvent.click(screen.getByRole('button', { name: 'Resorts' }))
    expect(screen.getByRole('link', { name: 'List view' })).toHaveAttribute('href', '/tourist/explore?tab=stays')

    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('link', { name: 'List view' })).toHaveAttribute('href', '/tourist/explore')
  })

  it('an unknown category falls back to All', async () => {
    renderAt('/tourist/explore/map?category=bogus')
    expect(await screen.findByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('stays open the place page, never the booking detail route', async () => {
    renderAt('/tourist/explore?tab=stays')

    fireEvent.click(await screen.findByText('Bansud Bay Resort'))

    expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore/9')
    expect(screen.getByText('Place page')).toBeInTheDocument()
  })

  it('one view switch: "Map view" on the list becomes "List view" on the map, in the same spot', async () => {
    renderAt('/tourist/explore')
    fireEvent.click(await screen.findByRole('button', { name: 'Food' }))

    const onList = screen.getByTestId('explore-view-toggle')
    expect(onList).toHaveTextContent('Map view')
    fireEvent.click(onList)
    expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore/map?category=food')

    const onMap = await screen.findByTestId('explore-view-toggle')
    expect(onMap).toHaveTextContent('List view')
    expect(onMap.className).toBe(onList.className) // same button styling on both views
    // Sits at the end of the top row, like on the list (after the category chips).
    expect(onMap.previousElementSibling?.querySelector('[aria-pressed]')).not.toBeNull()

    fireEvent.click(onMap)
    expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore?tab=food')
    expect(await screen.findByTestId('explore-view-toggle')).toHaveTextContent('Map view')
  })

  it('the map category chips scroll horizontally (swipe, scrollbar, or mouse wheel)', async () => {
    renderAt('/tourist/explore/map')
    const row = await screen.findByTestId('map-category-chips')

    expect(row).toHaveAttribute('aria-label', 'Map categories')
    expect(row.className).toContain('overflow-x-auto')
    expect(row.className).toContain('flex-nowrap')
    expect(row.className).toContain('chip-scroll')
    expect(row.className).not.toContain('scrollbar-hide')
    for (const name of ['All', 'Tourist Spots', 'Food', 'Resorts', 'Other']) {
      expect(screen.getByRole('button', { name }).className).toContain('shrink-0')
    }

    // A vertical mouse wheel scrolls the row sideways when the chips overflow…
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 600 })
    Object.defineProperty(row, 'clientWidth', { configurable: true, value: 300 })
    row.scrollLeft = 0
    fireEvent.wheel(row, { deltaY: 120, deltaX: 0 })
    expect(row.scrollLeft).toBe(120)

    // …and does nothing when everything already fits.
    Object.defineProperty(row, 'scrollWidth', { configurable: true, value: 300 })
    row.scrollLeft = 0
    fireEvent.wheel(row, { deltaY: 120, deltaX: 0 })
    expect(row.scrollLeft).toBe(0)
  })

  describe('municipality filter', () => {
    const MUNIS = [{ id: 2, name: 'Gloria' }, { id: 1, name: 'Bansud' }]
    beforeEach(() => {
      api.get.mockImplementation((url: string, cfg?: { params?: Record<string, unknown> }) => {
        if (url !== '/tourist/explore') return Promise.resolve({ data: { businesses: [], categories: [], municipalities: [] } })
        const gloria = cfg?.params?.municipality_id === '2'
        return Promise.resolve({
          municipalities: MUNIS,
          places: [],
          food: gloria ? [] : [{ id: 7, name: 'Bansud Cafe', cover_photo: null, rating: null, municipality: 'Bansud', type: 'food' }],
          stays: gloria ? [] : [{ id: 9, name: 'Bansud Bay Resort', cover_photo: null, rating: null, municipality: 'Bansud', type: 'stay' }],
        })
      })
    })

    it('lists every municipality (A–Z) and filters the cards by the chosen one', async () => {
      renderAt('/tourist/explore')
      await screen.findByText('Bansud Cafe')

      const select = screen.getByRole('combobox', { name: 'Municipality' }) as HTMLSelectElement
      expect([...select.options].map((o) => o.text)).toEqual(['All municipalities', 'Bansud', 'Gloria'])
      // Sits in the same row as the All / Places / Food / Stays tabs, right after them.
      const row = screen.getByTestId('explore-filters')
      expect(row).toContainElement(select)
      expect(row).toContainElement(screen.getByRole('button', { name: 'Stays' }))
      expect(screen.getByRole('button', { name: 'Stays' }).compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      // No horizontal scroll; at most 2 rows: the tabs stay together on row 1,
      // and the municipality filter + map view wrap to row 2 when they don't fit.
      expect(row.className).toContain('flex-wrap')
      expect(row.className).not.toMatch(/overflow-x-auto|chip-scroll/)
      const tabs = screen.getByTestId('explore-tabs')
      expect(tabs.className).toContain('flex-nowrap')
      expect(Array.from(row.children)).toEqual([tabs, screen.getByTestId('explore-municipality-wrap'), screen.getByTestId('explore-view-toggle')])
      // The filter can shrink to share row 2 with the map button (never a 3rd row).
      expect(screen.getByTestId('explore-municipality-wrap').className).toMatch(/grow basis-0 min-w-\[140px\]/)

      fireEvent.change(select, { target: { value: '2' } })

      expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore?municipality=2')
      expect(await screen.findByText('Nothing listed in Gloria yet')).toBeInTheDocument()
      expect(api.get).toHaveBeenLastCalledWith('/tourist/explore', { params: { municipality_id: '2' } })

      fireEvent.click(screen.getByRole('button', { name: 'Show all municipalities' }))
      expect(await screen.findByText('Bansud Cafe')).toBeInTheDocument()
      expect(screen.getByTestId('location').textContent).toBe('/tourist/explore')
    })

    it('keeps the tab and the municipality together in the URL', async () => {
      renderAt('/tourist/explore?tab=food&municipality=2')

      expect(await screen.findByText('Nothing listed in Gloria yet')).toBeInTheDocument()
      expect((screen.getByRole('combobox', { name: 'Municipality' }) as HTMLSelectElement).value).toBe('2')
      fireEvent.click(screen.getByRole('button', { name: 'Stays' }))
      expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore?tab=stays&municipality=2')
    })
  })
})
