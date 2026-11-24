import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Promotions Part A (dish sales), frontend: the sale price display, the cart
 * refreshing its prices and sending the price it showed, and the owner's sale
 * form. The server decides every price; these pages only show it.
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  ...api,
  API_BASE_URL: 'http://localhost/api',
  apiErrorMessage: (_e: unknown, fallback: string) => fallback,
}))
vi.mock('@/shared/services/payment', () => ({ createCheckoutSession: vi.fn(), getPaymentStatus: vi.fn(), checkAndConfirmPayment: vi.fn(), refundPayment: vi.fn() }))
vi.mock('@/shared/services/pending-action', () => ({ savePendingAction: vi.fn() }))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: () => null,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn(), flyTo: vi.fn() }),
  useMapEvents: () => null,
}))
vi.mock('@/shared/utils/pin-icon', () => ({ userPinIcon: {}, pinIcon: () => ({}), checkoutPinIcon: {} }))

import { SalePrice } from '@/shared/components/SalePrice'
import TouristFoodCart from '@/features/tourist/pages/TouristFoodCart'
import BusinessOwnerSaleForm from '@/features/business-owner/pages/BusinessOwnerSaleForm'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'
import type { User } from '@/shared/types'

const SALE = { id: 3, title: 'Weekend Sale', label: '25% off', ends_at: '2026-11-29T15:59:59Z' }

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })

describe('SalePrice', () => {
  it('shows the price paid, the struck menu price and the sale chip', () => {
    render(<SalePrice price={150} original_price={200} sale={SALE} />)
    expect(screen.getByText('25% off')).toBeInTheDocument()
    expect(screen.getByText('was', { exact: false }).closest('s')).toHaveTextContent('₱200.00')
    expect(screen.getByText('Sale price', { exact: false }).parentElement).toHaveTextContent('₱150.00')
  })

  it('shows just the price without a sale', () => {
    const { container } = render(<SalePrice price={90} original_price={null} sale={null} />)
    expect(container).toHaveTextContent('₱90.00')
    expect(container.querySelector('s')).toBeNull()
  })
})

describe('cart: dish sale prices', () => {
  const TOURIST: User = { id: 9, name: 'T', email: 't@test.com', role: 'tourist', account_status: 'approved', email_verified_at: null, created_at: '', updated_at: '' }

  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: TOURIST, loading: false })
    localStorage.setItem('auth_token', 'x')
    // Added before the sale started (₱200), plus a variation line priced by the item page.
    localStorage.setItem('food_cart', JSON.stringify([
      { id: 501, name: 'Sisig', price: 200, image: null, business_name: 'Ekslusibo Grill', business_id: 5, quantity: 2 },
      { id: 502, name: 'Adobo (Large)', price: 180, image: null, business_name: 'Ekslusibo Grill', business_id: 5, quantity: 1 },
    ]))
    api.get.mockResolvedValue({})
    api.post.mockImplementation(async (url: string) => {
      if (url.includes('/tourist/food/availability')) {
        return {
          restaurants: { 5: { is_accepting_orders: true, availability: 'available', open_status: { status: 'open', label: 'Open' }, business_name: 'Ekslusibo Grill' } },
          prices: {
            501: { name: 'Sisig', price: 150, original_price: 200, sale: SALE },
            502: { name: 'Adobo', price: 160, original_price: null, sale: null },
          },
        }
      }
      if (url.includes('/tourist/food/order')) return { order: { id: 99, order_number: 'TT-1' } }
      return {}
    })
  })

  afterEach(() => {
    localStorage.removeItem('food_cart')
    localStorage.removeItem('auth_token')
    useAuthStore.setState({ user: null, loading: false })
  })

  it('updates a stale price, says so, and sends the price it showed', async () => {
    render(
      <QueryClientProvider client={client()}>
        <MemoryRouter initialEntries={['/tourist/food/cart']}><TouristFoodCart /></MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('status')).toHaveTextContent('Prices updated: Sisig is now ₱150.00 (25% off).')
    expect(JSON.parse(localStorage.getItem('food_cart')!)[0].price).toBe(150)
    expect(JSON.parse(localStorage.getItem('food_cart')!)[1].price).toBe(180) // variation line untouched
    expect(screen.getAllByText('25% off').length).toBeGreaterThan(0)
    const availability = api.post.mock.calls.find(([u]) => String(u).includes('/availability'))!
    expect(availability[1]).toMatchObject({ offering_ids: [501, 502] })

    fireEvent.click(screen.getByRole('button', { name: /Pickup/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Pay with GCash/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }))

    await waitFor(() => expect(api.post.mock.calls.some(([u]) => String(u).includes('/tourist/food/order'))).toBe(true))
    const [, payload] = api.post.mock.calls.find(([u]) => String(u).includes('/tourist/food/order'))!
    expect(payload.items).toEqual([
      { offering_id: 501, quantity: 2, notes: null, expected_unit_price: 150 },
      { offering_id: 502, quantity: 1, notes: null }, // a variation line is priced by the server alone
    ])
  })
})

