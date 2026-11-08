import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristFoodShow from '@/features/tourist/pages/TouristFoodShow'
import TouristSidebar from '@/features/tourist/components/layout/TouristSidebar'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  default: { get: api.get },
}))

const auth = vi.hoisted(() => ({
  state: { user: { role: 'tourist', name: 'Jayvie De Torres' } as { role: string; name: string } | null, logout: () => {} },
}))

vi.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: (selector?: (value: typeof auth.state) => unknown) => selector ? selector(auth.state) : auth.state,
}))

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'map' }, children),
    TileLayer: () => null,
    Marker: () => null,
    Polyline: () => null,
    useMap: () => ({ fitBounds: () => {} }),
  }
})

vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})) } }))

const businessPayload = {
  business: {
    id: 7,
    name: 'Eksklusibo Grill and Restaurant',
    description: 'Savor the best grilled dishes in Bansud.',
    category: { id: 1, name: 'Restaurant' },
    municipality: { id: 1, name: 'Bansud' },
    address: 'Poblacion',
    contact_number: '+63 912 345 6789',
    latitude: '12.86',
    longitude: '121.46',
    logo: null,
    cover_photo: null,
    rating: null,
    is_open: true,
    is_accepting_orders: true,
    availability: 'open',
    open_status: { status: 'open', label: 'Open now' },
    schedule_summary: 'Daily',
    opening_time: '10:00:00',
    closing_time: '22:00:00',
    is_favorited: false,
    menu_items: [],
    reviews: [],
  },
  avgRating: 4.0,
  reviewsCount: 12,
  ratingBreakdown: { 5: 6, 4: 3, 3: 1, 2: 1, 1: 1 },
  reviews: [
    // Shape returned by the Review model (review + nested user), not user_name/comment.
    { id: 1, rating: 5, created_at: '2026-11-01', review: 'Best chicken BBQ in town!', user: { name: 'Ana Reyes' } },
  ],
  gallery: [],
  menu_items: [
    { id: 501, name: 'Chicken BBQ', description: 'Tender grilled chicken.', price: 120, image: null, is_available: true, category: 'Grill', bestseller: true },
    { id: 502, name: 'Pinakbet', description: 'Mixed vegetables with garlic sauce.', price: 150, image: null, is_available: true, category: 'Vegetables', bestseller: false },
  ],
}

function renderShow() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tourist/food/7']}>
        <Routes>
          <Route path="/tourist/food/:id" element={<TouristFoodShow />} />
          <Route path="/tourist/food/item/:id" element={<div>Food item details</div>} />
          <Route path="/tourist/food/cart" element={<div>Checkout page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  auth.state.user = { role: 'tourist', name: 'Jayvie De Torres' }
  api.get.mockReset()
  api.get.mockImplementation((url: string) => (url === '/tourist/explore/7' ? Promise.resolve(businessPayload) : Promise.reject(new Error(url))))
})

