import axios from 'axios'
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'

export interface ApiResponse<T> {
  success: boolean
  message: string
  data: T
  meta?: {
    current_page: number
    last_page: number
    per_page: number
    total: number
  }
  errors?: Record<string, string[]>
}

const API_BASE_URL: string = import.meta.env.VITE_API_URL || '/api'

const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('auth_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
    // Remember exactly which credential this request was sent with. A 401 that
    // comes back describes THAT token — it says nothing about whatever token is
    // stored in localStorage at the time the response lands.
    ;(config as any)._presentedToken = token
  }
  return config
})

// Debounce handle for the non-session 401 → session revalidation. A 401 from a
// non-identity endpoint never ends the session by itself (see below), but it IS
// proof the presented token was rejected somewhere. Instead of leaving the UI
// stuck on a dead token until the next refresh (when GET /user 401s and looks
// like a surprise logout), bump a throttled revalidation against the
// authoritative /user endpoint, which clears the token + navigates to /login
// only if /user itself confirms it is dead.
let revalidateTimer: ReturnType<typeof setTimeout> | null = null

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Only a rejection of the authoritative identity check ends the session.
      // A 401 from any other endpoint must NOT wipe the stored token or log the
      // rider out — a single stale/errored request (e.g. a GPS location post
      // racing a Go Online/Go Offline toggle) must not destroy the session.
      const url = typeof error.config?.url === 'string' ? error.config.url : ''
      const endpoint = url.split('?')[0].replace(/^\/+|\/+$/g, '')
      const isSessionEndpoint = endpoint === 'user' || endpoint === 'logout'
      // The credential this request was actually sent with (captured by the
      // request interceptor). A 401 response describes THAT credential — its
      // rejection is not a statement about whatever token is stored NOW.
      const sentToken = (error.config as any)?._presentedToken ?? null
      const currentToken = localStorage.getItem('auth_token')
      if (isSessionEndpoint) {
        // Only a 401 for the credential that is STILL the current session is a
        // definitive logout. If the 401 belongs to a stale credential (a newer
        // login already replaced the token on disk — e.g. the same account was
        // signed in again on another tab/device while this old in-flight
        // request was still travelling), wiping the fresh token and dispatching
        // logout would boot a LIVE session — the "the app just logged me out
        // mid-use" bug. The stale 401 is instead ignored: the fresh session
        // stays authoritative.
        const isCurrentCredential = sentToken !== null && sentToken === currentToken
        if (isCurrentCredential) {
          localStorage.removeItem('auth_token')
          if (!window.location.pathname.startsWith('/login')) {
            window.dispatchEvent(new CustomEvent('auth:logout'))
          }
        } else if (!currentToken) {
          // Nothing on disk and an authenticated request was rejected: the
          // session is already gone (cross-tab logout cleared localStorage).
          // End the stale in-memory session so the UI stops polling a phantom.
          window.dispatchEvent(new CustomEvent('auth:logout'))
        }
        // else: stale credential 401 + a fresh token on disk → do nothing.
      } else if (currentToken) {
        // A valid-looking session just got a 401 from a non-identity endpoint —
        // the token is suspect. Revalidate against /user (debounced so a burst
        // of parallel 401s collapses into one check). A fluke 401 re-validates
        // cleanly and nothing happens; a genuinely dead token clears there.
        if (revalidateTimer === null) {
          revalidateTimer = setTimeout(() => {
            revalidateTimer = null
            window.dispatchEvent(new CustomEvent('auth:revalidate'))
          }, 150)
        }
      } else {
        // No token is stored, yet an authenticated endpoint was called and
        // rejected. The UI is mounted on a protected surface with a phantom
        // in-memory session — e.g. the rider logged out from a second tab,
        // which clears the shared localStorage token but leaves this tab's
        // zustand `user` cached, so GPS/offer polls keep firing with no
        // credential (an endless 401 flood). There is no session left to
        // preserve: end the stale session UI so the polls stop and the user
        // returns to /login instead of being stuck on a dead dashboard.
        window.dispatchEvent(new CustomEvent('auth:logout'))
      }
    }
    if (error.response?.status === 403 && error.response?.data?.account_status) {
      const status = error.response.data.account_status
      if (status !== 'approved' && window.location.pathname !== '/business-owner/account-status') {
        window.dispatchEvent(new CustomEvent('auth:redirect', { detail: '/business-owner/account-status' }))
      }
    }
    return Promise.reject(error)
  }
)

/**
 * Surface the server-provided error message (the `message` field of a Laravel
 * JSON error body) from a failed request, falling back to a generic message for
 * network/timeout failures. Rider status actions (e.g. the COD pickup gate
 * rejection) return a human-readable 422 message that must reach the rider
 * instead of axios's opaque `Request failed with status code 422`.
 */
export function apiErrorMessage(error: unknown, fallback = 'Request failed. Please try again.'): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: unknown } | undefined)?.message
    if (typeof message === 'string' && message.trim().length > 0) {
      return message
    }
  }
  return fallback
}

function unwrap<T>(response: AxiosResponse<ApiResponse<T>>): any {
  const apiData = response.data.data
  const meta = response.data.meta
  if (meta !== undefined) {
    return { data: apiData, meta }
  }
  return apiData
}

export async function get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await api.get<ApiResponse<T>>(url, config)
  return unwrap<T>(response)
}

export async function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const isFormData = data instanceof FormData
  const response = await api.post<ApiResponse<T>>(url, data, {
    ...config,
    ...(isFormData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {}),
  })
  return unwrap<T>(response)
}

export async function put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const isFormData = data instanceof FormData
  let payload: unknown = data
  if (isFormData) {
    payload = new FormData()
    for (const [key, value] of (data as FormData).entries()) {
      payload.append(key, value)
    }
    payload.append('_method', 'PUT')
  } else if (data && typeof data === 'object') {
    payload = { ...(data as Record<string, unknown>), _method: 'PUT' }
  }
  const mergedConfig: AxiosRequestConfig = { ...config }
  if (isFormData) {
    mergedConfig.headers = { 'Content-Type': 'multipart/form-data', ...mergedConfig.headers }
  }
  const response = await api.post<ApiResponse<T>>(url, payload, mergedConfig)
  return unwrap<T>(response)
}

export async function patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
  const response = await api.patch<ApiResponse<T>>(url, data, config)
  return unwrap<T>(response)
}

export async function del<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
  const response = await api.delete<ApiResponse<T>>(url, config)
  return unwrap<T>(response)
}

export async function openAuthenticatedDocument(url: string): Promise<void> {
  const preview = window.open('', '_blank')
  if (!preview) {
    throw new Error('Allow pop-ups to view this document.')
  }
  preview.opener = null

  try {
    const response = await api.get<Blob>(url, { responseType: 'blob' })
    const contentType = response.headers['content-type'] ?? response.data.type
    const objectUrl = URL.createObjectURL(new Blob([response.data], { type: contentType }))
    preview.location.href = objectUrl
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  } catch (error) {
    preview.close()
    throw error
  }
}

export default api
