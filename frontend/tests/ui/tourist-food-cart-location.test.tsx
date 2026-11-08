import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouristFoodCart from '@/features/tourist/pages/TouristFoodCart'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}))

const geolocationMock = vi.hoisted(() => ({
  getCurrentPosition: vi.fn(),
}))

const mapEventsMock = vi.hoisted(() => ({
  click: null as null | ((event: { latlng: { lat: number; lng: number } }) => void),
}))

vi.mock('@/shared/services/api', () => apiMock)
vi.mock('@/shared/services/payment', () => ({ createCheckoutSession: vi.fn() }))
vi.mock('@/shared/services/pending-action', () => ({ savePendingAction: vi.fn() }))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>
      <button
        type="button"
        data-testid="map-click"
        onClick={() => mapEventsMock.click?.({ latlng: { lat: 12.97, lng: 121.47 } })}
      >
        Set pin
      </button>
      {children}
    </div>
  ),
  TileLayer: ({ url }: { url: string }) => <div data-testid="map-tiles" data-url={url} />,
  Marker: ({
    draggable,
    eventHandlers,
  }: {
    draggable?: boolean
    eventHandlers?: {
      dragend?: (event: { target: { getLatLng: () => { lat: number; lng: number } } }) => void
    }
  }) => draggable ? (
    <button
      type="button"
      data-testid="delivery-marker"
      onClick={() => eventHandlers?.dragend?.({ target: { getLatLng: () => ({ lat: 12.97, lng: 121.47 }) } })}
    >
      Drag marker
    </button>
  ) : null,
  useMap: () => ({ setView: vi.fn() }),
  useMapEvents: (handlers: { click?: (event: { latlng: { lat: number; lng: number } }) => void }) => {
    mapEventsMock.click = handlers.click ?? null
    return null
  },
}))
vi.mock('@/shared/utils/pin-icon', () => ({ checkoutPinIcon: {} }))

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

function renderCart() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tourist/food/cart']}>
        <TouristFoodCart />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function stubReverseGeocode() {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      display_name: 'Kawit, Gloria, Oriental Mindoro',
      name: 'Kawit',
      address: { village: 'Kawit', municipality: 'Gloria' },
    }),
  })))
}

