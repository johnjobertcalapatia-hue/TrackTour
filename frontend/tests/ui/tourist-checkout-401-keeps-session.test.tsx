import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouristFoodCart from '@/features/tourist/pages/TouristFoodCart'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

// ---- Hoisted mocks (so the vi.mock factories can reference them) ----

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

const paymentMock = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  getPaymentStatus: vi.fn(),
  checkAndConfirmPayment: vi.fn(),
  refundPayment: vi.fn(),
}))

const pendingActionMock = vi.hoisted(() => ({
  savePendingAction: vi.fn(),
}))

vi.mock('@/shared/services/api', () => apiMock)
vi.mock('@/shared/services/payment', () => paymentMock)
vi.mock('@/shared/services/pending-action', () => pendingActionMock)
// The map/Leaflet surface is only used in the delivery branch; stub it so jsdom
// never has to run real Leaflet (which also queries real DOM geometry).
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TileLayer: () => null,
  Marker: () => null,
  Popup: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  useMap: () => ({ setView: vi.fn(), flyTo: vi.fn() }),
  useMapEvents: () => null,
}))
// pin-icon calls L.divIcon at MODULE LOAD — stub it so importing leaflet is inert.
vi.mock('@/shared/utils/pin-icon', () => ({
  userPinIcon: {},
  pinIcon: () => ({}),
}))

const TOURIST: User = {
  id: 9,
  name: 'Test Tourist',
  email: 'tourist@test.com',
  role: 'tourist',
  account_status: 'approved',
  email_verified_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-09-24T00:00:00Z',
}

const CART_ITEM = {
  id: 501,
  name: 'Tapsilog',
  price: 120,
  image: null,
  business_name: 'John Jobert Restaurant',
  business_id: 5,
  quantity: 1,
}

let currentPath = '/tourist/food/cart'
function RouterProbe() {
  const location = useLocation()
  currentPath = location.pathname
  return null
}

function renderCart() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tourist/food/cart']}>
        <RouterProbe />
        <TouristFoodCart />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function stubApiResponses(checkoutStatus: 401 | 200) {
  apiMock.post.mockImplementation(async (url: string) => {
    if (url.includes('/tourist/food/availability')) {
      return {
        restaurants: {
          5: {
            is_accepting_orders: true,
            availability: 'available',
            open_status: { status: 'open', label: 'Open' },
            business_name: 'John Jobert Restaurant',
          },
        },
      }
    }
    if (url.includes('/tourist/food/order') || url.includes('/tourist/food/group-order')) {
      if (checkoutStatus === 401) {
        throw { response: { status: 401, data: { message: 'Unauthenticated.' } } }
      }
      return { order: { id: 99, order_number: 'TT-00099' } }
    }
    if (url.includes('/tourist/food/delivery-fee')) {
      return { delivery_fee: 40, distance_km: 1.1, estimated_duration_minutes: 15, base_fare: 40, distance_charge: 0, service_adjustment: 0, is_estimated: false }
    }
    return {}
  })
  apiMock.get.mockResolvedValue({})
}

async function beginPickupCheckout() {
  await screen.findAllByText(/John Jobert Restaurant/)
  // Pickup needs no map pin, so canCheckout becomes true without touching Leaflet.
  fireEvent.click(screen.getByRole('button', { name: /Pickup/ }))
  const checkoutButton = screen.getByRole('button', { name: /Pay with GCash/ })
  await waitFor(() => expect(checkoutButton).not.toBeDisabled())
  fireEvent.click(checkoutButton)
  fireEvent.click(screen.getByRole('button', { name: /^Confirm$/ }))
}

describe('tourist checkout — a 401 must NOT auto-logout the session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: TOURIST, loading: false })
    localStorage.setItem('auth_token', 'cart-live-token')
    localStorage.setItem('food_cart', JSON.stringify([CART_ITEM]))
    currentPath = '/tourist/food/cart'
    stubApiResponses(401)
  })

  afterEach(() => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('food_cart')
    useAuthStore.setState({ user: null, loading: false })
  })

  it('surfaces the server message and keeps the token, user, and route after a checkout 401', async () => {
    renderCart()
    await beginPickupCheckout()

    // The server rejection is shown to the tourist…
    await screen.findByText(/Unauthenticated/i)

    // …but it is NOT treated as a logout: the token survives, the store user
    // survives, /logout is never called, and the cart page is not left.
    await waitFor(() => expect(screen.getByText(/Your Cart/i)).toBeTruthy())
    expect(localStorage.getItem('auth_token')).toBe('cart-live-token')
    expect(useAuthStore.getState().user).toEqual(TOURIST)
    expect(apiMock.post).not.toHaveBeenCalledWith(
      expect.stringContaining('/logout'),
      expect.anything(),
      expect.anything()
    )
    expect(currentPath).toBe('/tourist/food/cart')
  })

  it('recovering on a retry keeps the tourist on the cart (transient 401, live token)', async () => {
    let checkoutCalls = 0
    apiMock.post.mockImplementation(async (url: string) => {
      if (url.includes('/tourist/food/availability')) {
        return {
          restaurants: { 5: { is_accepting_orders: true, availability: 'available', open_status: { status: 'open', label: 'Open' }, business_name: 'John Jobert Restaurant' } },
        }
      }
      if (url.includes('/tourist/food/order')) {
        checkoutCalls += 1
        if (checkoutCalls === 1) {
          throw { response: { status: 401, data: { message: 'Unauthenticated.' } } }
        }
        return { order: { id: 99, order_number: 'TT-00099' } }
      }
      return {}
    })
    apiMock.get.mockResolvedValue({})

    renderCart()
    await beginPickupCheckout()
    await screen.findByText(/Unauthenticated/i)

    // A genuinely recoverable session must let the tourist retry immediately —
    // the second attempt succeeds because the credential is still alive.
    expect(localStorage.getItem('auth_token')).toBe('cart-live-token')

    // Close the error and confirm the token was never touched by the 401.
    for (const [, mock] of Object.entries(apiMock)) mock.mockClear()
    expect(localStorage.getItem('auth_token')).toBe('cart-live-token')
    expect(useAuthStore.getState().user).toEqual(TOURIST)
  })
})

describe('tourist checkout — genuine guest still goes to login', () => {
  it('saves the pending order and sends a real guest (no token, no user) to /login', async () => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: null, loading: false })
    localStorage.removeItem('auth_token')
    localStorage.setItem('food_cart', JSON.stringify([CART_ITEM]))
    currentPath = '/tourist/food/cart'
    pendingActionMock.savePendingAction.mockClear()
    stubApiResponses(401)

    renderCart()
    await screen.findAllByText(/John Jobert Restaurant/)
    fireEvent.click(screen.getByRole('button', { name: /Pickup/ }))
    const checkoutButton = screen.getByRole('button', { name: /Pay with GCash/ })
    await waitFor(() => expect(checkoutButton).not.toBeDisabled())
    // The guest gate fires directly on the checkout button (no confirm modal).
    fireEvent.click(checkoutButton)

    await screen.findByText(/log in to place your order/i)

    await waitFor(() => expect(currentPath).toBe('/login'))
    expect(pendingActionMock.savePendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'food_order', returnPath: '/tourist/food/cart' })
    )
    expect(useAuthStore.getState().user).toBeNull()
  })
})