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

    const category = await screen.findByRole('combobox', { name: 'Category' })
    expect(category).toHaveTextContent('Food')
    expect(screen.getByRole('link', { name: 'List view' })).toHaveAttribute('href', '/tourist/explore?tab=food')

    fireEvent.click(category)
    fireEvent.click(screen.getByRole('option', { name: 'Resorts' }))
    expect(screen.getByRole('link', { name: 'List view' })).toHaveAttribute('href', '/tourist/explore?tab=stays')

    fireEvent.click(category)
    fireEvent.click(screen.getByRole('option', { name: 'All Categories' }))
    expect(screen.getByRole('link', { name: 'List view' })).toHaveAttribute('href', '/tourist/explore')
  })

  it('an unknown category falls back to All', async () => {
    renderAt('/tourist/explore/map?category=bogus')
    expect(await screen.findByRole('combobox', { name: 'Category' })).toHaveTextContent('All Categories')
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
    // On the map it floats at the top left, beside the places panel and its filters.
    expect(onMap.parentElement!.className).toContain('top-3 left-3')

    fireEvent.click(onMap)
    expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore?tab=food')
    expect(await screen.findByTestId('explore-view-toggle')).toHaveTextContent('Map view')
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

      const select = screen.getByRole('combobox', { name: 'Municipality' })
      expect(select).toHaveTextContent('All municipalities')
      fireEvent.click(select)
      expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All municipalities', 'Bansud', 'Gloria'])
      expect(screen.getByRole('option', { name: 'All municipalities' })).toHaveAttribute('aria-selected', 'true')
      fireEvent.click(select)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
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

      fireEvent.click(select)
      fireEvent.click(screen.getByRole('option', { name: 'Gloria' }))
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

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
      expect(screen.getByRole('combobox', { name: 'Municipality' })).toHaveTextContent('Gloria')
      fireEvent.click(screen.getByRole('button', { name: 'Stays' }))
      expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore?tab=stays&municipality=2')
    })

    it('is green: green when showing all, solid green when filtered, and the chosen option is solid green', async () => {
      renderAt('/tourist/explore')
      await screen.findByText('Bansud Cafe')
      const select = screen.getByRole('combobox', { name: 'Municipality' })
      expect(select.className).toContain('bg-[#E9F7EF]')
      expect(select.className).toContain('border-[#087F3F]')
      expect(select.className).toContain('text-[#087F3F]')

      fireEvent.click(select)
      expect(screen.getByRole('option', { name: 'All municipalities' }).className).toContain('bg-[#087F3F]')
      expect(screen.getByRole('option', { name: 'Gloria' }).className).not.toContain('bg-[#087F3F]')
      fireEvent.click(screen.getByRole('option', { name: 'Gloria' }))

      await screen.findByText('Nothing listed in Gloria yet')
      expect(select.className).toContain('bg-[#087F3F]')
      expect(select.className).toContain('text-white')
    })

    it('works from the keyboard and closes on Escape or an outside click', async () => {
      renderAt('/tourist/explore')
      await screen.findByText('Bansud Cafe')
      const select = screen.getByRole('combobox', { name: 'Municipality' })

      fireEvent.keyDown(select, { key: 'ArrowDown' })
      expect(screen.getByRole('listbox')).toBeInTheDocument()
      fireEvent.keyDown(select, { key: 'Escape' })
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

      fireEvent.click(select)
      fireEvent.mouseDown(document.body)
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

      fireEvent.keyDown(select, { key: 'Enter' })
      fireEvent.keyDown(select, { key: 'ArrowDown' })
      fireEvent.keyDown(select, { key: 'ArrowDown' })
      fireEvent.keyDown(select, { key: 'Enter' })
      expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore?municipality=2')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })
})
