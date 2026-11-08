import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouristSidebar from '@/features/tourist/components/layout/TouristSidebar'
import { get } from '@/shared/services/api'

vi.mock('@/shared/services/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  default: { get: vi.fn() },
}))

vi.mock('@/features/auth/services/auth-store', () => {
  const state = { user: { role: 'tourist', name: 'Test Tourist' }, token: 't', logout: () => {} }
  return { useAuthStore: (selector?: (v: typeof state) => unknown) => (selector ? selector(state) : state) }
})

const mockGet = vi.mocked(get)

function setGeolocation(impl: Geolocation['getCurrentPosition'] | null) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: impl ? { getCurrentPosition: impl } : undefined,
  })
}

const grant = (lat: number, lng: number): Geolocation['getCurrentPosition'] =>
  (ok) => ok({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition)

const renderSidebar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><TouristSidebar /></MemoryRouter>
    </QueryClientProvider>,
  )

/** Route the API mock: locate returns `here`, photos returns `photos`. */
const api = (here: unknown, photos: unknown[] = []) =>
  mockGet.mockImplementation(((url: string) =>
    Promise.resolve(url === '/municipalities/locate' ? here : url.endsWith('/photos') ? photos : null)) as never)
const promo = () => screen.getByRole('link', { name: /^Discover / })

describe('Sidebar "Discover <municipality>" card', () => {
  beforeEach(() => { sessionStorage.clear(); mockGet.mockReset() })
  afterEach(() => setGeolocation(null))

  it('shows the municipality the tourist is currently in and links to it', async () => {
    setGeolocation(grant(12.75, 121.49))
    api({ id: 2, name: 'Bongabong', province: 'Oriental Mindoro' }, [{ src: '/storage/municipalities/bongabong.jpg', caption: 'Bongabong', kind: 'municipality' }])

    renderSidebar()

    await waitFor(() => expect(screen.getByTestId('promo-place')).toHaveTextContent('Bongabong'))
    expect(mockGet).toHaveBeenCalledWith('/municipalities/locate', { params: { lat: 12.75, lng: 121.49 } })
    expect(promo()).toHaveAccessibleName('Discover Bongabong: explore, order, travel')
    expect(promo()).toHaveAttribute('href', '/tourist/municipality/2')
    expect(screen.getByText('Explore. Order. Travel.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('promo-photo').getAttribute('src')).toContain('/storage/municipalities/bongabong.jpg'))
    expect(mockGet).toHaveBeenCalledWith('/municipalities/2/photos')
  })

  it('shows an empty photo container when the municipality has no photos yet', async () => {
    setGeolocation(grant(12.97, 121.47))
    api({ id: 4, name: 'Gloria' }, [])

    renderSidebar()

    await waitFor(() => expect(screen.getByTestId('promo-place')).toHaveTextContent('Gloria'))
    expect(screen.getByTestId('promo-photo-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('promo-photo')).not.toBeInTheDocument()
  })

  it('falls back to Bansud when location is denied, without calling the API', () => {
    setGeolocation((_ok, fail) => fail?.({ code: 1 } as GeolocationPositionError))

    renderSidebar()

    expect(screen.getByTestId('promo-place')).toHaveTextContent('Bansud')
    expect(promo()).toHaveAttribute('href', '/tourist/explore')
    expect(screen.getByTestId('promo-photo')).toHaveAttribute('src', '/assets/tourism/discover-bansud.png')
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('falls back to Bansud outside the covered municipalities', async () => {
    setGeolocation(grant(14.6, 120.98))
    api(null)

    renderSidebar()

    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    expect(screen.getByTestId('promo-place')).toHaveTextContent('Bansud')
  })

  it('reuses the cached result across page changes instead of re-locating', async () => {
    const locate = vi.fn(grant(12.75, 121.49))
    setGeolocation(locate)
    api({ id: 2, name: 'Bongabong' })

    const first = renderSidebar()
    await waitFor(() => expect(screen.getByTestId('promo-place')).toHaveTextContent('Bongabong'))
    first.unmount()

    renderSidebar()
    expect(screen.getByTestId('promo-place')).toHaveTextContent('Bongabong')
    expect(locate).toHaveBeenCalledTimes(1)
    expect(mockGet.mock.calls.filter(([u]) => u === '/municipalities/locate')).toHaveLength(1)
  })
})
