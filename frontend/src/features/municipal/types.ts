// Municipal Tourism Office portal (role `tourism_office`). Every endpoint is
// scoped server-side to the officer's own municipality.

import type { Analytics } from '@/features/admin/components/dashboard/types'

export const MUNICIPAL_API = {
  DASHBOARD: '/municipal/dashboard',
  DASHBOARD_ANALYTICS: '/municipal/dashboard/analytics',
  BUSINESS_OWNERS: '/municipal/business-owners',
  BUSINESSES: '/municipal/businesses',
  RIDERS: '/municipal/riders',
  TOURISTS: '/municipal/tourists',
  DOCUMENTS: '/municipal/documents',
  REPORTS: '/municipal/reports',
  ACTIVITY_LOGS: '/municipal/activity-logs',
  PROFILE: '/municipal/profile',
} as const

export type ModerationAction = 'approve' | 'reject' | 'suspend' | 'reactivate'

export interface ListMeta {
  current_page: number
  last_page: number
  per_page: number
  total: number
  stats: Record<string, number>
}

export interface ListResponse<T> {
  data: T[]
  meta: ListMeta
}

export interface MunicipalityInfo {
  id: number
  name: string
  district: string | null
  province: string | null
  logo: string | null
  cover_photo: string | null
  barangays_count?: number
}

export interface PendingPerson {
  id: number
  name: string
  email: string
  created_at: string
}

export interface PendingBusiness {
  id: number
  business_name: string
  category: string | null
  status: string
  created_at: string
}

export interface MunicipalDashboardData {
  municipality: MunicipalityInfo
  stats: {
    business_owners: { total: number; pending: number; approved: number; suspended: number }
    businesses: { total: number; pending: number; approved: number; suspended: number }
    riders: { total: number; pending: number; approved: number; active_now: number }
    tourists: { total: number }
    orders: { total: number; this_month: number }
    documents: { business_pending: number; business_flagged: number; riders_pending: number }
  }
  recent_businesses: (PendingBusiness & { barangay: string | null; logo: string | null })[]
  recent_activity: ActivityEntry[]
  pending: {
    business_owners: PendingPerson[]
    businesses: PendingBusiness[]
    riders: PendingPerson[]
  }
}

/**
 * GET /municipal/dashboard/analytics — the Bansud dashboard's figures for this
 * municipality only. Platform-only data (TrackTour revenue, Bansud expenses,
 * cashouts, other municipalities, system health) is not included.
 */
export interface MunicipalAnalytics extends Pick<Analytics, 'period' | 'live' | 'operations' | 'popularity' | 'opportunities'> {
  municipality: { id: number; name: string }
  overview: Omit<Analytics['overview'], 'cashouts'>
  economy: Pick<
    Analytics['financial'],
    'gross_transaction_value' | 'business_owner_earnings' | 'rider_earnings' | 'refunds' | 'cod_collections' | 'gateway' | 'pending_settlements'
  >
  trend: { granularity: 'day' | 'month'; points: { date: string; gross_value: number; transactions: number }[] }
}

export interface AccountRow {
  id: number
  name: string
  email: string
  role: string
  account_status: string
  created_at: string
  first_name?: string | null
  last_name?: string | null
  phone?: string | null
  profile_photo?: string | null
  municipality?: string | null
}

export interface BusinessOwnerRow extends AccountRow {
  businesses_count: number
}

export interface RiderRow extends AccountRow {
  vehicle_type: string | null
  rider_status?: string | null
  current_service?: string | null
}

export interface DocumentLink {
  name: string
  file_url: string
}

export interface BusinessDocument {
  id: number
  name: string
  file_url: string | null
  file_name: string | null
  document_number: string | null
  expiration_date: string | null
  owner_remarks: string | null
  admin_remarks: string | null
  verification_status: string
}

export interface BusinessRow {
  id: number
  business_name: string
  category: string | null
  barangay: string | null
  municipality: string | null
  address: string | null
  logo: string | null
  status: string
  created_at: string
  contact_number?: string | null
  email?: string | null
  business_description?: string | null
  owner?: AccountRow | null
  documents?: BusinessDocument[]
}

export interface TouristRow {
  id: number
  name: string
  email: string
  phone: string | null
  nationality: string | null
  account_status: string
  created_at: string
  orders_count: number
  bookings_count: number
  last_activity_at: string | null
}

export interface ActivityEntry {
  id: number
  action: string
  description: string
  actor: string
  model_type: string | null
  model_id: number | null
  created_at: string
}

export interface MunicipalProfile {
  municipality: { id: number; name: string; district: string | null; province: string | null }
  logo_url: string | null
  cover_url: string | null
  account: { name: string; email: string }
  office_name: string
  about: string
  email: string
  phone: string
  address: string
  office_hours: string
}

export interface DocumentQueueRow extends BusinessDocument {
  uploaded_at: string
  business: { id: number; business_name: string; category: string | null; status: string }
}

export interface RiderRequirementRow extends RiderRow {
  license_number: string | null
  license_expiry: string | null
  documents?: DocumentLink[]
}

export interface CountRow {
  status?: string
  category?: string
  total: number
}

export interface MunicipalReport {
  range: { from: string; to: string }
  orders: { total: number; completed: number; by_status: CountRow[]; item_sales: number; trend: { date: string; orders: number }[] }
  top_businesses: { id: number; business_name: string; orders: number; sales: number }[]
  bookings: { total: number; completed_value: number; by_status: CountRow[] }
  businesses: { total: number; registered_in_range: number; by_status: CountRow[]; by_category: CountRow[] }
  riders: { total: number; registered_in_range: number; by_status: CountRow[]; completed_deliveries: number }
  tourists: { active_in_range: number }
}
