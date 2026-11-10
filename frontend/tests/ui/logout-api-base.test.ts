import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Logout must reach the API, wherever it is hosted. Production serves the API
 * on another domain (VITE_API_URL); a hard-coded '/api/logout' went to the
 * frontend's host instead → 405, and the token was never revoked
 * (reported 2026-11-09).
 */

const post = vi.hoisted(() => vi.fn(() => Promise.resolve({})))
vi.mock('axios', async (orig) => {
  const real = (await orig()) as { default: Record<string, unknown> }
  return { ...real, default: { ...real.default, post } }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  post.mockClear()
  localStorage.clear()
})

async function logoutWith(apiUrl: string) {
  vi.stubEnv('VITE_API_URL', apiUrl)
  vi.resetModules()
  localStorage.setItem('auth_token', 'tok-1')
  const { useAuthStore } = await import('@/features/auth/services/auth-store')
  await useAuthStore.getState().logout()
}

describe('logout', () => {
  it('posts to the API host from VITE_API_URL (production: another domain)', async () => {
    await logoutWith('https://tracktour-production.up.railway.app/api')
    expect(post).toHaveBeenCalledWith(
      'https://tracktour-production.up.railway.app/api/logout',
      null,
      { headers: { Authorization: 'Bearer tok-1' } },
    )
    expect(localStorage.getItem('auth_token')).toBeNull()
  })

  it('uses the /api proxy when no API URL is configured (development)', async () => {
    await logoutWith('')
    expect(post).toHaveBeenCalledWith('/api/logout', null, expect.anything())
  })
})