describe('TouristFoodShow redesign', () => {
  it('renders the hero, open-until chip and restaurant info from the API', async () => {
    renderShow()

    expect(await screen.findByRole('heading', { level: 1, name: 'Eksklusibo Grill and Restaurant' })).toBeInTheDocument()
    expect(screen.getByText('Open until 10:00 PM')).toBeInTheDocument()

    const info = screen.getByRole('heading', { name: 'Restaurant Info' }).closest('section')!
    expect(within(info).getByText('10:00 AM – 10:00 PM')).toBeInTheDocument()
    expect(within(info).getByText('+63 912 345 6789')).toBeInTheDocument()
    expect(within(info).getByText('Poblacion, Bansud')).toBeInTheDocument()
  })

  it('shows the restaurant logo on phones too (smaller, above the name)', async () => {
    renderShow()
    await screen.findByRole('heading', { level: 1, name: 'Eksklusibo Grill and Restaurant' })

    const logo = screen.getByTestId('restaurant-logo')
    // Visible at every width: no hidden-below-sm class; 64 px on phones, larger from sm.
    expect(logo.className.split(/\s+/)).not.toContain('hidden')
    expect(logo.className).toContain('w-16')
    expect(logo.className).toContain('sm:w-28')
    // Stacked above the name on phones, side by side from sm.
    expect(logo.parentElement!.className).toContain('flex-col')
    expect(logo.parentElement!.className).toContain('sm:flex-row')
  })

  it('shows the rating breakdown as percentages of all approved reviews', async () => {
    renderShow()

    const rating = (await screen.findByRole('heading', { name: 'Restaurant Rating' })).closest('section')!
    expect(within(rating).getByText('4.0')).toBeInTheDocument()
    expect(within(rating).getByText('(12 reviews)')).toBeInTheDocument()

    const rows = within(within(rating).getByRole('list', { name: 'Rating breakdown' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('50%'), // 6 / 12
      expect.stringContaining('25%'), // 3 / 12
      expect.stringContaining('8%'),  // 1 / 12
      expect.stringContaining('8%'),
      expect.stringContaining('8%'),
    ])
  })

  it('marks bestsellers as Popular and filters the menu by search', async () => {
    renderShow()

    expect(await screen.findByText('Popular')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Add .+ to cart$/ })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /^Buy .+ now$/ })).toHaveLength(2)

    fireEvent.change(screen.getByPlaceholderText('Search menu items...'), { target: { value: 'garlic' } })

    expect(screen.queryByRole('button', { name: 'View food item details for Chicken BBQ' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View food item details for Pinakbet' })).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search menu items...'), { target: { value: 'zzz' } })
    expect(screen.getByText('No dishes match your search.')).toBeInTheDocument()
  })

  it('menu cards show the price above "Add to Cart" and "Buy Now"', async () => {
    renderShow()
    const addBtn = await screen.findByRole('button', { name: 'Add Chicken BBQ to cart' })
    const card = addBtn.closest('article')!
    const price = within(card).getByText('₱120.00')
    const buyBtn = within(card).getByRole('button', { name: 'Buy Chicken BBQ now' })
    // Price comes first, then the two buttons side by side in one row.
    expect(price.compareDocumentPosition(addBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(addBtn.parentElement).toBe(buyBtn.parentElement)
    expect(price.contains(addBtn)).toBe(false)
    // Add to cart: cart icon with a small caption below, no border or pill.
    expect(addBtn).toHaveTextContent('Add to cart')
    expect(addBtn.className).toContain('flex-col')
    expect(addBtn.className).not.toMatch(/\bborder\b|border-2|rounded-full/)
    expect(addBtn.querySelector('svg')).not.toBeNull()
    // Photo row 252 px (25% shorter than the previous 336 px), then 112 px for name, price and buttons.
    expect(card.className).toContain('grid-rows-[252px_112px]')
    const [photoRow, infoRow] = Array.from(card.children)
    expect(photoRow).toBe(within(card).getByRole('button', { name: 'View food item details for Chicken BBQ' }))
    expect(infoRow).toContainElement(within(card).getByRole('heading', { name: 'Chicken BBQ' }))
    expect(infoRow).toContainElement(price)
    expect(infoRow).toContainElement(addBtn)
    expect(infoRow).toContainElement(buyBtn)
    expect(buyBtn).toHaveTextContent('Buy Now')
  })

  it('"Buy Now" puts one in the cart and opens checkout', async () => {
    renderShow()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Buy Chicken BBQ now' })) })

    expect(screen.getByText('Checkout page')).toBeInTheDocument()
    const cart = JSON.parse(localStorage.getItem('food_cart') ?? '[]')
    expect(cart).toEqual([expect.objectContaining({ id: 501, name: 'Chicken BBQ', quantity: 1, price: 120 })])
  })

  it('the quantity sheet also offers "Buy Now" for the chosen quantity', async () => {
    renderShow()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Pinakbet to cart' }))
    const sheet = screen.getByRole('dialog', { name: 'Add Pinakbet to cart' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Increase quantity' }))
    expect(within(sheet).getByText('₱300.00')).toBeInTheDocument()

    await act(async () => { fireEvent.click(within(sheet).getByRole('button', { name: 'Buy Now' })) })

    expect(screen.getByText('Checkout page')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('food_cart') ?? '[]')).toEqual([expect.objectContaining({ id: 502, quantity: 2 })])
  })

  it('renders review text and author from the Review model payload', async () => {
    renderShow()

    fireEvent.click(await screen.findByRole('tab', { name: 'Reviews' }))

    expect(screen.getByText('Ana Reyes')).toBeInTheDocument()
    expect(screen.getByText('Best chicken BBQ in town!')).toBeInTheDocument()
  })

  it('View on Map opens the Location tab with the map', async () => {
    renderShow()

    fireEvent.click(await screen.findByRole('button', { name: 'View on Map' }))

    expect(screen.getByRole('tab', { name: 'Location' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('map')).toBeInTheDocument()
  })

  it('hides Add buttons and shows the closed notice when not accepting orders', async () => {
    api.get.mockImplementation(() => Promise.resolve({
      ...businessPayload,
      business: { ...businessPayload.business, is_open: false, is_accepting_orders: false, open_status: { status: 'closed', label: 'Opens tomorrow at 10:00 AM' } },
    }))
    renderShow()

    expect(await screen.findByRole('status')).toHaveTextContent('Ordering is currently disabled')
    expect(screen.queryByRole('button', { name: /^Add .+ to cart$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Buy .+ now$/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('Opens tomorrow at 10:00 AM').length).toBeGreaterThan(0)
  })
})

describe('TouristSidebar', () => {
  function renderSidebar(path: string) {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <TouristSidebar />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('lists the tourist navigation and highlights Food & Dining on a restaurant page', () => {
    renderSidebar('/tourist/food/7')

    const nav = screen.getByRole('navigation', { name: 'Tourist navigation' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'Home', 'Explore', 'Food & Dining', 'Stays', 'My Activities', 'Saved', 'Profile',
    ])
    expect(within(nav).getByRole('link', { name: 'Food & Dining' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Jayvie De Torres')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Log Out' })).toBeInTheDocument()
  })

  it('keeps Explore active on the explore map and My Activities on trips', () => {
    const { unmount } = renderSidebar('/tourist/explore/map')
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute('aria-current', 'page')
    unmount()

    renderSidebar('/tourist/trips')
    expect(screen.getByRole('link', { name: 'My Activities' })).toHaveAttribute('aria-current', 'page')
  })

  it('offers Sign In instead of Log Out for guests', () => {
    auth.state.user = null
    renderSidebar('/tourist/explore')

    expect(screen.getByText('Guest')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Log Out' })).not.toBeInTheDocument()
  })
})
