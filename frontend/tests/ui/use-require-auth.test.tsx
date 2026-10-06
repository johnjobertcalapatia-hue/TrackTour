import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRequireAuth } from '@/shared/hooks/use-require-auth'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { savePendingAction } from '@/shared/services/pending-action'
import type { User } from '@/shared/types'

vi.mock('@/shared/services/pending-action', () => ({
  savePendingAction: vi.fn(),
}))

const USER: User = {
  id: 9,
  name: 'Test Tourist',
  email: 'tourist@test.com',
  role: 'tourist',
  account_status: 'approved',
  email_verified_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-09-24T00:00:00Z',
}

let currentPath = '/tourist/food/cart'
function RouterProbe() {
  const location = useLocation()
  currentPath = location.pathname
  return null
}

function hook() {
  return renderHook(() => useRequireAuth(), {
    wrapper: ({ children }: { children?: React.ReactNode }) => (
      <MemoryRouter initialEntries={[currentPath]}>
        <RouterProbe />
        {children}
      </MemoryRouter>
    ),
  })
}

describe('useRequireAuth — guest only leaves the app; a live credential never gets bounced to /login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ user: null, loading: false })
    localStorage.removeItem('auth_token')
    currentPath = '/tourist/food/cart'
  })

  afterEach(() => {
    localStorage.removeItem('auth_token')
    useAuthStore.setState({ user: null, loading: false })
  })

  it('redirects a genuine guest (no credential) to /login and saves the pending action', async () => {
    const { result } = hook()

    const ok = result.current.requireAuth({ type: 'food_order', returnPath: '/tourist/food/cart' })

    expect(ok).toBe(false)
    await waitFor(() => expect(currentPath).toBe('/login'))
    expect(savePendingAction).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'food_order', returnPath: '/tourist/food/cart' })
    )
  })

  it('blocks the action but does NOT navigate when a credential exists but the profile is unconfirmed', async () => {
    // Token on disk = a live session that /user simply has not confirmed yet
    // (transient boot failure while ProtectedRoute holds the spinner). Bouncing
    // to /login here would present as an auto-logout of a valid session.
    localStorage.setItem('auth_token', 'live-but-unconfirmed')
    useAuthStore.setState({ user: null, loading: false })

    const { result } = hook()

    const ok = result.current.requireAuth({ type: 'food_order', returnPath: '/tourist/food/cart' })

    expect(ok).toBe(false)
    await waitFor(() => expect(currentPath).toBe('/tourist/food/cart'))
    expect(savePendingAction).not.toHaveBeenCalled()
    expect(localStorage.getItem('auth_token')).toBe('live-but-unconfirmed')
  })

  it('allows a confirmed tourist through', async () => {
    localStorage.setItem('auth_token', 'confirmed-token')
    useAuthStore.setState({ user: USER, loading: false })

    const { result } = hook()

    expect(result.current.requireAuth()).toBe(true)
    expect(currentPath).toBe('/tourist/food/cart')
  })
})