export const ROLES = {
  TOURIST: 'tourist',
  BUSINESS_OWNER: 'business_owner',
  STAFF: 'staff',
  RIDER: 'rider',
  ADMIN: 'bansud_tourism_office',
  TOURISM_OFFICE: 'tourism_office',
} as const

export const ORDER_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  READY: 'ready',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const

// Display overrides for statuses whose raw name no longer matches the UI
// vocabulary (the order status itself never changes in the DB — AGENTS §10).
export const STATUS_LABELS: Record<string, string> = {
  waiting_restaurant: 'Finding Rider',
}

export const BOOKING_STATUS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const

export const STATUS_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  pending: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  pending_payment: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-500' },
  waiting_restaurant: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  under_review: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  confirmed: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  accepted: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  preparing: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500' },
  ready: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' },
  in_progress: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  cancelled: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' },
  rejected: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', dot: 'bg-red-500' },
  active: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  assigned: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  arrived_pickup: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  picked_up: { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', dot: 'bg-indigo-500' },
  in_transit: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', dot: 'bg-sky-500' },
  out_for_delivery: { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', dot: 'bg-sky-500' },
  arrived_destination: { bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200', dot: 'bg-teal-500' },
  delivered: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
}

export const LIGHT_STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  suspended: 'bg-gray-100 text-gray-600 border border-gray-200',
  pending_review: 'bg-amber-50 text-amber-700 border border-amber-200',
  under_review: 'bg-blue-50 text-blue-700 border border-blue-200',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
}

export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/login',
    REGISTER: '/register',
    LOGOUT: '/logout',
    USER: '/user',
  },
  ADMIN: {
    DASHBOARD: '/admin/dashboard',
    USERS: '/admin/users',
    BUSINESSES: '/admin/businesses',
    CATEGORIES: '/admin/business-categories',
    MODULES: '/admin/business-modules',
    MUNICIPALITIES: '/admin/municipalities',
    TOURISTS: '/admin/tourists',
    ROLES: '/admin/roles',
    RIDERS: '/admin/riders',
    RIDERS_FARES: '/admin/riders/fares',
    REPORTS: '/admin/reports',
    POS: '/admin/pos/sales',
    POS_SUMMARY: '/admin/pos/sales/summary',
    POS_TRANSACTIONS: '/admin/pos/sales/transactions',
    POS_BY_BUSINESS: '/admin/pos/sales/by-business',
    POS_TREND: '/admin/pos/sales/trend',
    AUDIT_LOGS: '/admin/audit-logs',
    NOTIFICATIONS: '/admin/notifications',
    SYSTEM_CONFIG: '/admin/system/config',
    SYSTEM_BACKUP: '/admin/system/backup',
    SYSTEM_SECURITY: '/admin/system/security',
    OCR_SETTINGS: '/admin/system/ocr-settings',
    LIVE_MAP: '/admin/live/map',
  },
  TOURIST: {
    DASHBOARD: '/tourist/dashboard',
    EXPLORE: '/tourist/explore',
    FAVORITES_TOGGLE: '/tourist/favorites/toggle',
    SEARCH: '/tourist/explore/search',
  },
  BUSINESS_OWNER: {
    DASHBOARD: '/business-owner/dashboard',
  },
  STAFF: {
    DASHBOARD: '/staff/dashboard',
  },
  RIDER: {
    DASHBOARD: '/rider/map',
  },
  TOURISM_OFFICE: {
    DASHBOARD: '/tourism-office/dashboard',
  },
} as const
