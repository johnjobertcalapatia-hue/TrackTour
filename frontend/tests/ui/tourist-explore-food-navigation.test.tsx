import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LandingPage from '@/pages/LandingPage'
import TouristExplore from '@/features/tourist/pages/TouristExplore'
import TouristExploreMap from '@/features/tourist/pages/TouristExploreMap'
import TouristFoodShow from '@/features/tourist/pages/TouristFoodShow'
import TouristHome from '@/features/tourist/pages/TouristHome'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

const markers = vi.hoisted(() => [] as HTMLButtonElement[])

const map = {
  invalidateSize: vi.fn(),
  getZoom: vi.fn(() => 11),
  getBounds: vi.fn(() => ({ contains: () => true })),
  panTo: vi.fn(),
  getContainer: vi.fn(() => document.createElement('div')),
}

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  default: { get: api.get },
}))

vi.mock('@/features/auth/services/auth-store', () => {
  const state = {
    user: { role: 'tourist', name: 'Test Tourist' },
    token: 'test-token',
  }
  return {
    useAuthStore: (selector?: (value: typeof state) => unknown) => selector ? selector(state) : state,
  }
})

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    TileLayer: Empty,
    Marker: ({ eventHandlers }: { eventHandlers?: { click?: () => void } }) => eventHandlers?.click
      ? React.createElement('button', { type: 'button', 'aria-label': 'Select map business', onClick: eventHandlers.click })
      : null,
    Polyline: Empty,
    useMap: () => map,
    useMapEvents: () => undefined,
  }
})

vi.mock('leaflet', () => ({
  default: {
    marker: () => {
      const element = document.createElement('button')
      element.setAttribute('aria-label', 'Select Bansud Cafe')
      markers.push(element)
      const marker = {
        addTo: () => {
          document.body.append(element)
          return marker
        },
        getElement: () => element,
        setZIndexOffset: vi.fn(),
        setLatLng: vi.fn(),
        setIcon: vi.fn(),
        remove: () => element.remove(),
      }
      return marker
    },
    divIcon: vi.fn(() => ({})),
    latLngBounds: vi.fn(() => ({})),
  },
}))

function CurrentPath() {
  const { pathname } = useLocation()
  return <output data-testid="current-path">{pathname}</output>
}

function renderPage(page: 'home' | 'explore' | 'map') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[
        page === 'home' ? '/' : page === 'map' ? '/tourist/explore/map' : '/tourist/explore?tab=food',
      ]}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/tourist/dashboard" element={<TouristHome />} />
          <Route path="/tourist/explore" element={<TouristExplore />} />
          <Route path="/tourist/explore/map" element={<TouristExploreMap />} />
          <Route path="/tourist/food/item/:id" element={<div>Food item details</div>} />
          <Route path="/tourist/food/cart" element={<div>Food cart</div>} />
          <Route path="/tourist/food/:id" element={<TouristFoodShow />} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  markers.splice(0)
  api.get.mockImplementation((url: string) => {
    if (url === '/map/businesses') {
      return Promise.resolve([{
        id: 7,
        name: 'Bansud Cafe',
        latitude: 12.5,
        longitude: 121.3,
        municipality: 'Bansud',
        category: 'Restaurant',
        menu_items: [{
          id: 501,
          name: 'Chicken BBQ',
          description: 'Grilled chicken served with rice.',
          price: 180,
          image: null,
        }],
      }])
    }

    if (url === '/tourist/explore') {
      return Promise.resolve({
        places: [],
        food: [{
          id: 7,
          name: 'Bansud Cafe',
          cover_photo: null,
          rating: null,
          municipality: 'Bansud',
          type: 'food',
        }],
        stays: [],
      })
    }

    if (url === '/tourist/explore/map') {
      return Promise.resolve({
        data: {
          businesses: [{
            id: 7,
            name: 'Bansud Cafe',
            category: { id: 1, name: 'Restaurant' },
            municipality: { id: 1, name: 'Bansud' },
            barangay: null,
            address: 'Bansud, Oriental Mindoro',
            latitude: 12.5,
            longitude: 121.3,
            logo: null,
            cover_photo: null,
            is_open: true,
            is_accepting_orders: true,
            reviews_count: 0,
            reviews_avg_rating: null,
            promotions: [],
            menu_items: [{
              id: 501,
              name: 'Chicken BBQ',
              description: 'Grilled chicken served with rice.',
              price: 180,
              image: 'offerings/chicken-bbq.jpg',
              bestseller: true,
              category: 'Filipino',
            }],
          }],
          municipalities: [],
          categories: [],
        },
      })
    }

    if (url === '/tourist/food') {
      return Promise.resolve({
        data: [{
          id: 501,
          name: 'Chicken BBQ',
          description: 'Grilled chicken served with rice.',
          category: 'Filipino',
          image: null,
          price: 180,
          business_name: 'Bansud Cafe',
          business_id: 7,
          rating: null,
        }],
      })
    }

    if (url === '/tourist/explore/7') {
      return Promise.resolve({
        business: {
          id: 7,
          name: 'Bansud Cafe',
          description: 'Local restaurant',
          category: { id: 1, name: 'Restaurant' },
          municipality: { id: 1, name: 'Bansud' },
          address: 'Bansud, Oriental Mindoro',
          logo: null,
          cover_photo: null,
          rating: null,
          is_open: true,
          is_accepting_orders: true,
          availability: 'open',
          open_status: { status: 'open', label: 'Open now' },
          schedule_summary: 'Hours not set',
          opening_time: null,
          closing_time: null,
          is_favorited: false,
          menu_items: [{
            id: 501,
            name: 'Chicken BBQ',
            image: null,
            price: 180,
            is_available: true,
            category: 'Filipino',
            description: 'Grilled chicken served with rice.',
          }],
          reviews: [],
        },
      })
    }

    if (url === '/tourist/destinations') return Promise.resolve({ data: [] })
    if (url === '/tourist/for-you') return Promise.resolve({ items: [] })
    if (url === '/tourist/events') return Promise.resolve({ data: [] })
    if (url === '/municipalities') return Promise.resolve([])
    if (url === '/landing-content') return Promise.resolve({})
    if (url === '/landing/cards') return Promise.resolve([])
    return Promise.resolve({})
  })

  class TestResizeObserver {
    observe() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = TestResizeObserver as typeof ResizeObserver
})

