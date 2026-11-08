import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristHome from '@/features/tourist/pages/TouristHome'
import TouristHeader from '@/features/tourist/components/layout/TouristHeader'
import { getFoodCart } from '@/shared/services/food-cart'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  default: { get: api.get },
}))

vi.mock('@/features/auth/services/auth-store', () => {
  const state = { user: { role: 'tourist', name: 'Jayvie De Torres', email: 'j@example.com' }, token: 't', logout: () => {} }
  return { useAuthStore: (selector?: (v: typeof state) => unknown) => (selector ? selector(state) : state) }
})

const responses: Record<string, unknown> = {
  '/tourist/destinations': {
    data: [
      { id: 3, name: 'Tigbao Falls', category: { name: 'Waterfall' }, images: ['/storage/tigbao.jpg'], latitude: 12.86, longitude: 121.46, municipality: { name: 'Bansud' }, rating: 4.7 },
      { id: 4, name: 'Bansud Beach', category: { name: 'Beach' }, images: [], latitude: null, longitude: null, municipality: { name: 'Bansud' }, rating: 0 },
    ],
  },
  '/tourist/food': {
    data: [
      { id: 501, name: 'Chicken BBQ', category: 'Grill', image: null, price: 120, business_name: 'Eksklusibo Grill and Restaurant', business_id: 7, business_latitude: 12.8, business_longitude: 121.4, rating: 4.7, is_accepting_orders: true },
      { id: 502, name: 'Halo-Halo', category: 'Dessert', image: null, price: 70, business_name: 'Dessert Corner', business_id: 8, rating: null, is_accepting_orders: false },
    ],
  },
  '/tourist/stays': {
    accommodations: [{ id: 9, name: 'Bansud Bay Resort', cover_photo: '/storage/resort.jpg', rating: 4.5, municipality: 'Bansud', category: 'Resort' }],
  },
  '/tourist/events': { events: [] },
  '/tourist/for-you': { kind: 'food', title: 'For You', has_location: false, items: [] },
  '/tourist/notifications/unread-count': { unread_count: 1 },
}

function CurrentPath() {
  const { pathname, search } = useLocation()
  return <output data-testid="path">{pathname + search}</output>
}

function renderHome() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tourist/dashboard']}>
        <Routes>
          <Route path="/tourist/dashboard" element={<TouristHome />} />
          <Route path="*" element={<div>Other page</div>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (_ok: PositionCallback, fail?: PositionErrorCallback) => fail?.({ code: 1 } as GeolocationPositionError) } })
  api.get.mockReset()
  api.get.mockImplementation((url: string) => Promise.resolve(responses[url] ?? {}))
})

