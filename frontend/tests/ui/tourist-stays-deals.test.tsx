import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristStays from '@/features/tourist/pages/TouristStays'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: vi.fn() }))
vi.mock('@/features/auth/services/auth-store', () => {
  const state = { user: { role: 'tourist', name: 'Test Tourist' } }
  return { useAuthStore: (selector?: (v: typeof state) => unknown) => (selector ? selector(state) : state) }
})

const STAYS = [
  { id: 9, name: 'Bansud Bay Resort', cover_photo: null, logo: null, category: 'Resort', municipality: 'Bansud', address: null, price_range: '₱1,500 – ₱4,000', rating: 4.5, reviews_count: 12, accepts_reservation: true, is_open: true },
  { id: 10, name: 'Hilltop Homestay', cover_photo: null, logo: null, category: 'Homestay', municipality: 'Bansud', address: null, price_range: null, rating: null, reviews_count: 0, accepts_reservation: false, is_open: true },
]
const PROMOS = [
  { id: 1, name: 'Weekend Stay 20% Off', description: 'Fri–Sun nights', type: 'percentage', value: 20, min_order: null, code: 'STAY20', end_date: '2026-11-30T00:00:00+08:00', business: { id: 9, name: 'Bansud Bay Resort', cover_photo: null, category: 'Resort', municipality: 'Bansud', kind: 'stay' } },
  { id: 2, name: 'Guided Trek Discount', description: null, type: 'fixed', value: 100, min_order: null, code: null, end_date: null, business: { id: 30, name: 'Tigbao Falls', cover_photo: null, category: 'Tourist Attraction', municipality: 'Bansud', kind: 'attraction' } },
]

function payload(over: Record<string, unknown> = {}) {
  return { accommodations: STAYS, types: ['Homestay', 'Resort'], promotions: PROMOS, meta: { current_page: 1, last_page: 1, total: 2 }, ...over }
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TouristStays /></MemoryRouter>
    </QueryClientProvider>,
  )
}

const lastParams = () => (api.get.mock.calls.at(-1)?.[1] as { params: Record<string, unknown> }).params

beforeEach(() => {
  sessionStorage.clear()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: undefined })
  api.get.mockReset()
  api.get.mockResolvedValue(payload())
})

/** Tourist located in Gloria (municipality 4); `stays` answers /tourist/stays by scope. */
function locateInGloria(stays: (params: Record<string, unknown>) => unknown) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.97, longitude: 121.47 } } as GeolocationPosition) },
  })
  api.get.mockImplementation((url: string, cfg?: { params?: Record<string, unknown> }) => {
    if (url === '/municipalities/locate') return Promise.resolve({ id: 4, name: 'Gloria', province: 'Oriental Mindoro' })
    return Promise.resolve(stays(cfg?.params ?? {}))
  })
}