afterEach(() => {
  markers.forEach((element) => element.remove())
})

describe('food item navigation', () => {
  it('opens the actual menu item from the Home business menu panel', async () => {
    renderPage('home')

    fireEvent.click(screen.getByRole('button', { name: 'Show map' }))
    await waitFor(() => expect(markers).toHaveLength(1))
    fireEvent.click(markers[0])

    fireEvent.click(await screen.findByRole('button', { name: 'Menu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'View details for Chicken BBQ' }))

    expect(await screen.findByTestId('current-path')).toHaveTextContent('/tourist/food/item/501')
    expect(screen.getByText('Food item details')).toBeInTheDocument()
  })

  it('adds a map menu item to cart and checkout carries it to the cart', async () => {
    renderPage('map')

    fireEvent.click(await screen.findByRole('button', { name: 'Select map business' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Menu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Cart' }))

    expect(JSON.parse(localStorage.getItem('food_cart') || '[]')).toEqual([{
      id: 501,
      name: 'Chicken BBQ',
      price: 180,
      image: 'offerings/chicken-bbq.jpg',
      business_name: 'Bansud Cafe',
      business_id: 7,
      quantity: 1,
    }])

    fireEvent.click(screen.getByRole('button', { name: 'Checkout' }))

    expect(await screen.findByTestId('current-path')).toHaveTextContent('/tourist/food/cart')
    expect(screen.getByText('Food cart')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('food_cart') || '[]')[0].quantity).toBe(2)
  })

  it('shows restaurant menu items on Tourist Explore Map and opens the item details page', async () => {
    renderPage('map')

    fireEvent.click(await screen.findByRole('button', { name: 'Select map business' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Menu' }))
    fireEvent.click(await screen.findByRole('button', { name: 'View details for Chicken BBQ' }))

    expect(await screen.findByTestId('current-path')).toHaveTextContent('/tourist/food/item/501')
    expect(screen.getByText('Food item details')).toBeInTheDocument()
  })

  it('opens menu item details from the restaurant page reached through Tourist Explore', async () => {
    renderPage('explore')

    fireEvent.click(await screen.findByText('Bansud Cafe'))

    expect(await screen.findByTestId('current-path')).toHaveTextContent('/tourist/food/7')
    expect(await screen.findByRole('heading', { name: 'Bansud Cafe' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Add .+ to cart$/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View food item details for Chicken BBQ' }))

    expect(await screen.findByTestId('current-path')).toHaveTextContent('/tourist/food/item/501')
    expect(screen.getByText('Food item details')).toBeInTheDocument()
  })

  it('opens the selected menu item from Tourist Home using the offering ID', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/tourist/dashboard']}>
          <Routes>
            <Route path="/tourist/dashboard" element={<TouristHome />} />
            <Route path="/tourist/food/item/:id" element={<div>Food item details</div>} />
            <Route path="/tourist/food/:id" element={<div>Restaurant details</div>} />
          </Routes>
          <CurrentPath />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByText('Chicken BBQ'))

    expect(await screen.findByTestId('current-path')).toHaveTextContent('/tourist/food/item/501')
    expect(screen.getByText('Food item details')).toBeInTheDocument()
  })
})