describe('Tourist Home redesign', () => {
  it('hero search sends the query to the search page', async () => {
    renderHome()

    expect(screen.getByRole('heading', { level: 1, name: 'Explore Bansud' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search destinations, restaurants, or activities' }), { target: { value: 'kare kare' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(screen.getByTestId('path')).toHaveTextContent('/tourist/search?q=kare%20kare')
  })

  it('category chips link to their sections', () => {
    renderHome()

    const chips = within(screen.getByRole('navigation', { name: 'Browse by category' }))
    expect(chips.getByRole('link', { name: 'All' })).toHaveAttribute('href', '/tourist/explore')
    expect(chips.getByRole('link', { name: 'Attractions' })).toHaveAttribute('href', '/tourist/destinations')
    expect(chips.getByRole('link', { name: 'Restaurants' })).toHaveAttribute('href', '/tourist/food')
    expect(chips.getByRole('link', { name: 'Hotels' })).toHaveAttribute('href', '/tourist/stays')
    expect(chips.getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/tourist/events')
  })

  it('carousel arrows and dots change the slide', () => {
    renderHome()

    expect(screen.getByRole('tab', { name: 'Show Viewing Hills' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }))
    expect(screen.getByRole('tab', { name: 'Show Rosacara Rolling Hills' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Previous slide' }))
    expect(screen.getByRole('tab', { name: 'Show Paypay-Ama Falls' })).toHaveAttribute('aria-selected', 'true')
  })

  it('View All links point at each section (previously never rendered)', async () => {
    renderHome()

    expect(await screen.findByRole('link', { name: 'View all Featured Destinations' })).toHaveAttribute('href', '/tourist/destinations')
    expect(screen.getByRole('link', { name: 'View all Popular Food & Restaurants' })).toHaveAttribute('href', '/tourist/food')
    expect(await screen.findByRole('link', { name: 'View all Recommended Stays' })).toHaveAttribute('href', '/tourist/stays')
  })

  it('destination cards use the API image and never invent a rating', async () => {
    renderHome()

    const falls = (await screen.findByText('Tigbao Falls')).closest('a')!
    expect(falls).toHaveAttribute('href', '/tourist/destinations/3')
    expect(falls.querySelector('img')?.getAttribute('src')).toContain('tigbao.jpg')
    expect(within(falls).getByText('4.7')).toBeInTheDocument()

    const beach = screen.getByText('Bansud Beach').closest('a')!
    expect(within(beach).getByText('New on TrackTour')).toBeInTheDocument()
    expect(within(beach).queryByText('4.5')).not.toBeInTheDocument()
  })

  it('Add puts the dish in the shared cart; closed restaurants show no Add button', async () => {
    const onCart = vi.fn()
    window.addEventListener('cart-updated', onCart)
    renderHome()

    fireEvent.click(await screen.findByRole('button', { name: 'Add Chicken BBQ to cart' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chicken BBQ added to cart' }))

    expect(getFoodCart()).toEqual([
      expect.objectContaining({ id: 501, business_id: 7, business_name: 'Eksklusibo Grill and Restaurant', price: 120, quantity: 2 }),
    ])
    expect(onCart).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Add Halo-Halo to cart' })).not.toBeInTheDocument()
    window.removeEventListener('cart-updated', onCart)
  })

  it('restaurant name opens the restaurant page and stays use the real cover photo', async () => {
    renderHome()

    expect(await screen.findByRole('link', { name: 'Eksklusibo Grill and Restaurant' })).toHaveAttribute('href', '/tourist/food/7')
    const resort = (await screen.findByText('Bansud Bay Resort')).closest('a')!
    expect(resort).toHaveAttribute('href', '/tourist/explore/9')
    expect(resort.querySelector('img')?.getAttribute('src')).toContain('resort.jpg')
    expect(within(resort).getByText('4.5')).toBeInTheDocument()
  })
})

describe('Tourist header', () => {
  it('has cart, saved and notifications, but no search bar and no profile menu', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TouristHeader />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(screen.queryByRole('textbox', { name: 'Search TrackTour' })).not.toBeInTheDocument()
    expect(screen.queryByRole('search')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cart' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.queryByText('Jayvie De Torres')).not.toBeInTheDocument()
  })

  it('hero greets the tourist with the municipality they are currently in', async () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.98, longitude: 121.47 } } as GeolocationPosition) },
    })
    api.get.mockImplementation((url: string) =>
      Promise.resolve(url === '/municipalities/locate' ? { id: 6, name: 'Pinamalayan', province: 'Oriental Mindoro' } : responses[url] ?? {}),
    )

    renderHome()

    expect(await screen.findByRole('heading', { level: 1, name: 'Explore Pinamalayan' })).toBeInTheDocument()
    expect(screen.getByText('Welcome to Pinamalayan!')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Explore Pinamalayan' })).toBeInTheDocument()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/municipalities/locate', { params: { lat: 12.98, lng: 121.47 } }))
  })

  describe('sections follow the municipality the tourist is in', () => {
    const locateAt = (m: { id: number; name: string } | null) => {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 12.75, longitude: 121.49 } } as GeolocationPosition) },
      })
      return m
    }
    const scopeOf = (url: string) =>
      api.get.mock.calls.filter(([u]) => u === url).map(([, cfg]) => (cfg as { params?: Record<string, unknown> })?.params ?? {})

    it('scopes every section to the current municipality and names it', async () => {
      const here = { ...locateAt({ id: 2, name: 'Bongabong' })!, cover_photo: 'municipalities/bongabong.jpg' }
      api.get.mockImplementation((url: string, cfg?: { params?: Record<string, unknown> }) => {
        const p = cfg?.params ?? {}
        if (url === '/municipalities/locate') return Promise.resolve({ ...here, province: 'Oriental Mindoro' })
        if (url === '/municipalities/2/photos') return Promise.resolve([
          { src: '/storage/municipalities/bongabong.jpg', caption: 'Bongabong', kind: 'municipality' },
          { src: '/storage/falls.jpg', caption: 'Bongabong Falls', kind: 'attraction' },
        ])
        if (url === '/tourist/destinations') return Promise.resolve({ data: p.municipality === 2 ? [{ id: 30, name: 'Bongabong Falls', images: ['/storage/falls.jpg'], municipality: { name: 'Bongabong' } }, { id: 31, name: 'No Photo Spot', images: [], municipality: { name: 'Bongabong' } }] : [] })
        if (url === '/tourist/food') return Promise.resolve({ data: p.municipality_id === 2 ? [{ id: 600, name: 'Kakanin', price: 50, business_name: 'Bongabong Eatery', business_id: 20, is_accepting_orders: true }] : [] })
        if (url === '/tourist/stays') return Promise.resolve({ accommodations: p.municipality_id === 2 ? [{ id: 40, name: 'Bongabong Inn', cover_photo: null, rating: null, municipality: 'Bongabong' }] : [] })
        if (url === '/tourist/events') return Promise.resolve({ events: p.municipality_id === 2 ? [{ id: 50, name: 'Bongabong Fiesta', start_date: '2026-12-01', municipality: { name: 'Bongabong' } }] : [] })
        return Promise.resolve(responses[url] ?? {})
      })

      renderHome()

      expect(await screen.findByText('Must-visit places in Bongabong')).toBeInTheDocument()
      expect(await screen.findByText('Taste the best of Bongabong')).toBeInTheDocument()
      expect(await screen.findByText('Relax and unwind in Bongabong')).toBeInTheDocument()
      expect(await screen.findByText('Festivals and happenings in Bongabong')).toBeInTheDocument()
      expect(screen.getByText('Bongabong Falls')).toBeInTheDocument()
      expect(screen.getByText('Kakanin')).toBeInTheDocument()
      expect(screen.getByText('Bongabong Inn')).toBeInTheDocument()
      expect(screen.getByText('Bongabong Fiesta')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'Plan your Bongabong getaway' })).toBeInTheDocument()
      expect(scopeOf('/tourist/stays')).toContainEqual(expect.objectContaining({ municipality_id: 2 }))

      // Hero carousel: municipality cover first, then its attractions' photos; default Bansud slides gone.
      const slides = within(screen.getByRole('tablist', { name: 'Choose slide' })).getAllByRole('tab')
      expect(slides.map((t) => t.getAttribute('aria-label'))).toEqual(['Show Bongabong', 'Show Bongabong Falls'])
      expect(screen.queryByRole('tab', { name: 'Show Viewing Hills' })).not.toBeInTheDocument()
      // Getaway card uses the second municipality photo.
      expect(screen.getByTestId('getaway-photo').getAttribute('src')).toContain('/storage/falls.jpg')
    })

    it('falls back to all municipalities, labelled by province, when the town has nothing listed', async () => {
      const here = locateAt({ id: 3, name: 'Bulalacao' })
      api.get.mockImplementation((url: string, cfg?: { params?: Record<string, unknown> }) => {
        const p = cfg?.params ?? {}
        if (url === '/municipalities/locate') return Promise.resolve({ ...here, province: 'Oriental Mindoro' })
        if (url === '/tourist/stays') return Promise.resolve(p.municipality_id ? { accommodations: [] } : responses['/tourist/stays'])
        if (url === '/tourist/destinations' && p.municipality) return Promise.resolve({ data: [] })
        if (url === '/municipalities/3/photos') return Promise.resolve([])
        return Promise.resolve(responses[url] ?? {})
      })

      renderHome()

      expect(await screen.findByText('Relax and unwind in Oriental Mindoro')).toBeInTheDocument()
      expect(screen.getByText('Bansud Bay Resort')).toBeInTheDocument()
      expect(screen.queryByText('Relax and unwind in Bulalacao')).not.toBeInTheDocument()
      // No photos for this town: empty containers for its tourism office to fill; never another town's photos.
      expect(await screen.findByTestId('hero-photo-empty')).toBeInTheDocument()
      expect(screen.getByTestId('getaway-photo-empty')).toBeInTheDocument()
      expect(screen.queryByRole('tablist', { name: 'Choose slide' })).not.toBeInTheDocument()
      expect(screen.queryByRole('tab', { name: 'Show Viewing Hills' })).not.toBeInTheDocument()
      expect(scopeOf('/tourist/stays')).toContainEqual(expect.objectContaining({ municipality_id: 3 }))
    })
  })
})
