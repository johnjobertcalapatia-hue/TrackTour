import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouristExploreMap from '@/features/tourist/pages/TouristExploreMap'
import { matchesPlaceSearch, type MapPlace } from '@/features/tourist/components/MapPlacesList'

const api = vi.hoisted(() => ({ get: vi.fn() }))
const mapClick = vi.hoisted(() => ({ handler: null as null | (() => void) }))
const setView = vi.hoisted(() => vi.fn())

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
    Marker: ({ position, icon, eventHandlers }: { position: [number, number]; icon?: { selected?: boolean }; eventHandlers?: { click?: () => void } }) =>
      eventHandlers?.click
        ? React.createElement('button', {
            type: 'button',
            'data-testid': 'map-marker',
            'data-pos': position.join(','),
            'data-selected': String(!!icon?.selected),
            onClick: eventHandlers.click,
          })
        : null,
    Polyline: Empty,
    useMap: () => ({
      invalidateSize: vi.fn(),
      getZoom: () => 12,
      setView,
      fitBounds: vi.fn(),
      getBounds: () => ({ contains: () => true }),
      panTo: vi.fn(),
      getContainer: () => document.createElement('div'),
    }),
    useMapEvents: (handlers: { click?: () => void }) => {
      mapClick.handler = handlers.click ?? null
      return undefined
    },
  }
})

vi.mock('@/shared/utils/pin-icon', () => ({
  pinIcon: (label: string, selected = false) => ({ label, selected }),
  businessLogoIcon: (_src: string, label: string, selected = false) => ({ label, selected }),
  beachPinIcon: { label: 'beach', selected: false },
  userPinIcon: {},
  profilePinIcon: () => ({}),
}))

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

const base = {
  barangay: null,
  address: null,
  logo: null,
  cover_photo: null,
  is_open: true,
  reviews_count: 0,
  reviews_avg_rating: 0,
  promotions: [],
  menu_items: [],
}
const RESTAURANT = {
  ...base,
  id: 7,
  name: 'Eksklusibo Grill and Restaurant',
  category: { id: 901, name: 'Restaurant' },
  municipality: { id: 1, name: 'Bansud' },
  address: 'Pag-asa, Bansud',
  latitude: 12.86,
  longitude: 121.46,
  cover_photo: 'businesses/eksklusibo.jpg',
  is_open: false,
}
const RESORT = {
  ...base,
  id: 8,
  name: 'Gloria Bay Resort',
  category: { id: 902, name: 'Resort' },
  municipality: { id: 2, name: 'Gloria' },
  latitude: 12.97,
  longitude: 121.47,
  reviews_count: 4,
  reviews_avg_rating: 4.5,
}
const FALLS = {
  ...base,
  id: 9,
  name: 'Tambangan Falls',
  category: { id: 903, name: 'Tourist Attraction' },
  municipality: { id: 1, name: 'Bansud' },
  latitude: 12.8,
  longitude: 121.4,
}

const MUNIS = [{ id: 3, name: 'Roxas' }, { id: 1, name: 'Bansud' }, { id: 2, name: 'Gloria' }]

function renderMap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tourist/explore/map']}>
        <TouristExploreMap />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const panel = () => screen.getByRole('complementary', { name: 'Places' })
const cards = () => within(screen.getByRole('list', { name: 'Places' })).getAllByRole('button').map((b) => b.getAttribute('aria-label'))
const markers = () => screen.queryAllByTestId('map-marker').map((m) => m.dataset.pos)

