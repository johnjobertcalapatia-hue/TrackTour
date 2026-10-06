import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import api, { get } from '@/shared/services/api'
import { AxiosError } from 'axios'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User, UserRole } from '@/shared/types'

/**
 * Cross-role auto-logout regression suite.
 *
 * Session handling is deliberately role-agnostic: it lives in ONE place — the
 * shared api interceptor + auth-store.fetchUser. This file drives the REAL
 * interceptors through canned adapters for EVERY user role (tourist,
 * business_owner, rider, staff, tourism_office, bansud_tourism_office) and
 * proves the identical contract holds for each:
 *   1. a 401 on that role's own endpoints must NEVER logout (only revalidate),
 *   2. a /user 401 is the ONLY thing that ends that role's session,
 *   3. a stale /user 401 arriving after a re-login never boots that role's
 *      fresh session.
 */

const ROLES: Array<{ role: UserRole; endpoint: string }> = [
  { role: 'tourist', endpoint: '/tourist/food' },
  { role: 'business_owner', endpoint: '/business-owner/dashboard' },
  { role: 'rider', endpoint: '/rider/map/location' },
  { role: 'staff', endpoint: '/staff/dashboard' },
  { role: 'tourism_office', endpoint: '/tourism-office/dashboard' },
  { role: 'bansud_tourism_office', endpoint: '/admin/dashboard' },
]

const cleanupFns: Array<() => void> = []

function listen(event: string) {
  const spy = vi.fn()
  window.addEventListener(event, spy)
  cleanupFns.push(() => window.removeEventListener(event, spy))
  return spy
}

function cleanupListeners() {
  cleanupFns.splice(0).forEach((remove) => remove())
}

function makeUser(role: UserRole): User {
  return {
    id: 100,
    name: `${role.replace(/_/g, ' ')} user`,
    email: `${role}@test.com`,
    role,
    account_status: 'approved' as never,
    email_verified_at: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-24T00:00:00Z',
  }
}

/** Adapter that 401s URLs matching `target` and returns 200 elsewhere. */
function failEndpoint(target: string, extra?: (config: unknown) => void) {
  api.defaults.adapter = (async (config: any) => {
    extra?.(config)
    if (config.url?.includes(target)) {
      throw new AxiosError(`Request failed with status code 401`, '401', config, undefined, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        data: { message: 'Unauthenticated.' },
        config,
      })
    }
    return { data: { success: true, message: 'ok', data: {} }, status: 200, statusText: 'OK', headers: {}, config }
  }) as never
}

describe.each(ROLES)('role $role — 401 session handling', ({ role, endpoint }) => {
  const user = makeUser(role)

  beforeEach(() => {
    cleanupListeners()
    useAuthStore.setState({ user, loading: false })
    api.defaults.adapter = undefined as never
  })

  afterEach(() => {
    cleanupListeners()
    api.defaults.adapter = undefined as never
    useAuthStore.setState({ user: null, loading: false })
  })

  it('a 401 on its own endpoint ($endpoint) does NOT logout — token/user survive, revalidation is scheduled', async () => {
    localStorage.setItem('auth_token', `${role}-token`)
    failEndpoint(endpoint)

    const logoutSpy = listen('auth:logout')
    const revalidateSpy = listen('auth:revalidate')

    await expect(get(endpoint)).rejects.toMatchObject({ response: { status: 401 } })

    await waitFor(() => expect(revalidateSpy).toHaveBeenCalledTimes(1))
    expect(logoutSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem('auth_token')).toBe(`${role}-token`)
    expect(useAuthStore.getState().user).toEqual(user)
  })

  it('only a 401 on the identity endpoint /user definitively ends the session', async () => {
    localStorage.setItem('auth_token', `${role}-token`)
    failEndpoint('/user')

    const logoutSpy = listen('auth:logout')

    await expect(get('/user')).rejects.toMatchObject({ response: { status: 401 } })

    expect(logoutSpy).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('auth_token')).toBeNull()
  })

  it('a stale /user 401 AFTER a re-login never boots the fresh session', async () => {
    const staleToken = `${role}-stale-token`
    const freshToken = `${role}-fresh-token`
    localStorage.setItem('auth_token', staleToken)
    // The server answers only after ANOTHER login already overwrote the shared
    // credential in localStorage; the 401 therefore describes the OLD token.
    api.defaults.adapter = (async (config: any) => {
      localStorage.setItem('auth_token', freshToken)
      throw new AxiosError('Request failed with status code 401', '401', config, undefined, {
        status: 401,
        statusText: 'Unauthorized',
        headers: {},
        data: { message: 'Unauthenticated.' },
        config,
      })
    }) as never

    const logoutSpy = listen('auth:logout')

    await expect(get('/user')).rejects.toMatchObject({ response: { status: 401 } })

    expect(logoutSpy).not.toHaveBeenCalled()
    expect(localStorage.getItem('auth_token')).toBe(freshToken)
    expect(useAuthStore.getState().user).toEqual(user)
  })
})