import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristFood from '@/features/tourist/pages/TouristFood'
import TouristFoodItemDetail from '@/features/tourist/pages/TouristFoodItemDetail'

const api = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: vi.fn(),
}))

const LIST_ITEM: Record<string, unknown> = {
  id: 501,
  name: 'Tapsilog',
  description: 'Beef tapa with garlic rice and egg.',
  category: 'filipino',
  image: 'foods/tapsilog.jpg',
  price: 150,
  business_name: 'John Jobert Restaurant',
  business_id: 7,
  business_latitude: 12.51,
  business_longitude: 121.31,
  rating: 4.5,
  review_count: 2,
  is_open: true,
  is_accepting_orders: true,
  availability: 'open',
  open_status: { status: 'open', label: 'Open now' },
}

const DETAIL: Record<string, unknown> = {
  id: 501,
  name: 'Tapsilog',
  description: 'Beef tapa with garlic rice and egg.',
  price: 150,
  compare_price: 180,
  category: 'Filipino',
  image: 'foods/tapsilog.jpg',
  images: ['foods/tapsilog.jpg', 'foods/tapsilog-2.jpg'],
  is_available: true,
  is_featured: true,
  has_variations: true,
  variations: [
    { id: 11, name: 'Regular', price: 150, is_available: true },
    { id: 12, name: 'Large', price: 180, is_available: true },
    { id: 13, name: 'Family', price: 260, is_available: false },
  ],
  preparation_time: 25,
  business_id: 7,
  business_name: 'John Jobert Restaurant',
  business_logo: 'logos/jjr.png',
  business_address: 'Bansud, Oriental Mindoro',
  business_latitude: 12.51,
  business_longitude: 121.31,
  business_review_count: 2,
  business_reviews: [
    { id: 90, rating: 5, review: 'Delicious!', user_name: 'Maria', created_at: '2026-10-01T00:00:00Z' },
    { id: 91, rating: 4, review: 'Good portions.', user_name: 'Jose', created_at: '2026-10-02T00:00:00Z' },
  ],
  rating: 4.5,
  is_open: true,
  is_accepting_orders: true,
  availability: 'open',
  open_status: { status: 'open', label: 'Open now' },
  schedule_summary: 'Mon-Sun: 6:00 AM - 8:00 PM',
}

let listItems: Array<Record<string, unknown>> = [LIST_ITEM]
let detailPayload: Record<string, unknown> = { ...DETAIL }

function renderFoodPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/tourist/food']}>
        <Routes>
          <Route path="/tourist/food" element={<TouristFood />} />
          <Route path="/tourist/food/item/:id" element={<TouristFoodItemDetail />} />
          <Route path="/tourist/food/cart" element={<div>Cart page</div>} />
          <Route path="/tourist/food/:id" element={<div>Restaurant page</div>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function CurrentPath() {
  const { pathname } = useLocation()
  return <output data-testid="current-path">{pathname}</output>
}

async function openDetails(foodName = 'Tapsilog') {
  const card = await screen.findByRole('button', { name: `View details for ${foodName}` })
  fireEvent.click(card)
  expect(await screen.findByTestId('current-path')).toHaveTextContent('/tourist/food/item/501')
  const detailPage = await screen.findByRole('main', { name: 'Food item details' })
  await within(detailPage).findByRole('heading', { name: foodName })
  return detailPage
}

function readCart(): Array<Record<string, unknown>> {
  try {
    return JSON.parse(localStorage.getItem('food_cart') || '[]')
  } catch {
    return []
  }
}

beforeEach(() => {
  localStorage.clear()
  listItems = [LIST_ITEM]
  detailPayload = { ...DETAIL }
  api.get.mockImplementation((url: string) => {
    if (url === '/tourist/food') return Promise.resolve({ data: listItems })
    if (url.startsWith('/tourist/food/')) return Promise.resolve(detailPayload)
    return Promise.resolve({ data: [] })
  })
})

describe('tourist food item details', () => {
  it('opens a dedicated details page from a food card and shows real menu data', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    expect(within(detailPage).getByRole('heading', { name: 'Tapsilog' })).toBeInTheDocument()
    expect(within(detailPage).getByText('Beef tapa with garlic rice and egg.')).toBeInTheDocument()
    expect(within(detailPage).getByText('John Jobert Restaurant')).toBeInTheDocument()
    expect(within(detailPage).getByText('Bansud, Oriental Mindoro')).toBeInTheDocument()
    expect(within(detailPage).getByText('Open now')).toBeInTheDocument()
    expect(within(detailPage).getAllByText('₱150.00').length).toBeGreaterThan(0)
    expect(within(detailPage).getByText('Popular')).toBeInTheDocument()
    expect(within(detailPage).getByText('Choose a variation')).toBeInTheDocument()
    expect(within(detailPage).getByRole('radio', { name: /Regular/ })).toBeInTheDocument()
    expect(within(detailPage).getByRole('radiogroup', { name: 'Choose a variation' })).toBeInTheDocument()
    expect(within(detailPage).getByText('Quantity')).toBeInTheDocument()
    expect(within(detailPage).getByRole('button', { name: 'Add to Cart' })).toBeInTheDocument()
    expect(within(detailPage).getByRole('button', { name: 'Buy Now' })).toBeInTheDocument()
    expect(within(detailPage).getByRole('group', { name: 'Quantity selector' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Restaurant context — real stored business rating and reviews.
    expect(within(detailPage).getByText('2 reviews')).toBeInTheDocument()
    expect(within(detailPage).getByText('Restaurant reviews')).toBeInTheDocument()
    expect(within(detailPage).getByText('Delicious!')).toBeInTheDocument()
    expect(within(detailPage).getByText('View restaurant')).toBeInTheDocument()
  })

  it('hides optional sections when the records carry no such data', async () => {
    detailPayload = {
      ...DETAIL,
      description: null,
      images: [],
      compare_price: null,
      preparation_time: null,
      has_variations: false,
      variations: [],
      business_reviews: [],
      rating: null,
      business_review_count: 0,
      business_address: null,
      schedule_summary: null,
    }
    renderFoodPage()
    const detailPage = await openDetails()

    // Core information still renders.
    expect(within(detailPage).getByRole('heading', { name: 'Tapsilog' })).toBeInTheDocument()
    expect(within(detailPage).getByText('John Jobert Restaurant')).toBeInTheDocument()

    // Everything optional stays hidden — nothing is invented.
    expect(within(detailPage).queryByText('Beef tapa with garlic rice and egg.')).not.toBeInTheDocument()
    expect(within(detailPage).queryByText('Choose a variation')).not.toBeInTheDocument()
    expect(within(detailPage).queryByRole('radiogroup', { name: 'Choose a variation' })).not.toBeInTheDocument()
    expect(within(detailPage).queryByText('Restaurant reviews')).not.toBeInTheDocument()
    expect(within(detailPage).queryByText('Delicious!')).not.toBeInTheDocument()
    expect(within(detailPage).queryByText(/min preparation/)).not.toBeInTheDocument()
    expect(within(detailPage).queryByText(/review/)).not.toBeInTheDocument()
    expect(within(detailPage).queryByRole('group', { name: 'Food images' })).not.toBeInTheDocument()
    expect(within(detailPage).queryByText('₱180.00')).not.toBeInTheDocument()
    expect(within(detailPage).queryByText('Mon-Sun: 6:00 AM - 8:00 PM')).not.toBeInTheDocument()
  })

  it('reflects quantity and variation selection in cart calculations', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    fireEvent.click(within(detailPage).getByRole('radio', { name: /Large/ }))
    expect(within(detailPage).getByRole('radio', { name: /Large/ })).toHaveAttribute('aria-checked', 'true')

    const increase = within(detailPage).getByRole('button', { name: 'Increase quantity' })
    fireEvent.click(increase)
    fireEvent.click(increase)

    // ₱180 (Large) × 3
    expect(within(detailPage).getByText('₱540.00')).toBeInTheDocument()

    const cartUpdated = vi.fn()
    window.addEventListener('cart-updated', cartUpdated)
    fireEvent.click(within(detailPage).getByRole('button', { name: 'Add to Cart' }))
    await waitFor(() => expect(cartUpdated).toHaveBeenCalled())
    window.removeEventListener('cart-updated', cartUpdated)

    // Adding to cart keeps the tourist on the item's details page.
    expect(screen.getByRole('main', { name: 'Food item details' })).toBeInTheDocument()

    const cart = readCart()
    expect(cart).toHaveLength(1)
    expect(cart[0]).toMatchObject({
      id: 501,
      name: 'Tapsilog (Large)',
      price: 180,
      quantity: 3,
      variation: 'Large',
      business_id: 7,
      business_name: 'John Jobert Restaurant',
      business_latitude: 12.51,
      business_longitude: 121.31,
    })
  })

  it('Buy Now adds the selected item and navigates to the cart', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    const cartUpdated = vi.fn()
    window.addEventListener('cart-updated', cartUpdated)
    fireEvent.click(within(detailPage).getByRole('button', { name: 'Buy Now' }))

    expect(await screen.findByText('Cart page')).toBeInTheDocument()
    expect(screen.queryByRole('main', { name: 'Food item details' })).not.toBeInTheDocument()
    expect(cartUpdated).toHaveBeenCalled()
    window.removeEventListener('cart-updated', cartUpdated)

    const cart = readCart()
    expect(cart).toHaveLength(1)
    // The first available variation is pre-selected, matching the existing
    // restaurant-page detail behavior.
    expect(cart[0]).toMatchObject({ id: 501, name: 'Tapsilog (Regular)', price: 150, quantity: 1, variation: 'Regular' })
  })

  it('merges repeat additions of the same variation into one cart line', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    fireEvent.click(within(detailPage).getByRole('radio', { name: /Large/ }))
    const addButton = within(detailPage).getByRole('button', { name: 'Add to Cart' })
    fireEvent.click(addButton)
    fireEvent.click(addButton)

    const cart = readCart()
    expect(cart).toHaveLength(1)
    expect(cart[0]).toMatchObject({ id: 501, name: 'Tapsilog (Large)', quantity: 2 })
  })

  it('hides unavailable variations from the selector', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    expect(within(detailPage).getByRole('radio', { name: /Regular/ })).toBeInTheDocument()
    expect(within(detailPage).getByRole('radio', { name: /Large/ })).toBeInTheDocument()
    expect(within(detailPage).queryByRole('radio', { name: /Family/ })).not.toBeInTheDocument()
  })

  it('disables ordering when the restaurant is not accepting orders', async () => {
    detailPayload = {
      ...DETAIL,
      is_accepting_orders: false,
      open_status: { status: 'closed', label: 'Opens today at 5:00 PM' },
    }
    renderFoodPage()
    const detailPage = await openDetails()

    expect(within(detailPage).getByText('Opens today at 5:00 PM')).toBeInTheDocument()
    expect(
      within(detailPage).getByText('Opens today at 5:00 PM — unavailable for order'),
    ).toBeInTheDocument()
    expect(within(detailPage).getByRole('button', { name: 'Add to Cart' })).toBeDisabled()
    expect(within(detailPage).getByRole('button', { name: 'Buy Now' })).toBeDisabled()
    expect(readCart()).toHaveLength(0)
  })

  it('shows an unavailable state on the item page when the item cannot be fetched', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/tourist/food') return Promise.resolve({ data: listItems })
      return Promise.reject(new Error('Not found'))
    })
    renderFoodPage()
    const card = await screen.findByRole('button', { name: 'View details for Tapsilog' })
    fireEvent.click(card)

    await screen.findByRole('heading', { name: 'Menu item unavailable' })
    const detailPage = screen.getByRole('main', { name: 'Food item details' })
    expect(within(detailPage).getByText('Menu item unavailable')).toBeInTheDocument()
    expect(within(detailPage).getByText('This item may have been removed or is no longer offered.')).toBeInTheDocument()
    expect(within(detailPage).getByRole('button', { name: 'Back to food menu' })).toBeInTheDocument()
  })

  it('has a single "Back" button that returns to the previous page', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    expect(within(detailPage).queryByRole('button', { name: 'Back to food menu' })).not.toBeInTheDocument()
    expect(within(detailPage).queryByRole('link', { name: /Back to restaurant/ })).not.toBeInTheDocument()
    fireEvent.click(within(detailPage).getByRole('button', { name: 'Back' }))
    // Came from the Food page, so Back goes there (not to the restaurant).
    expect(await screen.findByTestId('current-path')).toHaveTextContent(/^\/tourist\/food$/)
  })

  it('"Back" falls back to the restaurant when the item was opened directly', async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/tourist/food/item/501']}>
          <Routes>
            <Route path="/tourist/food/item/:id" element={<TouristFoodItemDetail />} />
            <Route path="/tourist/food/:id" element={<div>Restaurant page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const detailPage = await screen.findByRole('main', { name: 'Food item details' })
    fireEvent.click(await within(detailPage).findByRole('button', { name: 'Back' }))
    expect(await screen.findByText('Restaurant page')).toBeInTheDocument()
  })
})

