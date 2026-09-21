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

const api: AxiosInstance = axios.create({
  baseURL: '/api',
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
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('auth_token')
      if (!window.location.pathname.startsWith('/login')) {
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

export default api
