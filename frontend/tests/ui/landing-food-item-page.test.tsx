import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristFoodItemDetail from '@/features/tourist/pages/TouristFoodItemDetail'
import LandingRestaurantPage from '@/pages/LandingRestaurantPage'
import { applyGuestPreferences } from '@/shared/services/preferences'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: vi.fn().mockResolvedValue({}) }))
// The public chrome is not under test here; keep the restaurant page focused.
vi.mock('@/pages/components/LandingShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const RESTAURANT = {
  business: { id: 2, name: 'Kusina ni Aling Rosa', is_open: true },
  isOpen: true,
  menu_items: [{ id: 41, name: 'Tapsilog', price: 150, image: null, description: 'Beef tapa', category: 'Rice meals' }],
}

const DETAIL = {
  id: 41,
  name: 'Tapsilog',
  description: 'Beef tapa with garlic rice and egg.',
  price: 150,
  image: null,
  images: [],
  is_available: true,
  has_variations: true,
  variations: [
    { id: 1, name: 'Regular', price: 150, is_available: true },
    { id: 2, name: 'Large', price: 180, is_available: true },
  ],
  business_id: 2,
  business_name: 'Kusina ni Aling Rosa',
  business_latitude: 12.8,
  business_longitude: 121.4,
  is_open: true,
  is_accepting_orders: true,
  availability: 'open',
  open_status: { status: 'open', label: 'Open now' },
}

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/explore/food/:id" element={<LandingRestaurantPage />} />
          <Route path="/explore/food/item/:id" element={<TouristFoodItemDetail />} />
          <Route path="/login" element={<div>Sign in page</div>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const guestCart = () => JSON.parse(localStorage.getItem('tracktour_landing_cart') || '[]')

beforeEach(() => {
  localStorage.clear()
  api.get.mockImplementation((url: string) => {
    if (url === '/tourist/explore/2') return Promise.resolve(RESTAURANT)
    if (url === '/tourist/food/41') return Promise.resolve(DETAIL)
    return Promise.resolve({ data: [] })
  })
})

describe('public food item page (/explore/food/item/:id)', () => {
  it('opens the full food item page from a restaurant menu card, not a pop-up', async () => {
    renderAt('/explore/food/2')
    const card = await screen.findByRole('link', { name: 'View Tapsilog' })
    expect(card).toHaveAttribute('href', '/explore/food/item/41')

    fireEvent.click(card)
    expect(screen.getByTestId('path')).toHaveTextContent('/explore/food/item/41')
    const page = await screen.findByRole('main', { name: 'Food item details' })
    expect(await within(page).findByRole('heading', { name: 'Tapsilog' })).toBeInTheDocument()
    expect(within(page).getByText('Beef tapa with garlic rice and egg.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('links back to the public restaurant page and fills the guest cart, not the tourist cart', async () => {
    renderAt('/explore/food/item/41')
    const page = await screen.findByRole('main', { name: 'Food item details' })
    await within(page).findByRole('heading', { name: 'Tapsilog' })

    for (const link of within(page).getAllByRole('link', { name: /Kusina ni Aling Rosa|View restaurant/ })) {
      expect(link.getAttribute('href')).toBe('/explore/food/2')
    }

    fireEvent.click(within(page).getByRole('radio', { name: /Large/ }))
    fireEvent.click(within(page).getByRole('button', { name: 'Add to Cart' }))

    expect(localStorage.getItem('food_cart')).toBeNull()
    expect(guestCart()).toEqual([
      expect.objectContaining({ id: 41, name: 'Tapsilog (Large)', price: 180, business_id: 2, quantity: 1, variation: 'Large' }),
    ])
  })

  it('sends a guest who taps Buy Now to sign in, with the item kept in the guest cart', async () => {
    renderAt('/explore/food/item/41')
    const page = await screen.findByRole('main', { name: 'Food item details' })
    await within(page).findByRole('heading', { name: 'Tapsilog' })

    fireEvent.click(within(page).getByRole('button', { name: 'Buy Now' }))
    expect(await screen.findByText('Sign in page')).toBeInTheDocument()
    expect(guestCart()).toHaveLength(1)
  })
})

describe('guest cart carried into the tourist cart at login', () => {
  it('keeps a variation line separate from the plain item', async () => {
    localStorage.setItem('food_cart', JSON.stringify([
      { id: 41, name: 'Tapsilog', price: 150, image: null, business_name: 'Kusina ni Aling Rosa', business_id: 2, quantity: 1 },
    ]))
    localStorage.setItem('tracktour_landing_cart', JSON.stringify([
      { id: 41, name: 'Tapsilog (Large)', price: 180, image: null, business_name: 'Kusina ni Aling Rosa', business_id: 2, quantity: 2, variation: 'Large' },
      { id: 41, name: 'Tapsilog', price: 150, image: null, business_name: 'Kusina ni Aling Rosa', business_id: 2, quantity: 1 },
    ]))

    await applyGuestPreferences()

    const cart = JSON.parse(localStorage.getItem('food_cart') || '[]')
    expect(cart).toHaveLength(2)
    expect(cart.find((r: { name: string }) => r.name === 'Tapsilog')).toMatchObject({ price: 150, quantity: 2 })
    expect(cart.find((r: { name: string }) => r.name === 'Tapsilog (Large)')).toMatchObject({ price: 180, quantity: 2, variation: 'Large' })
    expect(localStorage.getItem('tracktour_landing_cart')).toBeNull()
  })
})