describe('tourist food card rating honesty', () => {
  it('shows the restaurant rating on the card only when one exists', async () => {
    renderFoodPage()
    expect(await screen.findByLabelText('Restaurant rating 4.5 out of 5')).toBeInTheDocument()
  })

  it('never renders a fabricated rating when the restaurant has none', async () => {
    listItems = [{ ...LIST_ITEM, rating: null }]
    renderFoodPage()

    expect(await screen.findByRole('button', { name: 'View details for Tapsilog' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/Restaurant rating/)).not.toBeInTheDocument()
    expect(screen.queryByText('4.5')).not.toBeInTheDocument()
  })

  it('opens details with Enter and keeps inner card actions from opening them', async () => {
    const first = renderFoodPage()
    const card = await screen.findByRole('button', { name: 'View details for Tapsilog' })
    // Keyboard activation on the card itself opens the details.
    fireEvent.keyDown(card, { key: 'Enter' })
    await screen.findByRole('main', { name: 'Food item details' })
    await screen.findByRole('heading', { name: 'Tapsilog' })
    first.unmount()

    // Fresh listing (the item page now links back to the restaurant, not the list).
    renderFoodPage()
    await screen.findByRole('button', { name: 'View details for Tapsilog' })

    // The card's own Add button must not open the details — it adds to cart.
    fireEvent.click(screen.getByRole('button', { name: 'Add to Cart' }))
    expect(screen.queryByRole('main', { name: 'Food item details' })).not.toBeInTheDocument()
    expect(readCart()).toHaveLength(1)
  })
})

describe('tourist food item details — redesigned layout', () => {
  it('shows the restaurant rating breakdown, strip details and unit from the API', async () => {
    detailPayload = {
      ...DETAIL,
      unit: 'pc',
      business_category: 'Restaurant',
      business_municipality: 'Bansud',
      business_contact_number: '+63 912 345 6789',
      business_opening_time: '10:00:00',
      business_closing_time: '22:00:00',
      business_rating_summary: { average: 4.5, count: 4, breakdown: { 5: 2, 4: 2, 3: 0, 2: 0, 1: 0 } },
    }
    renderFoodPage()
    const detailPage = await openDetails()

    expect(within(detailPage).getByText('per pc')).toBeInTheDocument()
    expect(within(detailPage).getByText('4 reviews')).toBeInTheDocument()
    const rows = within(within(detailPage).getByRole('list', { name: 'Rating breakdown' })).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('50%'),
      expect.stringContaining('50%'),
      expect.stringContaining('0%'),
      expect.stringContaining('0%'),
      expect.stringContaining('0%'),
    ])
    const strip = within(detailPage).getByRole('region', { name: 'Restaurant' })
    expect(within(strip).getByText('10:00 AM – 10:00 PM')).toBeInTheDocument()
    expect(within(strip).getByRole('link', { name: '+63 912 345 6789' })).toHaveAttribute('href', 'tel:+63 912 345 6789')
    expect(within(strip).getByText('Restaurant • Bansud')).toBeInTheDocument()
    expect(within(detailPage).getByRole('button', { name: 'Back' })).toBeInTheDocument()
    expect(within(detailPage).getByText(/starts cooking once a rider accepts your order/)).toBeInTheDocument()
  })

  it('gallery arrows and thumbnails switch the main image', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    expect(within(detailPage).getByText('1/2')).toBeInTheDocument()
    fireEvent.click(within(detailPage).getByRole('button', { name: 'Next image' }))
    expect(within(detailPage).getByText('2/2')).toBeInTheDocument()
    expect(within(detailPage).getByRole('button', { name: 'View image 2 of 2' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(detailPage).getByRole('button', { name: 'Next image' }))
    expect(within(detailPage).getByText('1/2')).toBeInTheDocument()
  })

  it('never shows unsupported mockup sections (ingredients, allergens, add-ons, per-dish rating)', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    expect(within(detailPage).queryByText(/Ingredients/i)).not.toBeInTheDocument()
    expect(within(detailPage).queryByText(/Allergens/i)).not.toBeInTheDocument()
    expect(within(detailPage).queryByText(/Add-ons/i)).not.toBeInTheDocument()
    expect(within(detailPage).queryByText(/Spice Level/i)).not.toBeInTheDocument()
    // The only rating shown is labelled as the restaurant's.
    expect(within(detailPage).getByText(/restaurant rating/)).toBeInTheDocument()
  })
})

