import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import api, { get } from '@/shared/services/api'
import { AxiosError } from 'axios'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'

/**
 * Session-revalidation tests for the shared api interceptor.
 *
 * Drives the REAL `@/shared/services/api` module through a canned axios adapter
 * so the response interceptor (401 handling) is exercised exactly as it runs in
 * the app — no module mock.
 *
 * Behaviour under test:
 *  - a 401 from a non-identity endpoint must NEVER logout the user when a token
 *    is still stored (hardening), it only schedules an `auth:revalidate` check
 *    against the authoritative /user endpoint so a genuinely dead token recovers
 *    instead of lingering and causing a surprise logout on the next refresh,
 *  - a 401 from the identity endpoints (/user, /logout) still ends the session,
 *  - a 401 with NO stored token is a phantom session (state thinks it's logged
 *    in but has no credential, e.g. a second tab logged out): there is nothing
 *    to preserve, so it ends the stale session UI via `auth:logout`.
 */

const USER: User = {
  id: 7,
  name: 'Rider A',
  email: 'rider@test.com',
  role: 'rider',
  account_status: 'approved',
  email_verified_at: null,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-24T00:00:00Z',
  rider_status: 'online',
  current_service: 'food',
  auto_accept: false,
}

function failWith(status: number) {
  api.defaults.adapter = (async (config) => {
    // Build a genuine AxiosError so axios.isAxiosError() (used by
    // auth-store.fetchUser) classifies it exactly like the real backend would.
    throw new AxiosError(`Request failed with status code ${status}`, String(status), config, undefined, {
      status,
      statusText: 'error',
      headers: {},
      data: { message: 'error' },
      config,
    })
  }) as never
}

function failNetwork() {
  api.defaults.adapter = (async (config) => {
    throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {})
  }) as never
}

// jsdom keeps ONE `window` for the whole test file, so every listener attached
// here bleeds into later tests unless removed. A leaked functional listener with
// side effects (e.g. the fetchUser handler wired in the "/user reconciles" test)
// turns a later test's harmless `auth:revalidate` event into a real /user call
// that 401s and logs the fixture out — indistinguishable from a code regression.
const cleanupFns: Array<() => void> = []

function listen(event: string) {
  const spy = vi.fn()
  window.addEventListener(event, spy)
  cleanupFns.push(() => window.removeEventListener(event, spy))
  return spy
}

/** Attach a one-shot functional handler that is guaranteed to be removed when
 * the test ends, so it cannot be re-triggered by a later test's events. */
function listenFn(event: string, handler: (e: Event) => void) {
  window.addEventListener(event, handler)
  cleanupFns.push(() => window.removeEventListener(event, handler))
}

function cleanupListeners() {
  cleanupFns.splice(0).forEach((remove) => remove())
}

