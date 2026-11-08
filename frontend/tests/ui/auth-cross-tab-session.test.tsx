import { act, render, screen, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppProviders as AppProvidersType } from '@/app/providers'
import type { useAuthStore as UseAuthStore } from '@/features/auth/services/auth-store'

// providers.tsx owns a module-level QueryClient; fresh modules per test keep caches apart.
let AppProviders: typeof AppProvidersType
let useAuthStore: typeof UseAuthStore

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: api.post, default: { get: api.get } }))

const RIDER_A = { id: 8, name: 'Rider A', role: 'rider' }
const RIDER_B = { id: 12, name: 'Rider B', role: 'rider' }
let tripFor: Record<string, number> = {}
let currentToken = 'token-a'

/** Stand-in for the rider trip screen: shows the active delivery from the shared cache key. */
function TripProbe() {
  const user = useAuthStore((s) => s.user)
  const { data } = useQuery({
    queryKey: ['rider-map-location'],
    queryFn: () => api.get('/rider/map/location') as Promise<{ delivery: number }>,
    enabled: !!user?.id,
    staleTime: Infinity,
  })
  return <p>{user ? `${user.name}: ${data ? `delivery ${data.delivery}` : 'loading'}` : 'signed out'}</p>
}

/** What another tab does to the shared storage, plus the event this tab receives. */
function otherTab(token: string | null) {
  const old = localStorage.getItem('auth_token')
  if (token === null) localStorage.removeItem('auth_token')
  else localStorage.setItem('auth_token', token)
  currentToken = token ?? ''
  window.dispatchEvent(new StorageEvent('storage', { key: 'auth_token', oldValue: old, newValue: token }))
}

beforeEach(async () => {
  vi.resetModules()
  ;({ AppProviders } = await import('@/app/providers'))
  ;({ useAuthStore } = await import('@/features/auth/services/auth-store'))
  api.get.mockReset()
  tripFor = { 'token-a': 6, 'token-b': 21 }
  currentToken = 'token-a'
  localStorage.setItem('auth_token', 'token-a')
  useAuthStore.setState({ user: null, loading: true })
  api.get.mockImplementation((url: string) => {
    if (url === '/user') return Promise.resolve(currentToken === 'token-a' ? RIDER_A : RIDER_B)
    if (url === '/rider/map/location') return Promise.resolve({ delivery: tripFor[currentToken] })
    return Promise.resolve(null)
  })
})

describe('session changes made in another tab', () => {
  it('follows a sign-in as another account and drops the previous rider\'s trip', async () => {
    render(<AppProviders><TripProbe /></AppProviders>)
    expect(await screen.findByText('Rider A: delivery 6')).toBeInTheDocument()

    await act(async () => { otherTab('token-b') })

    expect(await screen.findByText('Rider B: delivery 21')).toBeInTheDocument()
    expect(screen.queryByText(/delivery 6/)).not.toBeInTheDocument()
  })

  it('signs this tab out when another tab logs out, and forgets the cached trip', async () => {
    render(<AppProviders><TripProbe /></AppProviders>)
    expect(await screen.findByText('Rider A: delivery 6')).toBeInTheDocument()

    await act(async () => { otherTab(null) })
    expect(await screen.findByText('signed out')).toBeInTheDocument()

    // Signing back in (as anyone) must fetch fresh trip data, not reuse delivery 6.
    tripFor['token-a'] = 7
    await act(async () => { otherTab('token-a') })
    expect(await screen.findByText('Rider A: delivery 7')).toBeInTheDocument()
  })

  it('ignores unrelated storage keys', async () => {
    render(<AppProviders><TripProbe /></AppProviders>)
    await screen.findByText('Rider A: delivery 6')
    const calls = api.get.mock.calls.filter(([u]) => u === '/user').length

    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'tracktour_seen_municipalities', newValue: '[]' })) })
    await waitFor(() => expect(screen.getByText('Rider A: delivery 6')).toBeInTheDocument())
    expect(api.get.mock.calls.filter(([u]) => u === '/user').length).toBe(calls)
  })
})