describe('tourist food item details — mobile order bar', () => {
  it('pins Restaurant | Chat | Add to Cart on the left half and Buy Now on the right half', async () => {
    detailPayload = { ...DETAIL, business_contact_number: '+63 912 345 6789' }
    renderFoodPage()
    const detailPage = await openDetails()

    const bar = within(detailPage).getByRole('group', { name: 'Order actions' })
    // Floats right above the bottom navigation below lg (whatever height the
    // bar has on this screen: --tourist-bottom-nav-space); back in the card from lg.
    expect(bar.className).toContain('fixed')
    expect(bar.className).toContain('bottom-[var(--tourist-bottom-nav-space)]')
    expect(bar.className).toContain('lg:static')
    // Buy Now is green below lg. Its classes must not contain the substring
    // "bg-white": the shared card rule (index.css) matches substrings and
    // repainted it near-white on every screen, hiding its white text (2026-11-10).
    const buyNow = within(bar).getByRole('button', { name: /Buy Now/ })
    expect(buyNow.className).toContain('bg-[#087F3F]')
    expect(buyNow.className).not.toContain('bg-white')

    // Two equal halves: icon group (left) and Buy Now (right).
    const halves = bar.firstElementChild!
    expect(halves.className).toContain('grid-cols-2')
    const [left, right] = Array.from(halves.children)
    expect(right).toBe(within(bar).getByRole('button', { name: 'Buy Now' }))
    expect(left!.className).toContain('grid-cols-3')

    const leftControls = within(left as HTMLElement)
    expect(leftControls.getByRole('link', { name: 'Restaurant: John Jobert Restaurant' })).toHaveAttribute('href', '/tourist/food/7')
    expect(leftControls.getByRole('link', { name: 'Chat with John Jobert Restaurant' })).toHaveAttribute('href', 'sms:+639123456789')
    expect(leftControls.getByRole('button', { name: 'Add to Cart' })).toBeInTheDocument()

    // Still exactly one of each order button on the page.
    expect(within(detailPage).getAllByRole('button', { name: 'Add to Cart' })).toHaveLength(1)
    expect(within(detailPage).getAllByRole('button', { name: 'Buy Now' })).toHaveLength(1)
  })

  it('disables Chat (with a reason) when the restaurant has no contact number', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    const chat = within(detailPage).getByRole('button', { name: /Chat unavailable/ })
    expect(chat).toBeDisabled()
    expect(chat).toHaveAttribute('title', 'This restaurant has not added a contact number yet')
  })
})

