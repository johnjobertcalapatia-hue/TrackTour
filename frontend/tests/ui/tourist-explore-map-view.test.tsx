import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
    if (url === '/tourist/posts') return Promise.resolve({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
    return Promise.resolve({ data: { businesses: [], categories: [], municipalities: [] } })
  })
})

describe('Explore → Map view', () => {
  // The map renders the tabs twice (top of the places panel on computers, floating on phones; CSS shows one).
  const views = () => within(screen.getAllByRole('navigation', { name: 'Explore views' })[0]!)

  it('Explore opens on Deals & Posts; the tabs switch to Businesses and Map', async () => {
    renderAt('/tourist/explore')
    expect(await screen.findByText('No posts yet.')).toBeInTheDocument()
    expect(views().getByRole('link', { name: 'Deals & Posts' })).toHaveAttribute('aria-current', 'page')
    expect(views().getByRole('link', { name: 'Businesses' })).toHaveAttribute('href', '/tourist/explore?view=businesses')
    expect(views().getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/tourist/explore/map')
    expect(screen.queryByText('Bansud Cafe')).not.toBeInTheDocument()

    fireEvent.click(views().getByRole('link', { name: 'Businesses' }))
    expect(await screen.findByText('Bansud Cafe')).toBeInTheDocument()
    expect(views().getByRole('link', { name: 'Businesses' })).toHaveAttribute('aria-current', 'page')
  })

  it('Map opens the map on the category of the current business tab', async () => {
    renderAt('/tourist/explore?view=businesses')

    await screen.findByText('Bansud Cafe')
    expect(views().getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/tourist/explore/map')

    fireEvent.click(screen.getByRole('button', { name: 'Food' }))
    expect(views().getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/tourist/explore/map?category=food')

    fireEvent.click(screen.getByRole('button', { name: 'Stays' }))
    expect(views().getByRole('link', { name: 'Map' })).toHaveAttribute('href', '/tourist/explore/map?category=stays')
  })

  it('the map starts on the requested category and Businesses returns to that tab', async () => {
    renderAt('/tourist/explore/map?category=food')

    const category = await screen.findByRole('combobox', { name: 'Category' })
    expect(category).toHaveTextContent('Food')
    expect(views().getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page')
    expect(views().getByRole('link', { name: 'Businesses' })).toHaveAttribute('href', '/tourist/explore?view=businesses&tab=food')
    expect(views().getByRole('link', { name: 'Deals & Posts' })).toHaveAttribute('href', '/tourist/explore')

    fireEvent.click(category)
    fireEvent.click(screen.getByRole('option', { name: 'Resorts' }))
    expect(views().getByRole('link', { name: 'Businesses' })).toHaveAttribute('href', '/tourist/explore?view=businesses&tab=stays')

    fireEvent.click(category)
    fireEvent.click(screen.getByRole('option', { name: 'All Categories' }))
    expect(views().getByRole('link', { name: 'Businesses' })).toHaveAttribute('href', '/tourist/explore?view=businesses')
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

  it('one set of Explore tabs: on the list, at the top of the map panel (computers) and floating on the map (phones)', async () => {
    renderAt('/tourist/explore?view=businesses')
    fireEvent.click(await screen.findByRole('button', { name: 'Food' }))

    const onList = screen.getByTestId('explore-sections')
    fireEvent.click(within(onList).getByRole('link', { name: 'Map' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore/map?category=food')

    await screen.findByRole('combobox', { name: 'Category' })
    const [inPanel, floating] = screen.getAllByTestId('explore-sections')
    // Computers: above "Explore places" in the places panel, full width.
    expect(screen.getByRole('complementary', { name: 'Places' })).toContainElement(inPanel!)
    expect(inPanel!.parentElement!.className).toMatch(/hidden sm:block/)
    expect(inPanel!.compareDocumentPosition(screen.getByRole('heading', { name: 'Explore places' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Phones: floating at the top left of the map.
    expect(floating!.className).toContain('shadow-md')
    expect(floating!.parentElement!.className).toContain('top-3 left-3')
    expect(floating!.parentElement!.className).toContain('sm:hidden')

    fireEvent.click(within(inPanel!).getByRole('link', { name: 'Businesses' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore?view=businesses&tab=food')
    expect(await screen.findByRole('button', { name: 'Food' })).toHaveClass('bg-[#087F3F]')
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
      renderAt('/tourist/explore?view=businesses')
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
      // and the municipality filter wraps to row 2 when it doesn't fit (Map is in the Explore tabs).
      expect(row.className).toContain('flex-wrap')
      expect(row.className).not.toMatch(/overflow-x-auto|chip-scroll/)
      const tabs = screen.getByTestId('explore-tabs')
      expect(tabs.className).toContain('flex-nowrap')
      expect(Array.from(row.children)).toEqual([tabs, screen.getByTestId('explore-municipality-wrap')])
      // The filter can shrink to fit row 2 (never a 3rd row).
      expect(screen.getByTestId('explore-municipality-wrap').className).toMatch(/grow basis-0 min-w-\[140px\]/)

      fireEvent.click(select)
      fireEvent.click(screen.getByRole('option', { name: 'Gloria' }))
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

      expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore?view=businesses&municipality=2')
      expect(await screen.findByText('Nothing listed in Gloria yet')).toBeInTheDocument()
      expect(api.get).toHaveBeenLastCalledWith('/tourist/explore', { params: { municipality_id: '2' } })

      fireEvent.click(screen.getByRole('button', { name: 'Show all municipalities' }))
      expect(await screen.findByText('Bansud Cafe')).toBeInTheDocument()
      expect(screen.getByTestId('location').textContent).toBe('/tourist/explore?view=businesses')
    })

    it('keeps the tab and the municipality together in the URL', async () => {
      renderAt('/tourist/explore?tab=food&municipality=2')

      expect(await screen.findByText('Nothing listed in Gloria yet')).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Municipality' })).toHaveTextContent('Gloria')
      fireEvent.click(screen.getByRole('button', { name: 'Stays' }))
      expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore?view=businesses&tab=stays&municipality=2')
    })

    it('is green: green when showing all, solid green when filtered, and the chosen option is solid green', async () => {
      renderAt('/tourist/explore?view=businesses')
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
      renderAt('/tourist/explore?view=businesses')
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
      expect(screen.getByTestId('location')).toHaveTextContent('/tourist/explore?view=businesses&municipality=2')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
  })
})