describe('Tourist Stays & Deals page', () => {
  it('uses the browse endpoint and drops the non-functional date inputs', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Stays & Deals' })).toBeInTheDocument()
    expect(api.get.mock.calls[0]?.[0]).toBe('/tourist/stays')
    expect(screen.queryByText('Check-in')).not.toBeInTheDocument()
    expect(screen.queryByText('Check-out')).not.toBeInTheDocument()
  })

  it('lists promotions from resorts and attractions with badge, code and validity', async () => {
    renderPage()

    const deals = within((await screen.findByRole('heading', { name: 'Deals & Promotions' })).closest('section')!)
    const resortDeal = deals.getByRole('link', { name: 'Weekend Stay 20% Off at Bansud Bay Resort' })
    expect(resortDeal).toHaveAttribute('href', '/tourist/explore/9')
    expect(within(resortDeal).getByText('20% OFF')).toBeInTheDocument()
    expect(within(resortDeal).getByText('STAY20')).toBeInTheDocument()
    expect(within(resortDeal).getByText(/Valid until Nov 30, 2026/)).toBeInTheDocument()

    const trekDeal = deals.getByRole('link', { name: 'Guided Trek Discount at Tigbao Falls' })
    expect(within(trekDeal).getByText('₱100 OFF')).toBeInTheDocument()
    expect(within(trekDeal).getByText('Attraction')).toBeInTheDocument()
  })

  it('hides the deals section when there are no active promotions', async () => {
    api.get.mockResolvedValue(payload({ promotions: [] }))
    renderPage()

    await screen.findByText('Bansud Bay Resort')
    expect(screen.queryByRole('heading', { name: 'Deals & Promotions' })).not.toBeInTheDocument()
  })

  it('stay cards show bookability, real ratings only and link to the place page', async () => {
    renderPage()

    const resort = (await screen.findByText('Bansud Bay Resort', { selector: 'h3' })).closest('a')!
    expect(resort).toHaveAttribute('href', '/tourist/explore/9')
    expect(within(resort).getByText('Book online')).toBeInTheDocument()
    expect(within(resort).getByText('4.5')).toBeInTheDocument()
    expect(within(resort).getByText('₱1,500 – ₱4,000')).toBeInTheDocument()

    const homestay = screen.getByText('Hilltop Homestay', { selector: 'h3' }).closest('a')!
    expect(within(homestay).queryByText('Book online')).not.toBeInTheDocument()
    expect(within(homestay).getByText('New')).toBeInTheDocument()
    expect(within(homestay).queryByText('0.0')).not.toBeInTheDocument()
  })

  it('type chips, search and sort reach the API', async () => {
    renderPage()
    const chips = within(await screen.findByRole('navigation', { name: 'Stay types' }))
    expect(chips.getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Homestay', 'Resort'])

    fireEvent.click(chips.getByRole('button', { name: 'Resort' }))
    await waitFor(() => expect(lastParams()).toMatchObject({ type: 'Resort' }))

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort stays' }), { target: { value: 'rating' } })
    await waitFor(() => expect(lastParams()).toMatchObject({ sort: 'rating' }))

    fireEvent.change(screen.getByPlaceholderText('Search resorts, hotels, towns...'), { target: { value: 'bay' } })
    await waitFor(() => expect(lastParams()).toMatchObject({ search: 'bay' }), { timeout: 2000 })
  })

  it('honest empty state when nothing is listed yet', async () => {
    api.get.mockResolvedValue(payload({ accommodations: [], types: [], promotions: [], meta: { current_page: 1, last_page: 1, total: 0 } }))
    renderPage()

    expect(await screen.findByText('No stays listed yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explore Bansud' })).toHaveAttribute('href', '/tourist/explore')
  })

  describe('follows the municipality the tourist is in', () => {
    it('lists the stays in that municipality and names it in the subtitle', async () => {
      locateInGloria((p) => (p.municipality_id === 4
        ? payload({ accommodations: [{ ...STAYS[0], id: 41, name: 'Gloria Beach Resort', municipality: 'Gloria' }], meta: { current_page: 1, last_page: 1, total: 1 } })
        : payload()))
      renderPage()

      expect(await screen.findByText('Gloria Beach Resort')).toBeInTheDocument()
      expect(screen.getByTestId('stays-where')).toHaveTextContent('Gloria')
      expect(screen.queryByText('Bansud Bay Resort', { selector: 'h3' })).not.toBeInTheDocument()
    })

    it('falls back to every municipality (subtitle names the province) when the town has none', async () => {
      locateInGloria((p) => (p.municipality_id === 4 ? payload({ accommodations: [], meta: { current_page: 1, last_page: 1, total: 0 } }) : payload()))
      renderPage()

      await waitFor(() => expect(api.get).toHaveBeenCalledWith('/tourist/stays', expect.objectContaining({ params: expect.objectContaining({ municipality_id: 4 }) })))
      expect(await screen.findByText('Bansud Bay Resort', { selector: 'h3' })).toBeInTheDocument()
      expect(screen.getByTestId('stays-where')).toHaveTextContent('Oriental Mindoro')
    })

    it('empty state: "Explore <municipality>" opens that municipality', async () => {
      locateInGloria(() => payload({ accommodations: [], promotions: [], meta: { current_page: 1, last_page: 1, total: 0 } }))
      renderPage()

      const btn = await screen.findByRole('link', { name: 'Explore Gloria' })
      expect(btn).toHaveAttribute('href', '/tourist/municipality/4')
      expect(screen.queryByRole('link', { name: 'Explore Bansud' })).not.toBeInTheDocument()
    })

    it('without a location: "Explore Bansud" to the Explore page, subtitle names the province', async () => {
      api.get.mockResolvedValue(payload({ accommodations: [], promotions: [], meta: { current_page: 1, last_page: 1, total: 0 } }))
      renderPage()

      expect(await screen.findByRole('link', { name: 'Explore Bansud' })).toHaveAttribute('href', '/tourist/explore')
      expect(screen.getByTestId('stays-where')).toHaveTextContent('Oriental Mindoro')
    })
  })

  describe('Stage 2: resort cards and filters', () => {
    const FILTERS = {
      resort_types: [
        { slug: 'pool', name: 'Pool Resort', count: 2 }, { slug: 'nature', name: 'Nature Resort', count: 1 },
        { slug: 'beach', name: 'Beach Resort', count: 1 }, { slug: 'riverside', name: 'Riverside Resort', count: 0 },
        { slug: 'adventure', name: 'Adventure Resort', count: 0 }, { slug: 'farm', name: 'Farm Resort', count: 0 },
        { slug: 'other', name: 'Other Resort', count: 0 },
      ],
      facilities: [{ slug: 'swimming_pool', name: 'Swimming pool', count: 2 }, { slug: 'cottages', name: 'Cottages', count: 2 }],
      custom_facilities: [{ name: 'Videoke room', count: 1 }],
      municipalities: [{ id: 1, name: 'Bansud', count: 2 }, { id: 4, name: 'Gloria', count: 1 }],
      rating_available: false,
    }
    const RESORT = {
      ...STAYS[0], id: 41, name: 'Forest Haven', municipality: null, address: 'Sitio Bato, Gloria', price_range: null,
      resort_types: [{ slug: 'pool', name: 'Pool Resort' }, { slug: 'nature', name: 'Nature Resort' }, { slug: 'farm', name: 'Farm Resort' }],
      facilities: [{ slug: 'swimming_pool', name: 'Swimming pool' }, { slug: 'gardens', name: 'Gardens' }, { slug: 'camping_area', name: 'Camping area' }, { slug: null, name: 'Videoke room' }],
      cottage_count: null, starting_price: null,
    }
    const params = () => (api.get.mock.calls.at(-1)?.[1] as { params: Record<string, unknown> }).params

    beforeEach(() => {
      api.get.mockResolvedValue(payload({ accommodations: [RESORT, STAYS[1]], filters: FILTERS }))
    })

    it('resort type chips list all types with counts and filter the list (multi-select)', async () => {
      renderPage()
      const group = within(await screen.findByRole('group', { name: 'Resort type' }))
      const chips = group.getAllByRole('button').filter((b) => b.hasAttribute('aria-pressed'))
      expect(chips.map((c) => c.textContent)).toEqual(['Pool2', 'Nature1', 'Beach1', 'Riverside0', 'Adventure0', 'Farm0', 'Other0'])
      expect(group.getByRole('button', { name: /Farm/ })).toBeDisabled()

      fireEvent.click(group.getByRole('button', { name: /Pool/ }))
      await waitFor(() => expect(params().resort_types).toEqual(['pool']))
      fireEvent.click(group.getByRole('button', { name: /Nature/ }))
      await waitFor(() => expect(params().resort_types).toEqual(['pool', 'nature']))
      expect(within(screen.getByRole('list', { name: 'Active filters' })).getAllByRole('button').map((b) => b.textContent?.trim())).toEqual(['Pool Resort', 'Nature Resort'])

      fireEvent.click(screen.getByRole('button', { name: 'Remove filter Pool Resort' }))
      await waitFor(() => expect(params().resort_types).toEqual(['nature']))
    })

    it('Filters panel: facilities (incl. owner-created), location, and rating only when ratings exist', async () => {
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /^Filters/ }))
      const panel = within(document.getElementById('stay-filters-panel')!)

      fireEvent.click(panel.getByLabelText(/Swimming pool/))
      await waitFor(() => expect(params().facilities).toEqual(['swimming_pool']))
      fireEvent.click(panel.getByLabelText(/Videoke room/))
      await waitFor(() => expect(params().custom_facilities).toEqual(['Videoke room']))

      fireEvent.change(panel.getByLabelText('Location'), { target: { value: '4' } })
      await waitFor(() => expect(params().municipality_id).toBe(4))
      expect(screen.getByTestId('stays-where')).toHaveTextContent('Gloria')
      expect(panel.queryByLabelText('Rating')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Filters \(3\)/ })).toBeInTheDocument()

      fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!)
      // Back to the unfiltered list (served from cache): no active filters left.
      expect(screen.queryByRole('list', { name: 'Active filters' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument()
      expect(screen.getByTestId('stays-where')).toHaveTextContent('Oriental Mindoro')
    })

    it('rating filter appears once real ratings exist', async () => {
      api.get.mockResolvedValue(payload({ accommodations: [RESORT], filters: { ...FILTERS, rating_available: true } }))
      renderPage()
      fireEvent.click(await screen.findByRole('button', { name: /^Filters/ }))
      fireEvent.change(screen.getByLabelText('Rating'), { target: { value: '4' } })
      await waitFor(() => expect(params().min_rating).toBe('4'))
    })

    it('cards show real resort types and facilities, and never invent a location, cottages or price', async () => {
      renderPage()
      const card = (await screen.findByText('Forest Haven', { selector: 'h3' })).closest('a')!
      expect(within(within(card).getByRole('list', { name: 'Resort types' })).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Pool Resort', 'Nature Resort', '+1'])
      expect(within(card).getByLabelText('Facilities: Swimming pool, Gardens, Camping area, Videoke room')).toHaveTextContent('Swimming pool · Gardens · Camping area · +1 more')
      expect(within(card).getByText('Sitio Bato, Gloria')).toBeInTheDocument() // address, not an invented "Bansud"
      expect(within(card).queryByText(/cottage/)).not.toBeInTheDocument()
      expect(within(card).queryByText(/From ₱/)).not.toBeInTheDocument()
    })

    it('shows cottage count and starting price only when real data is provided', async () => {
      api.get.mockResolvedValue(payload({ accommodations: [{ ...RESORT, cottage_count: 6, starting_price: 350 }], filters: FILTERS }))
      renderPage()
      const card = (await screen.findByText('Forest Haven', { selector: 'h3' })).closest('a')!
      expect(within(card).getByText('6 cottages')).toBeInTheDocument()
      expect(within(card).getByText('From ₱350.00')).toBeInTheDocument()
    })
  })

  it('Stage 4: the starting price shows its unit from published offerings', async () => {
    api.get.mockResolvedValue(payload({ accommodations: [{ ...STAYS[0], starting_price: 150, starting_price_basis: 'per_person', price_range: null }] }))
    renderPage()
    const card = (await screen.findByText('Bansud Bay Resort', { selector: 'h3' })).closest('a')!
    expect(within(card).getByText(/^From/)).toHaveTextContent('From ₱150.00 / person')
  })
})