describe('api interceptor — 401 session handling', () => {
  beforeEach(() => {
    cleanupListeners()
    useAuthStore.setState({ user: null, loading: false })
    api.defaults.adapter = undefined as never
  })

  afterEach(() => {
    cleanupListeners()
    api.defaults.adapter = undefined as never
  })

  it('non-session 401 does NOT logout and DOES schedule a revalidation check', async () => {
    localStorage.setItem('auth_token', 'test-token-1')
    failWith(401, '/rider/map/location')

    const logoutSpy = listen('auth:logout')
    const revalidateSpy = listen('auth:revalidate')

    await expect(get('/rider/map/location')).rejects.toMatchObject({
      response: { status: 401 },
    })

    // Debounced (150ms) revalidation fires; the token is never wiped and no
    // logout is dispatched for a non-identity 401.
    await waitFor(() => expect(revalidateSpy).toHaveBeenCalledTimes(1))
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem('auth_token')).toBe('test-token-1')
  })

  it('a fluke non-session 401 + valid /user reconciles WITHOUT ending the session', async () => {
    localStorage.setItem('auth_token', 'test-token-2')
    // /rider/map/location 401s but /user (the authoritative check) still works.
    api.defaults.adapter = (async (config) => {
      if ((config.url ?? '').startsWith('/user')) {
        return {
          data: { success: true, message: 'ok', data: USER },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      throw { config, response: { status: 401, data: {}, config } }
    }) as never

    const logoutSpy = listen('auth:logout')

    // Mirror the AuthEventHandler wiring: revalidate → fetchUser() re-reads
    // /user, gets 200, and confirms the session is alive. The handler is
    // removed after this test so it cannot hijack later tests' revalidate
    // events through a stale adapter.
    listenFn('auth:revalidate', () => {
      void useAuthStore.getState().fetchUser()
    })

    await expect(get('/rider/map/location')).rejects.toMatchObject({
      response: { status: 401 },
    })

    await waitFor(() =>
      expect(useAuthStore.getState().user?.id).toBe(USER.id)
    )
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem('auth_token')).toBe('test-token-2')
  })

  it('identity endpoint /user 401 still ends the session', async () => {
    localStorage.setItem('auth_token', 'test-token-3')
    failWith(401, '/user')

    const logoutSpy = listen('auth:logout')

    await expect(get('/user')).rejects.toMatchObject({ response: { status: 401 } })

    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('auth_token')).toBeNull()
  })

  it('a stale /user 401 AFTER a re-login must NOT end the fresh session', async () => {
    // Rider was signed in with the OLD credential when the /user request left.
    localStorage.setItem('auth_token', 'stale-token')
    // The adapter simulates the server responding AFTER another tab/device
    // re-logged-in and stored a NEW token over the shared localStorage.
    api.defaults.adapter = (async (config) => {
      localStorage.setItem('auth_token', 'fresh-token')
      throw new AxiosError('Request failed with status code 401', '401', config, undefined, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        data: { message: 'Unauthenticated.' },
        config,
      })
    }) as never

    const logoutSpy = listen('auth:logout')

    // The request interceptor captured the STALE token; by response time the
    // stored credential is the FRESH one. The 401 describes the old credential,
    // so it must be ignored: no logout, no wipe of the fresh token.
    await expect(get('/user')).rejects.toMatchObject({ response: { status: 401 } })

    expect(logoutSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem('auth_token')).toBe('fresh-token')
  })

  it('a stale non-session 401 AFTER a re-login only revalidates the fresh token', async () => {
    localStorage.setItem('auth_token', 'stale-token')
    api.defaults.adapter = (async (config) => {
      localStorage.setItem('auth_token', 'fresh-token')
      throw { config, response: { status: 401, data: {}, config } }
    }) as never

    const logoutSpy = listen('auth:logout')
    const revalidateSpy = listen('auth:revalidate')

    await expect(get('/rider/map/location')).rejects.toMatchObject({
      response: { status: 401 },
    })

    // Still a non-session 401 while a token is on disk → debounced
    // revalidation against /user (which now carries the FRESH token). The
    // fresh session is never logged out by the stale 401 itself.
    await waitFor(() => expect(revalidateSpy).toHaveBeenCalledTimes(1))
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem('auth_token')).toBe('fresh-token')
  })

  it('non-session 401 with NO stored token ends the phantom session', async () => {
    localStorage.clear()
    // Simulate the phantom state: the app still believes it is authenticated
    // (store user cached in memory) but the shared localStorage token is gone.
    useAuthStore.setState({ user: USER, loading: false })
    failWith(401, '/rider/map/location')

    const logoutSpy = listen('auth:logout')
    const revalidateSpy = listen('auth:revalidate')

    await expect(get('/rider/map/location')).rejects.toMatchObject({
      response: { status: 401 },
    })

    // No token exists to preserve — there is no session worth keeping, so the
    // interceptor must end the stale session UI instead of leaving the rider on
    // a dead dashboard that polls 401s forever. A revalidate is pointless here
    // (transport handler bails without a token), so it must not be dispatched.
    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(revalidateSpy).not.toHaveBeenCalled()
  })
})

describe('revalidate handler — dead token clears through /user only', () => {
  it('fetchUser clears the token and user when /user 401s', async () => {
    localStorage.setItem('auth_token', 'test-token-4')
    useAuthStore.setState({ user: USER, loading: false })
    failWith(401, '/user')

    await useAuthStore.getState().fetchUser()

    expect(localStorage.getItem('auth_token')).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('transient /user failure keeps the stored token (no false logout)', async () => {
    localStorage.setItem('auth_token', 'test-token-5')
    useAuthStore.setState({ user: null, loading: false })
    failNetwork()

    await useAuthStore.getState().fetchUser()

    expect(localStorage.getItem('auth_token')).toBe('test-token-5')
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('fetchUser ignores a 401 for a credential a newer login already replaced', async () => {
    // fetchUser starts against the OLD credential...
    localStorage.setItem('auth_token', 'stale-credential')
    useAuthStore.setState({ user: USER, loading: false })
    // ...but before /user answers, a fresh login is stored on disk.
    api.defaults.adapter = (async (config) => {
      localStorage.setItem('auth_token', 'fresh-credential')
      throw new AxiosError('Request failed with status code 401', '401', config, undefined, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        data: { message: 'Unauthenticated.' },
        config,
      })
    }) as never

    await useAuthStore.getState().fetchUser()

    // The 401 describes the stale credential: the fresh token is untouched and
    // the in-memory user survives (ProtectedRoute keeps the session spinner).
    expect(localStorage.getItem('auth_token')).toBe('fresh-credential')
    expect(useAuthStore.getState().user).toBe(USER)
  })
})