describe('owner sale form', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useBusinessOwnerStore.setState({ businesses: [{ id: 7, name: 'Ekslusibo Grill', category: 'Restaurant', status: 'approved', logo: null }], selectedBusinessId: 7 })
    api.get.mockImplementation(async (url: string) => (url.includes('/dish-sales/dishes') ? [
      { id: 1, name: 'Sisig', price: 200, image: null, is_available: true, sales: [] },
      { id: 2, name: 'Halo-halo', price: 90, image: null, is_available: true, sales: [{ id: 8, title: 'Summer', starts_at: '2026-11-20T00:00:00Z', ends_at: '2099-01-01T00:00:00Z' }] },
    ] : []))
    api.post.mockResolvedValue({ id: 10 })
  })

  const renderForm = () => render(
    <QueryClientProvider client={client()}>
      <MemoryRouter initialEntries={['/business-owner/promotions/sales/new']}>
        <Routes>
          <Route path="/business-owner/promotions/sales/new" element={<BusinessOwnerSaleForm />} />
          <Route path="/business-owner/promotions" element={<p>Promotions list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  it('previews sale prices, blocks a dish already in another sale, and sends the chosen dishes', async () => {
    renderForm()
    const dishes = await screen.findByRole('list', { name: 'Dishes' })
    fireEvent.change(screen.getByLabelText('Sale title'), { target: { value: 'Weekend Sale' } })
    fireEvent.change(screen.getByLabelText('Percent off'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2099-12-31' } })

    const halo = within(dishes).getByRole('checkbox', { name: /Halo-halo/ })
    expect(halo).toBeDisabled()
    expect(within(dishes).getByText(/In “Summer” until/)).toBeInTheDocument()

    fireEvent.click(within(dishes).getByRole('checkbox', { name: /Sisig/ }))
    expect(within(dishes).getByText('₱150.00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create sale' }))
    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(api.post).toHaveBeenCalledWith('/business-owner/dish-sales', expect.objectContaining({
      business_id: 7, title: 'Weekend Sale', discount_type: 'percentage', discount_value: 25, ends_at: '2099-12-31', offering_ids: [1],
    }))
    expect(await screen.findByText('Promotions list')).toBeInTheDocument()
  })

  it('refuses a free dish and a 100% sale before sending', async () => {
    renderForm()
    const dishes = await screen.findByRole('list', { name: 'Dishes' })
    fireEvent.change(screen.getByLabelText('Sale title'), { target: { value: 'Too much' } })
    fireEvent.change(screen.getByLabelText('Last day'), { target: { value: '2099-12-31' } })
    fireEvent.click(within(dishes).getByRole('checkbox', { name: /Sisig/ }))

    fireEvent.change(screen.getByLabelText('Percent off'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create sale' }))
    expect(await screen.findByText('A percentage sale must be below 100%.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: '₱ off' }))
    fireEvent.change(screen.getByLabelText('Pesos off'), { target: { value: '200' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create sale' }))
    expect(await screen.findByText('Sisig would cost ₱0 or less.')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })
})
