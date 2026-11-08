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
})