describe('tourist food item details — no section tabs', () => {
  it('has no Overview / Reviews / Restaurant jump tabs, but keeps the sections', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    expect(within(detailPage).queryByRole('navigation', { name: 'Food item sections' })).not.toBeInTheDocument()
    expect(within(detailPage).queryByRole('button', { name: 'Overview' })).not.toBeInTheDocument()
    expect(within(detailPage).queryByRole('button', { name: 'Restaurant' })).not.toBeInTheDocument()
    // Content the tabs pointed to is still on the page.
    expect(within(detailPage).getByText('Beef tapa with garlic rice and egg.')).toBeInTheDocument()
    expect(within(detailPage).getByText('Restaurant reviews')).toBeInTheDocument()
    expect(within(detailPage).getByText('View restaurant')).toBeInTheDocument()
  })
})

describe('tourist food item details — clean layout', () => {
  it('shows each fact once and puts the order card right after the summary', async () => {
    renderFoodPage()
    const detailPage = await openDetails()

    // The duplicate "About This Food" facts block is gone; each fact appears once.
    expect(within(detailPage).queryByRole('heading', { name: 'About This Food' })).not.toBeInTheDocument()
    expect(within(detailPage).getAllByText(/25 min preparation/)).toHaveLength(1)
    expect(within(detailPage).getAllByText('Filipino')).toHaveLength(1)
    expect(within(detailPage).getByText(/starts cooking once a rider accepts your order/)).toBeInTheDocument()

    // Reading order: name → order card → restaurant reviews (mobile shows them in this order).
    const name = within(detailPage).getByRole('heading', { level: 1, name: 'Tapsilog' })
    const order = within(detailPage).getByRole('heading', { name: 'Your order' })
    const reviews = within(detailPage).getByText('Restaurant reviews')
    expect(name.compareDocumentPosition(order) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(order.compareDocumentPosition(reviews) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
