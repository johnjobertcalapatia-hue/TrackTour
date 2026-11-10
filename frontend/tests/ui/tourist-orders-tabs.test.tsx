import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TouristOrders from '@/features/tourist/pages/TouristOrders'

const redirect = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('@/shared/utils/external-redirect', () => ({ openExternalPage: redirect.open }))

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  get: api.get,
  post: api.post,
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
  default: { get: api.get },
}))

type Tab = 'to_pay' | 'preparing' | 'in_transit' | 'to_receive' | 'to_review' | 'completed' | 'cancelled'

const section = (tab: Tab, over: Record<string, unknown> = {}) => ({
  key: `order-${tab}`,
  reference: `TT-${tab}`,
  primary_order_id: 40,
  placed_at: '2026-11-04T12:13:00+08:00',
  tab,
  status: 'waiting_restaurant',
  status_label: tab === 'in_transit' ? 'On the way' : 'Finding a rider',
  payment_method: 'gcash',
  payment_status: 'paid',
  items: [
    { id: 1, order_id: 40, name: 'Pork Sisig', image: 'menu-items/sisig.jpg', restaurant: 'Ekslusibo Grill', notes: null, quantity: 2, unit_price: 199, line_total: 398, status: 'pending' },
    { id: 2, order_id: 40, name: 'Iced Coffee', image: null, restaurant: 'Bansud Cafe', notes: 'Less ice', quantity: 1, unit_price: 150, line_total: 150, status: 'pending' },
  ],
  subtotal: 548,
  delivery_fee: 95,
  rider_tip: 0,
  total: 643,
  rated: false,
  rider: tab === 'in_transit' || tab === 'to_receive' || tab === 'to_review' ? { name: 'Rico Rider', photo: null } : null,
  ...over,
})

const COUNTS = { all: 5, to_pay: 1, preparing: 1, in_transit: 1, to_receive: 1, to_review: 1 }

function CurrentPath() {
  const { pathname, search } = useLocation()
  return <output data-testid="path">{pathname + search}</output>
}

function renderAt(path = '/tourist/orders') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/tourist/orders" element={<TouristOrders />} />
          <Route path="*" element={<div>Other page</div>} />
        </Routes>
        <CurrentPath />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  api.post.mockResolvedValue({})
  api.get.mockImplementation((_url: string, cfg: { params: { tab: string } }) => {
    const tab = cfg.params.tab
    const all = (['to_pay', 'preparing', 'in_transit', 'to_receive', 'to_review'] as Tab[]).map((t) => section(t))
    return Promise.resolve({ tab, counts: COUNTS, sections: tab === 'all' ? all : all.filter((s) => s.tab === tab) })
  })
})

