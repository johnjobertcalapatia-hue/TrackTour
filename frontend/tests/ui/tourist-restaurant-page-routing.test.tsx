import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristExploreShow from '@/features/tourist/pages/TouristExploreShow'
import TouristFoodShow from '@/features/tourist/pages/TouristFoodShow'
import TouristHome from '@/features/tourist/pages/TouristHome'
import { getBrowsedPlaces } from '@/shared/services/browsing-history'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  default: { get: api.get },
}))

vi.mock('@/features/auth/services/auth-store', () => {
  const state = { user: { role: 'tourist', name: 'Test Tourist' }, token: 't', logout: () => {} }
  return { useAuthStore: (selector?: (v: typeof state) => unknown) => (selector ? selector(state) : state) }
})

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement('div', null, children)
  return { MapContainer: Pass, TileLayer: () => null, Marker: () => null, Popup: Pass, useMap: () => ({}) }
})

vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})), marker: vi.fn(), latLngBounds: vi.fn() } }))

function business(id: number, name: string, category: string) {
  return {
    id,
    name,
    business_name: name,
    description: '',
    category: { id: 1, name: category },
    municipality: { id: 1, name: 'Bansud' },
    barangay: null,
    address: 'Poblacion',
    logo: null,
    cover_photo: null,
    rating: null,
    is_open: true,
    is_accepting_orders: true,
    availability: 'open',
    open_status: { status: 'open', label: 'Open now' },
    schedule_summary: '',
    opening_time: null,
    closing_time: null,
    is_favorited: false,
    menu_items: [],
    reviews: [],
    category_details: {},
    status: 'approved',
  }
}

const payloads: Record<string, unknown> = {
  '/tourist/explore/7': { business: business(7, 'Eksklusibo Grill', 'Restaurant'), reviews: [], menu_items: [], gallery: [], promotions: [] },
  '/tourist/explore/9': { business: business(9, 'Bansud Bay Resort', 'Beach Resort'), reviews: [], menu_items: [], gallery: [], promotions: [] },
}

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tourist/dashboard" element={<TouristHome />} />
          <Route path="/tourist/explore/:id" element={<TouristExploreShow />} />
          <Route path="/tourist/food/:id" element={<TouristFoodShow />} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  api.get.mockReset()
  api.get.mockImplementation((url: string) =>
    url in payloads ? Promise.resolve(payloads[url]) : Promise.resolve({ data: [], items: [], places: [], food: [], stays: [] }),
  )
})