describe('tourist food checkout location confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: TOURIST, loading: false })
    localStorage.setItem('food_cart', JSON.stringify([CART_ITEM]))
    apiMock.get.mockResolvedValue([{ id: 4, name: 'Gloria' }])
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
      if (url.includes('/tourist/food/delivery-fee')) {
        return {
          delivery_fee: 40,
          distance_km: 1,
          estimated_duration_minutes: 10,
          base_fare: 40,
          distance_charge: 0,
          service_adjustment: 0,
          is_estimated: false,
        }
      }
      return {}
    })
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: geolocationMock,
    })
    stubReverseGeocode()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.removeItem('food_cart')
    useAuthStore.setState({ user: null, loading: false })
  })

  it('opens the item information page when the cart item is clicked, but not from its quantity or remove controls', async () => {
    renderCart()

    const link = await screen.findByRole('link', { name: 'View Tapsilog' })
    expect(link).toHaveAttribute('href', '/tourist/food/item/501')
    // The whole summary (photo, name, restaurant, price) is the link.
    expect(link).toHaveTextContent('Tapsilog')
    expect(link).toHaveTextContent('John Jobert Restaurant')
    expect(link).toHaveTextContent('₱120.00')

    // Quantity / remove buttons are not inside the link.
    const row = link.parentElement as HTMLElement
    const buttons = Array.from(row.querySelectorAll('button'))
    expect(buttons.length).toBeGreaterThanOrEqual(3)
    buttons.forEach((b) => expect(link.contains(b)).toBe(false))
  })

  it('switches between street and satellite checkout maps', async () => {
    renderCart()
    await screen.findAllByText('John Jobert Restaurant')

    expect(screen.getByTestId('map-tiles').getAttribute('data-url'))
      .toBe('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
    expect(screen.getByText('© OpenStreetMap contributors')).toBeTruthy()
    const mapLayersButton = screen.getByRole('button', { name: 'Map layers' })
    expect(mapLayersButton.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(mapLayersButton)
    expect(screen.getByRole('menu', { name: 'Map type options' })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'Street map' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Satellite map' }))

    expect(screen.getByTestId('map-tiles').getAttribute('data-url'))
      .toBe('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}')
    expect(screen.getByText('Imagery © Esri')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Map layers' }).getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(screen.getByRole('button', { name: 'Map layers' }))
    expect(screen.getByRole('menuitemradio', { name: 'Satellite map' }).getAttribute('aria-checked')).toBe('true')
  })

  it('flags GPS accuracy above 50 m and requires explicit location confirmation before checkout', async () => {
    geolocationMock.getCurrentPosition.mockImplementation((success: (position: unknown) => void) => {
      success({ coords: { latitude: 12.97, longitude: 121.47, accuracy: 80 } })
    })

    renderCart()
    await screen.findAllByText('John Jobert Restaurant')
    fireEvent.click(screen.getByTitle('Use my current location'))

    expect(await screen.findByText(/GPS accuracy is over 50 m/)).toBeTruthy()
    expect(await screen.findByText(/Approximate service-area match: Gloria/)).toBeTruthy()

    const confirmButton = await screen.findByRole('button', { name: 'Confirm location manually' })
    const checkoutButton = screen.getByRole('button', { name: /Pay with GCash/ })
    expect(checkoutButton).toBeDisabled()

    fireEvent.click(confirmButton)
    await waitFor(() => expect(checkoutButton).not.toBeDisabled())
  })

  it('treats a GPS reading without accuracy data as low accuracy', async () => {
    geolocationMock.getCurrentPosition.mockImplementation((success: (position: unknown) => void) => {
      success({ coords: { latitude: 12.97, longitude: 121.47 } })
    })

    renderCart()
    await screen.findAllByText('John Jobert Restaurant')
    fireEvent.click(screen.getByTitle('Use my current location'))

    expect(await screen.findByText(/GPS accuracy is unavailable/)).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Confirm location manually' })).toBeTruthy()
  })

  it('keeps an adjusted pin selected when a pending GPS reading returns later', async () => {
    let resolveGps: ((position: unknown) => void) | undefined
    geolocationMock.getCurrentPosition.mockImplementation((success: (position: unknown) => void) => {
      resolveGps = success
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/search?')) {
        return {
          ok: true,
          json: async () => [{
            lat: '12.97',
            lon: '121.47',
            name: 'Kawit',
            address: { village: 'Kawit', municipality: 'Gloria' },
          }],
        }
      }
      return {
        ok: true,
        json: async () => ({
          display_name: 'Kawit, Gloria, Oriental Mindoro',
          name: 'Kawit',
          address: { village: 'Kawit', municipality: 'Gloria' },
        }),
      }
    }))

    renderCart()
    await screen.findAllByText('John Jobert Restaurant')
    fireEvent.click(screen.getByTitle('Use my current location'))
    fireEvent.change(screen.getByPlaceholderText('Search address...'), { target: { value: 'Kawit, Gloria' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('Search result — review the pin')).toBeTruthy()
    resolveGps?.({ coords: { latitude: 12.8, longitude: 121.2, accuracy: 5 } })

    await waitFor(() => {
      expect(screen.getByText('Search result — review the pin')).toBeTruthy()
      expect(screen.queryByText('GPS-detected location')).toBeNull()
    })
  })

  it('allows the marker to be dragged and requires confirmation again after an address correction', async () => {
    geolocationMock.getCurrentPosition.mockImplementation((success: (position: unknown) => void) => {
      success({ coords: { latitude: 12.97, longitude: 121.47, accuracy: 50 } })
    })

    renderCart()
    await screen.findAllByText('John Jobert Restaurant')
    fireEvent.click(screen.getByTitle('Use my current location'))

    expect(await screen.findByText(/GPS accuracy is within the 50 m guideline/)).toBeTruthy()
    await screen.findByRole('button', { name: 'Confirm delivery location' })
    fireEvent.click(screen.getByTestId('delivery-marker'))

    expect(await screen.findByText('Manually adjusted map pin')).toBeTruthy()
    const addressField = screen.getByPlaceholderText('Enter your barangay and complete delivery address...')
    fireEvent.change(addressField, { target: { value: 'House 10, Kawit, Gloria' } })

    expect(screen.getByText('Address text was edited manually; the map pin remains unchanged.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Confirm delivery location' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Pay with GCash/ })).toBeDisabled()
  })

  it('does not replace a manually placed pin when an earlier GPS request completes afterward', async () => {
    let resolveGps: ((position: unknown) => void) | undefined
    geolocationMock.getCurrentPosition.mockImplementation((success: (position: unknown) => void) => {
      resolveGps = success
    })

    renderCart()
    await screen.findAllByText('John Jobert Restaurant')
    fireEvent.click(screen.getByTitle('Use my current location'))
    fireEvent.click(screen.getByTestId('map-click'))
    expect(await screen.findByText('Manually adjusted map pin')).toBeTruthy()

    resolveGps?.({ coords: { latitude: 12.8, longitude: 121.2, accuracy: 5 } })

    await waitFor(() => {
      expect(screen.getByText('Manually adjusted map pin')).toBeTruthy()
      expect(screen.queryByText('GPS-detected location')).toBeNull()
    })
  })
})