beforeEach(() => {
  sessionStorage.clear()
  setView.mockReset()
  mapClick.handler = null
  api.get.mockReset()
  api.get.mockResolvedValue({ data: { businesses: [RESTAURANT, RESORT, FALLS], categories: [], municipalities: MUNIS } })
  // No location fix: the list keeps the API order (no distances).
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { watchPosition: () => 1, clearWatch: () => {}, getCurrentPosition: () => {} },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Tourist map — places panel', () => {
  it('lists every place on the map as a card beside the map, with a search bar', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Gloria Bay Resort' })

    expect(within(panel()).getByRole('searchbox', { name: 'Search places' })).toBeInTheDocument()
    // Top rated first by default (rated places, then A–Z).
    expect(cards()).toEqual(['Gloria Bay Resort', 'Eksklusibo Grill and Restaurant', 'Tambangan Falls'])
    expect(within(panel()).getByText(/places on the map/)).toHaveTextContent('3 places on the map')

    const resort = screen.getByRole('button', { name: 'Gloria Bay Resort' })
    expect(within(resort).getByText('Resort')).toBeInTheDocument()
    expect(within(resort).getByText('Gloria')).toBeInTheDocument()
    expect(within(resort).getByText('4.5')).toBeInTheDocument()
    // Restaurants show whether they are open; the photo is the cover.
    const restaurant = screen.getByRole('button', { name: 'Eksklusibo Grill and Restaurant' })
    expect(within(restaurant).getByText('Closed')).toBeInTheDocument()
    expect(restaurant.querySelector('img')?.getAttribute('src')).toContain('businesses/eksklusibo.jpg')
    expect(within(screen.getByRole('button', { name: 'Tambangan Falls' })).getByText('No ratings yet')).toBeInTheDocument()
  })

  it('shows every business and how many municipalities they span above the search, unaffected by filters', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Gloria Bay Resort' })
    const total = screen.getByTestId('map-places-total')
    expect(total).toHaveTextContent('3 businesses across 2 municipalities')
    expect(total.compareDocumentPosition(screen.getByRole('searchbox', { name: 'Search places' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search places' }), { target: { value: 'falls' } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Category' }))
    fireEvent.click(screen.getByRole('option', { name: 'Tourist Spots' }))
    expect(cards()).toEqual(['Tambangan Falls'])
    expect(screen.getByTestId('map-places-total')).toHaveTextContent('3 businesses across 2 municipalities')
  })

  it('one business in one municipality reads in the singular', async () => {
    api.get.mockResolvedValue({ data: { businesses: [RESTAURANT], categories: [], municipalities: MUNIS } })
    renderMap()
    await screen.findByRole('button', { name: 'Eksklusibo Grill and Restaurant' })
    expect(screen.getByTestId('map-places-total')).toHaveTextContent('1 business across 1 municipality')
  })

  it('a green sort dropdown orders the cards: top rated, most reviewed, name A–Z', async () => {
    const MANY = { ...FALLS, id: 10, name: 'Aplaya Grill', category: { id: 901, name: 'Restaurant' }, reviews_count: 9, reviews_avg_rating: 3.9 }
    api.get.mockResolvedValue({ data: { businesses: [RESTAURANT, RESORT, FALLS, MANY], categories: [], municipalities: MUNIS } })
    renderMap()
    await screen.findByRole('button', { name: 'Aplaya Grill' })
    const sort = screen.getByRole('combobox', { name: 'Sort places' })
    expect(sort).toHaveTextContent('Top rated')
    expect(cards()).toEqual(['Gloria Bay Resort', 'Aplaya Grill', 'Eksklusibo Grill and Restaurant', 'Tambangan Falls'])

    fireEvent.click(sort)
    // No location yet: no "Nearest" option.
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Top rated', 'Most reviewed', 'Name A–Z'])
    expect(screen.getByRole('option', { name: 'Top rated' }).className).toContain('bg-[#087F3F]')
    fireEvent.click(screen.getByRole('option', { name: 'Most reviewed' }))
    expect(cards()).toEqual(['Aplaya Grill', 'Gloria Bay Resort', 'Eksklusibo Grill and Restaurant', 'Tambangan Falls'])

    fireEvent.click(sort)
    fireEvent.click(screen.getByRole('option', { name: 'Name A–Z' }))
    expect(cards()).toEqual(['Aplaya Grill', 'Eksklusibo Grill and Restaurant', 'Gloria Bay Resort', 'Tambangan Falls'])
    // A sort order is not a filter: the field stays white.
    expect(sort.className).toContain('border-[#E5E9E7]')

    // The order is kept after opening a place and coming back.
    fireEvent.click(screen.getByRole('button', { name: 'Tambangan Falls' }))
    fireEvent.click(screen.getByRole('button', { name: 'Back to places list' }))
    expect(screen.getByRole('combobox', { name: 'Sort places' })).toHaveTextContent('Name A–Z')
  })

  it('search filters both the cards and the markers, and can be cleared', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Gloria Bay Resort' })
    expect(markers()).toHaveLength(3)

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search places' }), { target: { value: 'bansud' } })
    expect(cards()).toEqual(['Eksklusibo Grill and Restaurant', 'Tambangan Falls'])
    expect(markers()).toEqual(['12.86,121.46', '12.8,121.4'])
    expect(within(panel()).getByText(/matching/)).toHaveTextContent('2 places matching “bansud”')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search places' }), { target: { value: 'zzz' } })
    expect(screen.getByText('No places match “zzz”.')).toBeInTheDocument()
    expect(markers()).toHaveLength(0)

    fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' })[0]!)
    expect(cards()).toHaveLength(3)
    expect(markers()).toHaveLength(3)
  })

  it('has a search box with Category and Municipality dropdowns side by side under it', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Gloria Bay Resort' })

    const input = within(panel()).getByRole('searchbox', { name: 'Search places' })
    expect(input).toHaveAttribute('placeholder', 'Search places, categories...')
    // A plain rounded box (overrides the global input rule).
    expect(input.className).toMatch(/(^| )rounded-xl!( |$)/)

    const row = screen.getByTestId('map-places-filters')
    expect(row.className).toContain('grid-cols-2')
    const [category, municipality] = within(row).getAllByRole('combobox')
    expect(category).toHaveAccessibleName('Category')
    expect(category).toHaveTextContent('All Categories')
    expect(municipality).toHaveAccessibleName('Municipality')
    expect(municipality).toHaveTextContent('All Municipalities')
    expect(input.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // White fields with a grey border until something is chosen.
    expect(municipality!.className).toContain('rounded-xl')
    expect(municipality!.className).toContain('bg-white')
    expect(municipality!.className).toContain('border-[#E5E9E7]')
  })

  it('the municipality dropdown filters the cards and the markers, together with the search', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Gloria Bay Resort' })
    const filter = screen.getByRole('combobox', { name: 'Municipality' })

    fireEvent.click(filter)
    // A–Z; the right-hand dropdown opens leftwards so it stays in the panel.
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All Municipalities', 'Bansud', 'Gloria', 'Roxas'])
    expect(screen.getByRole('listbox', { name: 'Municipality' }).className).toContain('right-0')
    fireEvent.click(screen.getByRole('option', { name: 'Bansud' }))

    expect(filter).toHaveTextContent('Bansud')
    expect(filter.className).toContain('border-[#087F3F]')
    expect(cards()).toEqual(['Eksklusibo Grill and Restaurant', 'Tambangan Falls'])
    expect(markers()).toEqual(['12.86,121.46', '12.8,121.4'])
    expect(within(panel()).getByText(/in Bansud/)).toHaveTextContent('2 places in Bansud')

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search places' }), { target: { value: 'falls' } })
    expect(cards()).toEqual(['Tambangan Falls'])
    expect(within(panel()).getByText(/matching/)).toHaveTextContent('1 place matching “falls” in Bansud')
  })

  it('the Category dropdown is the only category filter (no chip row) and drives List view', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Gloria Bay Resort' })
    expect(screen.queryByTestId('map-category-chips')).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Map categories' })).not.toBeInTheDocument()
    const category = screen.getByRole('combobox', { name: 'Category' })

    fireEvent.click(category)
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['All Categories', 'Tourist Spots', 'Food', 'Resorts', 'Other'])
    fireEvent.click(screen.getByRole('option', { name: 'Food' }))
    expect(category).toHaveTextContent('Food')
    expect(cards()).toEqual(['Eksklusibo Grill and Restaurant'])
    expect(screen.getByRole('link', { name: 'List view' })).toHaveAttribute('href', '/tourist/explore?tab=food')

    fireEvent.click(category)
    fireEvent.click(screen.getByRole('option', { name: 'Resorts' }))
    expect(cards()).toEqual(['Gloria Bay Resort'])

    fireEvent.click(category)
    fireEvent.click(screen.getByRole('option', { name: 'All Categories' }))
    expect(cards()).toHaveLength(3)
    expect(screen.getByRole('link', { name: 'List view' })).toHaveAttribute('href', '/tourist/explore')
  })

  it('a municipality with nothing listed offers to show all places again', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Gloria Bay Resort' })
    fireEvent.click(screen.getByRole('combobox', { name: 'Municipality' }))
    fireEvent.click(screen.getByRole('option', { name: 'Roxas' }))

    expect(screen.getByText('Nothing listed in Roxas yet.')).toBeInTheDocument()
    expect(markers()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Show all places' }))
    expect(cards()).toHaveLength(3)
    expect(screen.getByRole('combobox', { name: 'Municipality' })).toHaveTextContent('All Municipalities')
  })

  it('clicking a card turns the panel into that place’s details and moves the map to it', async () => {
    renderMap()
    fireEvent.click(await screen.findByRole('button', { name: 'Eksklusibo Grill and Restaurant' }))

    const details = screen.getByRole('complementary', { name: 'Place details' })
    expect(within(details).getByRole('heading', { name: 'Eksklusibo Grill and Restaurant' })).toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Menu' })).toBeInTheDocument()
    expect(within(details).getByText('Closed')).toBeInTheDocument()
    // Same panel: the list and its search are gone while the details show.
    expect(screen.queryByRole('complementary', { name: 'Places' })).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: 'Search places' })).not.toBeInTheDocument()
    expect(setView).toHaveBeenCalledWith([12.86, 121.46], 15)
  })

  it('"Back to places list" returns to the list with the search kept', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Gloria Bay Resort' })
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search places' }), { target: { value: 'gloria' } })
    fireEvent.click(screen.getByRole('button', { name: 'Gloria Bay Resort' }))
    expect(screen.getByRole('heading', { name: 'Gloria Bay Resort' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to places list' }))

    expect(screen.getByRole('searchbox', { name: 'Search places' })).toHaveValue('gloria')
    expect(cards()).toEqual(['Gloria Bay Resort'])
    expect(screen.queryByRole('heading', { name: 'Gloria Bay Resort' })).not.toBeInTheDocument()
  })

  it('a marker opens the details in the same panel; closing or tapping the map goes back to the list', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Gloria Bay Resort' })

    fireEvent.click(screen.getAllByTestId('map-marker')[2]!)
    expect(screen.getByRole('heading', { name: 'Tambangan Falls' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(cards()).toHaveLength(3)

    fireEvent.click(screen.getAllByTestId('map-marker')[0]!)
    expect(screen.getByRole('heading', { name: 'Eksklusibo Grill and Restaurant' })).toBeInTheDocument()
    act(() => mapClick.handler?.())
    expect(cards()).toHaveLength(3)
  })

  it('phones: the list is a bottom sheet that starts minimised and opens from its handle', async () => {
    renderMap()
    await screen.findByRole('button', { name: 'Gloria Bay Resort' })

    const handle = screen.getByRole('button', { name: 'Show places list' })
    expect(handle).toHaveAttribute('aria-expanded', 'false')
    expect(handle).toHaveTextContent('Explore 3 places')
    expect(panel().className).toContain('max-h-[72px]')

    fireEvent.click(handle)
    expect(screen.getByRole('button', { name: 'Minimize places list' })).toHaveAttribute('aria-expanded', 'true')
    expect(panel().className).toContain('max-h-[62dvh]')
    // Desktop ignores the phone sheet height: always the full-height side panel.
    expect(panel().className).toContain('sm:max-h-full')
    expect(panel().className).toContain('sm:w-[405px]')

    // Tapping the map minimises it again.
    act(() => mapClick.handler?.())
    expect(screen.getByRole('button', { name: 'Show places list' })).toBeInTheDocument()
  })

  it('hovering a card highlights its marker', async () => {
    renderMap()
    const card = await screen.findByRole('button', { name: 'Gloria Bay Resort' })
    const selected = () => screen.getAllByTestId('map-marker').map((m) => m.dataset.selected)
    expect(selected()).toEqual(['false', 'false', 'false'])
    fireEvent.mouseEnter(card)
    expect(selected()).toEqual(['false', 'true', 'false'])
    fireEvent.mouseLeave(card)
    expect(selected()).toEqual(['false', 'false', 'false'])
  })
})

describe('matchesPlaceSearch', () => {
  const place = { ...RESORT, barangay: { id: 3, name: 'Kawit' }, address: 'Sitio Uno' } as MapPlace
  it('matches name, category, municipality, barangay and address, every word, any case', () => {
    expect(matchesPlaceSearch(place, '')).toBe(true)
    expect(matchesPlaceSearch(place, 'BAY')).toBe(true)
    expect(matchesPlaceSearch(place, 'resort gloria')).toBe(true)
    expect(matchesPlaceSearch(place, 'kawit')).toBe(true)
    expect(matchesPlaceSearch(place, 'sitio')).toBe(true)
    expect(matchesPlaceSearch(place, 'resort bansud')).toBe(false)
  })
  it('accepts a municipality sent as a plain name', () => {
    expect(matchesPlaceSearch({ ...place, municipality: 'Roxas' as unknown as MapPlace['municipality'] }, 'roxas')).toBe(true)
  })
})
