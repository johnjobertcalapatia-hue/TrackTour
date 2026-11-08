import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TouristExploreMap from '@/features/tourist/pages/TouristExploreMap'

const api = vi.hoisted(() => ({ get: vi.fn() }))
const map = vi.hoisted(() => ({ setView: vi.fn() }))
const icons = vi.hoisted(() => ({
  logo: vi.fn((src: string) => ({ kind: 'logo', src })),
  profile: vi.fn((src: string | null, initials: string) => ({ kind: 'profile', src: src ?? `initials:${initials}` })),
}))
const auth = vi.hoisted(() => ({ user: { role: 'tourist', name: 'Jayvie De Torres', profile_photo: 'profiles/jayvie.jpg' } as Record<string, unknown> | null }))

vi.mock('@/shared/services/api', () => ({ get: api.get, post: vi.fn(), default: { get: api.get, post: vi.fn() } }))
vi.mock('@/features/auth/services/auth-store', () => {
  return { useAuthStore: (selector?: (v: { user: unknown; token: string }) => unknown) => {
    const state = { user: auth.user, token: 't' }
    return selector ? selector(state) : state
  } }
})

vi.mock('@/shared/utils/pin-icon', () => ({
  pinIcon: (label: string) => ({ kind: 'pin', label }),
  beachPinIcon: { kind: 'beach' },
  userPinIcon: { kind: 'user' },
  businessLogoIcon: icons.logo,
  profilePinIcon: icons.profile,
}))

vi.mock('react-leaflet', async () => {
  const React = await import('react')
  const Empty = () => null
  return {
    MapContainer: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children),
    TileLayer: Empty,
    Polyline: Empty,
    Marker: (p: { title?: string; zIndexOffset?: number; icon?: { kind?: string; src?: string }; eventHandlers?: unknown }) =>
      React.createElement('span', {
        'data-testid': p.title === 'Your location' ? 'user-marker' : 'business-marker',
        'data-z': p.zIndexOffset ?? 0,
        'data-icon': p.icon?.kind,
        'data-src': p.icon?.src,
      }),
    useMap: () => ({
      invalidateSize: vi.fn(), getZoom: () => 12, setView: map.setView, fitBounds: vi.fn(),
      getBounds: () => ({ contains: () => true }), panTo: vi.fn(), getContainer: () => document.createElement('div'),
    }),
    useMapEvents: () => undefined,
  }
})
vi.mock('leaflet', () => ({ default: { divIcon: vi.fn(() => ({})), latLngBounds: vi.fn(() => ({})), marker: vi.fn() } }))

const biz = (over: Record<string, unknown>) => ({
  id: 7, name: 'Eksklusibo Grill', category: { id: 1, name: 'Restaurant' }, municipality: { id: 1, name: 'Bansud' },
  barangay: null, address: '', latitude: 12.86, longitude: 121.46, logo: null, cover_photo: null, is_open: true,
  reviews_count: 0, reviews_avg_rating: 0, promotions: [], menu_items: [], ...over,
})

let emit: ((lat: number, lng: number) => void) | null = null
const clearWatch = vi.fn()

function renderMap() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/tourist/explore/map']}><TouristExploreMap /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  sessionStorage.clear()
  map.setView.mockReset()
  icons.logo.mockClear()
  auth.user = { role: 'tourist', name: 'Jayvie De Torres', profile_photo: 'profiles/jayvie.jpg' }
  emit = null
  api.get.mockReset()
  api.get.mockResolvedValue({ data: { businesses: [
    biz({ id: 7, logo: '/storage/logo.png' }),
    biz({ id: 8, name: 'Cover Only Cafe', cover_photo: '/storage/cover.jpg' }),
    biz({ id: 9, name: 'Plain Diner' }),
    biz({ id: 10, name: 'Hilltop Inn', category: { id: 5, name: 'Hotel' }, logo: '/storage/inn.png' }),
  ], categories: [], municipalities: [] } })
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      watchPosition: (ok: PositionCallback) => {
        emit = (lat, lng) => ok({ coords: { latitude: lat, longitude: lng } } as GeolocationPosition)
        return 42
      },
      clearWatch,
      getCurrentPosition: vi.fn(),
    },
  })
})
afterEach(() => vi.restoreAllMocks())

describe('Explore map — tourist location', () => {
  it('centres on the tourist when the map opens, every time (no once-per-session flag)', async () => {
    for (let i = 0; i < 2; i++) {
      map.setView.mockReset()
      const view = renderMap()
      await act(async () => emit?.(12.84, 121.47))
      expect(map.setView).toHaveBeenCalledWith([12.84, 121.47], 15)
      view.unmount()
    }
    expect(clearWatch).toHaveBeenCalledWith(42)
  })

  it('keeps one "you are here" marker on top of every business pin and follows the tourist', async () => {
    renderMap()
    await act(async () => emit?.(12.84, 121.47))

    const marker = screen.getByTestId('user-marker')
    expect(screen.getAllByTestId('user-marker')).toHaveLength(1)
    const maxBusinessZ = Math.max(...(await screen.findAllByTestId('business-marker')).map((m) => Number(m.dataset.z)))
    expect(Number(marker.dataset.z)).toBeGreaterThan(maxBusinessZ)

    // Moving updates the marker, but doesn't re-centre (the tourist may be panning).
    map.setView.mockReset()
    await act(async () => emit?.(12.85, 121.48))
    expect(screen.getAllByTestId('user-marker')).toHaveLength(1)
    expect(map.setView).not.toHaveBeenCalled()
  })

  it('the location pin shows the tourist profile photo, initials without one, and the plain pin for guests', async () => {
    const view = renderMap()
    await act(async () => emit?.(12.84, 121.47))
    expect(screen.getByTestId('user-marker').dataset.icon).toBe('profile')
    expect(screen.getByTestId('user-marker').dataset.src).toContain('/storage/profiles/jayvie.jpg')
    view.unmount()

    auth.user = { role: 'tourist', name: 'Jayvie De Torres', profile_photo: null }
    const noPhoto = renderMap()
    await act(async () => emit?.(12.84, 121.47))
    expect(screen.getByTestId('user-marker').dataset.src).toBe('initials:J') // same initials as the sidebar avatar (getInitials)
    noPhoto.unmount()

    auth.user = null
    renderMap()
    await act(async () => emit?.(12.84, 121.47))
    expect(screen.getByTestId('user-marker').dataset.icon).toBe('user')
  })

  it('"Show my location" re-centres on the tourist', async () => {
    renderMap()
    await act(async () => emit?.(12.84, 121.47))
    map.setView.mockReset()

    fireEvent.click(screen.getByRole('button', { name: 'Show my location' }))

    expect(map.setView).toHaveBeenCalledWith([12.84, 121.47], 15)
  })
})

describe('Explore map — restaurant markers match the landing page', () => {
  it('restaurants use the image pin (logo, else cover photo); others keep their pins', async () => {
    renderMap()
    await screen.findAllByTestId('business-marker')

    const markers = screen.getAllByTestId('business-marker')
    expect(markers.map((m) => m.dataset.icon)).toEqual(['logo', 'logo', 'pin', 'pin'])
    expect(markers[0].dataset.src).toContain('/storage/logo.png')
    expect(markers[1].dataset.src).toContain('/storage/cover.jpg')
  })
})
