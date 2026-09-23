import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return `₱${Number(amount).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function formatDate(date: string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...options,
  })
}

export function formatDateTime(date: string): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function capitalize(str: string | undefined | null): string {
  if (!str) return ''
  return str.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

const API_ORIGIN =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_ORIGIN || 'http://localhost:8000'

export function toAssetUrl(path: string | null | undefined): string {
  if (!path) return ''
  if (/^https?:\/\//.test(path)) return path
  if (path.startsWith('/storage/')) return `${API_ORIGIN}${path}`
  if (path.startsWith('http')) return path
  return `${API_ORIGIN}/storage/${path.replace(/^\/+/, '')}`
}

export function safeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'name' in value) return String((value as { name: unknown }).name)
  return ''
}

export function categoryName(category: unknown): string {
  if (typeof category === 'string') return category
  if (category && typeof category === 'object' && 'name' in category) {
    return String((category as { name: unknown }).name)
  }
  return ''
}

export function isNewItem(createdAt: string | undefined | null): boolean {
  if (!createdAt) return false
  const created = new Date(createdAt)
  const now = new Date()
  const diffMs = now.getTime() - created.getTime()
  const days = diffMs / (1000 * 60 * 60 * 24)
  return days <= 30
}

export function getInitials(name: string | undefined): string {
  return name?.charAt(0)?.toUpperCase() || '?'
}

export function toNumberArray(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter((n) => Number.isFinite(n))
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => Number.isFinite(n))
    } catch {
      /* fall through */
    }
    return value
      .split(/[,\s]+/)
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n))
  }
  return []
}

export function truncate(str: string, length: number): string {
  return str.length > length ? str.slice(0, length) + '...' : str
}

export function getRoleDashboardPath(role: string): string {
  const routes: Record<string, string> = {
    tourist: '/tourist/dashboard',
    business_owner: '/business-owner/dashboard',
    staff: '/staff/dashboard',
    rider: '/rider/map',
    bansud_tourism_office: '/admin/dashboard',
    tourism_office: '/tourism-office/dashboard',
  }
  return routes[role] || '/unauthorized'
}
