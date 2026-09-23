import axios from 'axios'
import { create } from 'zustand'
import { get, post } from '@/shared/services/api'
import type { User, AuthResponse } from '@/shared/types'

interface AuthState {
  user: User | null
  loading: boolean
  fetchUser: () => Promise<void>
  login: (email: string, password: string) => Promise<User>
  register: (data: Record<string, unknown>) => Promise<User>
  logout: () => Promise<void>
  setUser: (user: User | null) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: !!localStorage.getItem('auth_token'),

  fetchUser: async () => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      set({ user: null, loading: false })
      return
    }

    // Only a definitive auth rejection may end the session. Every other
    // failure (axios timeout, network drop, 5xx) is transient and must leave
    // the stored token and current user untouched — otherwise a single slow
    // response logs the rider out of the app.
    const maxAttempts = 3
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const data = await get<User>('/user')
        set({ user: data, loading: false })
        return
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined

        // 401 = token missing/expired/revoked server-side. Genuine logout.
        if (status === 401) {
          localStorage.removeItem('auth_token')
          set({ user: null, loading: false })
          return
        }

        // No response at all (timeout/network) or a server error: retry a few
        // times, then keep the existing session rather than destroying it.
        const transient = status === undefined || status >= 500
        if (transient && attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 250 * attempt))
          continue
        }

        set({ loading: false })
        return
      }
    }
  },

  login: async (email: string, password: string) => {
    const data = await post<AuthResponse>('/login', { email, password })
    localStorage.setItem('auth_token', data.token)
    set({ user: data.user, loading: false })
    return data.user
  },

  register: async (formData: Record<string, unknown>) => {
    const data = await post<AuthResponse>('/register', formData)
    localStorage.setItem('auth_token', data.token)
    set({ user: data.user, loading: false })
    return data.user
  },

  logout: async () => {
    const currentUser = useAuthStore.getState().user

    // Snapshot the token before clearing so the toggle call can still use it.
    const token = localStorage.getItem('auth_token')

    // Clear user and token immediately so React Query, GPS, and all polling
    // stop firing requests against the about-to-be-revoked token.
    localStorage.removeItem('auth_token')
    set({ user: null, loading: false })

    // Best-effort: tell the backend to set the rider offline before revoking
    // the session. Use the saved token directly (the shared api interceptor
    // no longer has it).
    if (currentUser?.rider_status === 'online' || currentUser?.rider_status === 'available') {
      if (token) {
        await axios.post('/api/rider/availability/toggle', null, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {})
      }
    }

    // Revoke the server-side session/token. This may fail if the token is
    // already gone (e.g. 401 interceptor cleared it) — that's fine.
    await axios.post('/api/logout', null, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).catch(() => {})
  },

  setUser: (user) => set({ user }),
}))