describe('My Orders tabs', () => {
  it('has All / To Pay / Preparing / In Transit / To Receive / To Review tabs with counts', async () => {
    renderAt()
    const tabs = within(await screen.findByRole('tablist', { name: 'Order status' })).getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['All', 'To Pay1', 'Preparing1', 'In Transit1', 'To Receive1', 'To Review1'])
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true')
    // "All" lists every type of order.
    expect(await screen.findAllByRole('article')).toHaveLength(5)
  })

  it('lists each item individually in one section per order, with a single delivery fee', async () => {
    renderAt('/tourist/orders?tab=to_pay')
    const order = await screen.findByRole('article', { name: 'Order TT-to_pay' })
    const items = within(within(order).getByRole('list', { name: 'Items' })).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(within(items[0]!).getByText('Pork Sisig')).toBeInTheDocument()
    expect(within(items[0]!).getByText('Ekslusibo Grill')).toBeInTheDocument()
    expect(within(items[0]!).getByText('x2')).toBeInTheDocument()
    expect(within(items[0]!).getByText('₱398.00')).toBeInTheDocument()
    expect(items[0]!.querySelector('img')?.getAttribute('src')).toContain('/storage/menu-items/sisig.jpg')
    expect(within(items[1]!).getByText('Note: Less ice')).toBeInTheDocument()
    expect(within(order).getAllByText('Delivery fee')).toHaveLength(1)
    expect(within(order).getByText('₱95.00')).toBeInTheDocument()
    expect(within(order).getByText('₱643.00')).toBeInTheDocument()
    expect(within(order).getByRole('button', { name: /Complete payment/ })).toBeInTheDocument()
  })

  it('Complete payment opens the PayMongo GCash checkout for the order', async () => {
    redirect.open.mockReset()
    api.post.mockResolvedValue({ payment_number: 'PAY-1', checkout_url: 'https://checkout.paymongo.com/cs_test_1' })
    renderAt('/tourist/orders?tab=to_pay')
    const order = await screen.findByRole('article', { name: 'Order TT-to_pay' })
    await act(async () => { fireEvent.click(within(order).getByRole('button', { name: /Complete payment/ })) })

    expect(api.post).toHaveBeenCalledWith('/payments/create-intent', { payable_type: 'order', payable_id: 40, method: 'gcash' })
    await waitFor(() => expect(redirect.open).toHaveBeenCalledWith('https://checkout.paymongo.com/cs_test_1'))
    // While the browser leaves for PayMongo the button can't be pressed twice.
    expect(within(order).getByRole('button', { name: /Opening payment/ })).toBeDisabled()
  })

  it('a multi-restaurant checkout pays its group checkout as a whole', async () => {
    redirect.open.mockReset()
    api.get.mockResolvedValue({ tab: 'to_pay', counts: COUNTS, sections: [section('to_pay', { group_order_id: 7 })] })
    api.post.mockResolvedValue({ payment_number: 'PAY-2', checkout_url: 'https://checkout.paymongo.com/cs_test_2' })
    renderAt('/tourist/orders?tab=to_pay')
    const order = await screen.findByRole('article', { name: 'Order TT-to_pay' })
    await act(async () => { fireEvent.click(within(order).getByRole('button', { name: /Complete payment/ })) })

    expect(api.post).toHaveBeenCalledWith('/payments/create-intent', { payable_type: 'group_order', payable_id: 7, method: 'gcash' })
    await waitFor(() => expect(redirect.open).toHaveBeenCalledWith('https://checkout.paymongo.com/cs_test_2'))
  })

  it('shows the error and lets the tourist try again when the payment page cannot open', async () => {
    redirect.open.mockReset()
    api.post.mockRejectedValue(new Error('This order has already been paid.'))
    renderAt('/tourist/orders?tab=to_pay')
    const order = await screen.findByRole('article', { name: 'Order TT-to_pay' })
    await act(async () => { fireEvent.click(within(order).getByRole('button', { name: /Complete payment/ })) })

    expect(await within(order).findByRole('alert')).toHaveTextContent("Couldn't open the payment page")
    expect(redirect.open).not.toHaveBeenCalled()
    expect(within(order).getByRole('button', { name: /Complete payment/ })).toBeEnabled()
  })

  it('switching tabs loads that tab and keeps it in the URL', async () => {
    renderAt()
    await screen.findAllByRole('article')
    fireEvent.click(screen.getByRole('tab', { name: /In Transit/ }))

    expect(screen.getByTestId('path')).toHaveTextContent('/tourist/orders?tab=in_transit')
    await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/tourist/orders', { params: { tab: 'in_transit' } }))
    const order = await screen.findByRole('article', { name: 'Order TT-in_transit' })
    expect(within(order).getByText(/Rico Rider is on the way/)).toBeInTheDocument()
    expect(within(order).getByRole('link', { name: /Track rider on map/ })).toHaveAttribute('href', '/tourist/orders/40/progress')
  })

  it('To Receive: no tourist confirmation — the rider confirms delivery on arrival (reconciled 2026-11-08)', async () => {
    renderAt('/tourist/orders?tab=to_receive')
    const order = await screen.findByRole('article', { name: 'Order TT-to_receive' })

    expect(within(order).queryByRole('button', { name: /Order received/ })).not.toBeInTheDocument()
    expect(within(order).getByText('Your rider will confirm delivery on arrival')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalledWith('/tourist/food/order/40/confirm-delivery')
  })

  it('To Review: every dish has Buy again, Add to cart and Write review; the dish opens the order details', async () => {
    localStorage.clear()
    const sisig = { id: 1, order_id: 40, offering_id: 501, name: 'Pork Sisig', image: 'menu-items/sisig.jpg', restaurant: 'Ekslusibo Grill', business_id: 7, business_latitude: 12.86, business_longitude: 121.45, notes: null, quantity: 2, unit_price: 199, line_total: 398, status: 'ready', can_order: true, current_price: 210, reviewed: false, my_rating: null }
    const coffee = { ...sisig, id: 2, offering_id: 502, name: 'Iced Coffee', quantity: 1, unit_price: 150, line_total: 150, can_order: false, current_price: null, reviewed: true, my_rating: 4 }
    api.get.mockResolvedValue({ tab: 'to_review', counts: COUNTS, sections: [section('to_review', { items: [sisig, coffee] })] })
    renderAt('/tourist/orders?tab=to_review')

    const order = await screen.findByRole('article', { name: 'Order TT-to_review' })
    const rows = within(within(order).getByRole('list', { name: 'Items' })).getAllByRole('listitem')
    // Photo / name / details → order details page.
    expect(within(rows[0]!).getByRole('link', { name: 'Pork Sisig, view details' })).toHaveAttribute('href', '/tourist/orders/40/details')
    expect(within(rows[0]!).getByText('x2')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('₱398.00')).toBeInTheDocument()

    const actions = within(within(rows[0]!).getByRole('group', { name: 'Actions for Pork Sisig' }))
    expect(actions.getByRole('link', { name: /Write review/ })).toHaveAttribute('href', '/tourist/orders/40/items/1/review')

    // Add to cart: one, at today's menu price.
    fireEvent.click(actions.getByRole('button', { name: /Add to cart/ }))
    expect(JSON.parse(localStorage.getItem('food_cart') ?? '[]')).toEqual([expect.objectContaining({ id: 501, price: 210, quantity: 1, business_id: 7 })])
    expect(actions.getByRole('button', { name: /Added/ })).toBeInTheDocument()

    // Already reviewed / no longer on the menu.
    const coffeeActions = within(within(rows[1]!).getByRole('group', { name: 'Actions for Iced Coffee' }))
    expect(coffeeActions.getByRole('link', { name: /Edit review/ })).toBeInTheDocument()
    expect(coffeeActions.getByRole('button', { name: /Buy again/ })).toBeDisabled()
    expect(within(rows[1]!).getByText('No longer on the menu')).toBeInTheDocument()

    // Buy again: the same quantity into the cart, then checkout.
    fireEvent.click(actions.getByRole('button', { name: /Buy again/ }))
    expect(JSON.parse(localStorage.getItem('food_cart') ?? '[]')).toEqual([expect.objectContaining({ id: 501, quantity: 3 })])
    expect(screen.getByTestId('path')).toHaveTextContent('/tourist/food/cart')
  })

  it('empty tab: "No related orders", then popular dish cards (rating, sold, price) that open the dish', async () => {
    localStorage.clear()
    const dish = (id: number, name: string) => ({
      id, name, description: null, category: 'Grill', image: null, price: 199, business_name: 'Ekslusibo Grill', business_id: 7,
      business_latitude: 12.8, business_longitude: 121.4, rating: null, is_open: true, is_accepting_orders: true, availability: 'available', open_status: null,
    })
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/tourist/food'
      ? { data: [
        { ...dish(501, 'Chicken BBQ'), sold_count: 128, food_rating: 4.6, food_rating_count: 23 },
        { ...dish(502, 'Pork Sisig'), sold_count: 0, food_rating: null, food_rating_count: 0 },
      ] }
      : { tab: 'to_pay', counts: { ...COUNTS, to_pay: 0 }, sections: [] }))
    renderAt('/tourist/orders?tab=to_pay')

    expect(await screen.findByText('No related orders')).toBeInTheDocument()
    expect(screen.getByText('Start exploring for food to eat')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Explore food' })).toHaveAttribute('href', '/tourist/food')

    // Below the message: dish cards with photo, name, info, the dish's real stars, sold count and price.
    const suggestions = within(await screen.findByRole('region', { name: 'Popular dishes' }))
    expect(api.get).toHaveBeenCalledWith('/tourist/food', { params: { sort: 'popular', page: 1 } })
    const bbq = suggestions.getByRole('link', { name: 'Chicken BBQ, ₱199.00' })
    expect(within(bbq).getByText('Ekslusibo Grill · Grill')).toBeInTheDocument()
    expect(within(bbq).getByLabelText('Rated 4.6 out of 5 from 23 reviews')).toBeInTheDocument()
    expect(within(bbq).getByText('128 sold')).toBeInTheDocument()
    expect(within(bbq).getByText('₱199.00')).toBeInTheDocument()
    // No invented numbers for a dish without ratings or sales.
    const sisig = suggestions.getByRole('link', { name: 'Pork Sisig, ₱199.00' })
    expect(within(sisig).getByText('No ratings yet')).toBeInTheDocument()
    expect(within(sisig).queryByText(/sold/)).not.toBeInTheDocument()
    // No cart / checkout buttons; the card opens the food item page.
    expect(suggestions.queryByRole('button', { name: /Add to Cart|Buy Now|Checkout/ })).not.toBeInTheDocument()
    expect(sisig).toHaveAttribute('href', '/tourist/food/item/502')
    fireEvent.click(sisig)
    expect(screen.getByTestId('path')).toHaveTextContent('/tourist/food/item/502')
  })

  it('shows ALL dishes: every page, not just the first few', async () => {
    const make = (id: number) => ({ id, name: 'Dish ' + id, description: null, category: 'Grill', image: null, price: 100 + id, business_name: 'Ekslusibo Grill', business_id: 7, business_latitude: null, business_longitude: null, rating: null, is_open: true, is_accepting_orders: true, availability: 'available', open_status: null, sold_count: 0, food_rating: null, food_rating_count: 0 })
    api.get.mockImplementation((url: string, cfg?: { params?: { page?: number; tab?: string } }) => {
      if (url !== '/tourist/food') return Promise.resolve({ tab: cfg?.params?.tab, counts: COUNTS, sections: [] })
      const page = cfg?.params?.page ?? 1
      const ids = page === 1 ? Array.from({ length: 12 }, (_, i) => i + 1) : [13, 14, 15]
      return Promise.resolve({ data: ids.map(make), meta: { current_page: page, last_page: 2, total: 15 } })
    })
    renderAt('/tourist/orders?tab=to_pay')

    const dishes = await screen.findByRole('region', { name: 'Popular dishes' })
    expect(within(dishes).getAllByRole('link')).toHaveLength(12) // whole first page (no 8-card cap)
    await act(async () => { fireEvent.click(within(dishes).getByRole('button', { name: 'Show more dishes' })) })

    await waitFor(() => expect(within(dishes).getAllByRole('link')).toHaveLength(15))
    expect(within(dishes).getByRole('link', { name: 'Dish 15, ₱115.00' })).toBeInTheDocument()
    expect(within(dishes).queryByRole('button', { name: 'Show more dishes' })).not.toBeInTheDocument()
  })

  it('every tab shows the dish cards below its orders', async () => {
    api.get.mockImplementation((url: string, cfg?: { params?: { tab?: string } }) => Promise.resolve(url === '/tourist/food'
      ? { data: [{ id: 501, name: 'Chicken BBQ', description: null, category: 'Grill', image: null, price: 199, business_name: 'Ekslusibo Grill', business_id: 7, business_latitude: null, business_longitude: null, rating: null, is_open: true, is_accepting_orders: true, availability: 'available', open_status: null, sold_count: 3, food_rating: null, food_rating_count: 0 }] }
      : { tab: cfg?.params?.tab, counts: COUNTS, sections: [section('preparing')] }))

    for (const path of ['/tourist/orders', '/tourist/orders?tab=preparing']) {
      const view = renderAt(path)
      const order = await screen.findByRole('article', { name: 'Order TT-preparing' })
      const dishes = await screen.findByRole('region', { name: 'Popular dishes' })
      expect(order.compareDocumentPosition(dishes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(within(dishes).getByRole('link', { name: 'Chicken BBQ, ₱199.00' })).toBeInTheDocument()
      view.unmount()
    }
  })

  it('COD orders show in To Pay with the cash amount, and keep their progress actions', async () => {
    const cod = section('preparing', { key: 'order-cod', reference: 'TT-COD', payment_method: 'cash', payment_status: 'pending', cod_due: true, tabs: ['preparing', 'to_pay'] })
    api.get.mockResolvedValue({ tab: 'to_pay', counts: { ...COUNTS, to_pay: 1 }, sections: [cod] })
    renderAt('/tourist/orders?tab=to_pay')

    const order = await screen.findByRole('article', { name: 'Order TT-COD' })
    expect(within(order).getByText('Cash on delivery')).toBeInTheDocument()
    expect(within(order).getByText(/in cash to your rider when your order arrives/)).toHaveTextContent('Pay ₱643.00 in cash')
    expect(within(order).queryByRole('button', { name: /Complete payment/ })).not.toBeInTheDocument()
    expect(within(order).getByRole('link', { name: 'View progress' })).toHaveAttribute('href', '/tourist/orders/40/progress')
  })
})