describe('one restaurant page everywhere', () => {
  it('forwards a restaurant opened via /tourist/explore/:id to the restaurant page', async () => {
    renderAt('/tourist/explore/7')

    expect(await screen.findByRole('heading', { level: 1, name: 'Eksklusibo Grill' })).toBeInTheDocument()
    expect(screen.getByTestId('path')).toHaveTextContent('/tourist/food/7')
    expect(screen.getByRole('heading', { name: 'Restaurant Info' })).toBeInTheDocument()
  })

  it('keeps non-dining places (resorts) on the place page', async () => {
    renderAt('/tourist/explore/9')

    expect(await screen.findByText('Bansud Bay Resort')).toBeInTheDocument()
    expect(screen.getByTestId('path')).toHaveTextContent('/tourist/explore/9')
  })

  it('records the restaurant in Recently Viewed with the restaurant page link', async () => {
    renderAt('/tourist/explore/7')
    await screen.findByRole('heading', { level: 1, name: 'Eksklusibo Grill' })

    const [recent] = getBrowsedPlaces()
    expect(recent).toMatchObject({ id: 7, discoveryGroup: 'dining', url: '/tourist/food/7' })
    expect(getBrowsedPlaces()).toHaveLength(1)
  })

  it('Home Recently Viewed links restaurants (even old saved entries) to the restaurant page', async () => {
    localStorage.setItem('tracktour_browsing_history', JSON.stringify([
      { id: 7, name: 'Eksklusibo Grill', category: 'Restaurant', discoveryGroup: 'dining', cover_photo: null, logo: null, municipality: 'Bansud', rating: null, url: '/tourist/explore/7', viewed_at: 1 },
      { id: 9, name: 'Bansud Bay Resort', category: 'Beach Resort', discoveryGroup: 'accommodation', cover_photo: null, logo: null, municipality: 'Bansud', rating: null, url: '/tourist/explore/9', viewed_at: 0 },
    ]))
    renderAt('/tourist/dashboard')

    expect((await screen.findByText('Eksklusibo Grill')).closest('a')).toHaveAttribute('href', '/tourist/food/7')
    expect(screen.getByText('Bansud Bay Resort').closest('a')).toHaveAttribute('href', '/tourist/explore/9')
  })

  it('Home Recently Viewed: a dish opens the DISH page, not a restaurant with the same number', async () => {
    // Reported 2026-11-09: "Pork/Chicken Sisig" (dish 7) opened "restaurant 7".
    localStorage.setItem('tracktour_browsing_history', JSON.stringify([
      { id: 7, name: 'Pork/Chicken Sisig', category: 'Food', discoveryGroup: 'dining', kind: 'food', cover_photo: null, logo: null, municipality: 'Ekslusibo Grill', rating: null, url: '/tourist/food/item/7', viewed_at: 3 },
      // Saved before entries had a kind: the dish url still tells.
      { id: 8, name: 'Halo-Halo', category: 'Food', discoveryGroup: 'dining', cover_photo: null, logo: null, municipality: 'Ekslusibo Grill', rating: null, url: '/tourist/food/item/8', viewed_at: 2 },
      { id: 2, name: 'Ekslusibo Grill', category: 'Restaurant', discoveryGroup: 'dining', kind: 'place', cover_photo: null, logo: null, municipality: 'Bansud', rating: null, url: '/tourist/food/2', viewed_at: 1 },
    ]))
    renderAt('/tourist/dashboard')

    const sisig = (await screen.findByText('Pork/Chicken Sisig')).closest('a') as HTMLElement
    expect(sisig).toHaveAttribute('href', '/tourist/food/item/7')
    expect(sisig).toHaveTextContent('Food')
    expect(screen.getByText('Halo-Halo').closest('a')).toHaveAttribute('href', '/tourist/food/item/8')
    const grill = screen.getByText('Ekslusibo Grill', { selector: 'h3' }).closest('a') as HTMLElement
    expect(grill).toHaveAttribute('href', '/tourist/food/2')
    expect(grill).toHaveTextContent('Dining')
  })

  describe('a place that no longer exists (404, e.g. after a database reset)', () => {
    const notFound = () => Promise.reject(Object.assign(new Error('Not Found'), { response: { status: 404 } }))
    const saved = (id: number, name: string, group: string) => ({
      id, name, category: group === 'dining' ? 'Restaurant' : 'Beach Resort', discoveryGroup: group,
      cover_photo: null, logo: null, municipality: 'Bansud', rating: null, url: `/tourist/explore/${id}`, viewed_at: 1,
    })

    it('restaurant page: says it is gone, offers Browse food, and drops it from Recently Viewed', async () => {
      localStorage.setItem('tracktour_browsing_history', JSON.stringify([saved(70, 'Gone Grill', 'dining'), saved(9, 'Bansud Bay Resort', 'accommodation')]))
      api.get.mockImplementation((url: string) => (url === '/tourist/explore/70' ? notFound() : Promise.resolve(payloads[url] ?? {})))
      renderAt('/tourist/food/70')

      expect(await screen.findByRole('heading', { name: "This restaurant isn't on TrackTour anymore" })).toBeInTheDocument()
      // Closed is not gone: the message says a closed restaurant still opens.
      expect(screen.getByText(/only closed still opens: you can view its menu, just not order/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Browse food' })).toHaveAttribute('href', '/tourist/food')
      expect(getBrowsedPlaces().map((p) => p.id)).toEqual([9])
    })

    it('place page: same, with Explore places', async () => {
      localStorage.setItem('tracktour_browsing_history', JSON.stringify([saved(71, 'Gone Resort', 'accommodation')]))
      api.get.mockImplementation((url: string) => (url === '/tourist/explore/71' ? notFound() : Promise.resolve(payloads[url] ?? {})))
      renderAt('/tourist/explore/71')

      expect(await screen.findByRole('heading', { name: "This place isn't on TrackTour anymore" })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Explore places' })).toHaveAttribute('href', '/tourist/explore')
      expect(getBrowsedPlaces()).toEqual([])
    })

    it('any other failure keeps the place in history and asks to try again', async () => {
      localStorage.setItem('tracktour_browsing_history', JSON.stringify([saved(72, 'Busy Grill', 'dining')]))
      api.get.mockImplementation((url: string) => (url === '/tourist/explore/72'
        ? Promise.reject(Object.assign(new Error('Server Error'), { response: { status: 500 } }))
        : Promise.resolve(payloads[url] ?? {})))
      renderAt('/tourist/food/72')

      expect(await screen.findByText("Couldn't load this restaurant. Please try again.")).toBeInTheDocument()
      expect(getBrowsedPlaces().map((p) => p.id)).toEqual([72])
    })
  })
})
