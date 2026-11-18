// Bansud Tourism Office business-intelligence dashboard (GET /admin/dashboard/analytics).

export type PeriodKey = 'today' | 'yesterday' | 'this_week' | 'this_month' | 'this_year' | 'custom'

export interface Compare {
  value: number
  previous: number
  count?: number
}

export type PopularityClass = 'high' | 'growing' | 'average' | 'low' | 'declining'

export interface PopularityRow {
  id: number
  name: string
  logo: string | null
  municipality: string | null
  category: string | null
  metrics: { views: number; offering_views: number; favorites: number; inquiries: number; bookings: number; transactions: number; reviews: number }
  score: number
  previous_score: number
  growth: number
  conversion: number | null
  rating: number | null
  review_total: number
  class: PopularityClass
}

export interface TrendPoint {
  date: string
  platform_revenue: number
  expenses: number
  gross_value: number
  transactions: number
}

export interface Analytics {
  period: { key: PeriodKey; label: string; from: string; to: string; previous_from: string; previous_to: string; generated_at: string }
  municipality: { id: number; name: string } | null
  overview: {
    businesses: { total: number; active: number; pending: number; suspended: number; new: Compare }
    users: { total: number; online_now: number; new: Compare; new_today: number }
    deliveries: Compare
    ride_hailing: Compare
    bookings: Compare
    cashouts: { requested: Compare; open_count: number }
    riders: { active: number; online_now: number }
    business_owners: { active: number }
    pending_approvals: { businesses: number; business_owners: number; riders: number }
  }
  live: {
    users_online: number
    tourists_online: number
    riders_available: number
    riders_on_delivery: number
    drivers_on_rides: number
    active_food_orders: number
    ongoing_rides: number
    pending_deliveries: number
    cancelled_today: number
  }
  operations: { food_orders: Compare; deliveries: Compare; ride_hailing: Compare; accommodation: Compare; cancelled: number }
  financial: {
    gross_transaction_value: Compare
    platform_revenue: Compare
    business_owner_earnings: Compare
    rider_earnings: Compare
    refunds: Compare
    operating_expenses: Compare
    net_income: Compare
    earnings_today: number
    earnings_this_month: number
    cashouts: { requested: Compare; approved: Compare; completed: Compare; liability: number }
    pending_settlements: { count: number; amount: number }
    cod_collections: Compare
    cod_remitted: Compare
    rider_cash_advances: Compare
    gateway: Compare
  }
  trend: { granularity: 'day' | 'month'; points: TrendPoint[] }
  popularity: { summary: Record<PopularityClass, number>; top: PopularityRow[]; needs_help: PopularityRow[] }
  opportunities: { kind: string; business: string | null; title: string; action: string; link: string | null }[]
  municipalities: { id: number; name: string; logo: string | null; is_home: boolean; businesses: number; riders: number; transactions: number; value: number; share: number; has_office: boolean }[]
  alerts: { key: string; label: string; count: number; link: string }[]
  system: { key: string; label: string; status: 'ok' | 'warning' | 'idle' | 'down'; detail: string }[]
  activity: { id: number; description: string; by: string | null; at: string | null }[]
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  this_month: 'This month',
  this_year: 'This year',
  custom: 'Custom range',
}

export const CLASS_META: Record<PopularityClass, { label: string; tone: string; dot: string }> = {
  high: { label: 'High popularity', tone: 'bg-[#E6F2EB] text-[#1E6B40]', dot: 'bg-[#2E8B57]' },
  growing: { label: 'Growing', tone: 'bg-[#E3F1F8] text-[#1D5F80]', dot: 'bg-[#2C7DA0]' },
  average: { label: 'Average', tone: 'bg-[#F1EDE3] text-[#5B5446]', dot: 'bg-[#9A9282]' },
  low: { label: 'Low visibility', tone: 'bg-[#FFF6CC] text-[#5C4A00]', dot: 'bg-[#D99A00]' },
  declining: { label: 'Declining', tone: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
}

export const peso = (n: number) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const pesoShort = (n: number) => {
  const v = Number(n || 0)
  if (Math.abs(v) >= 1_000_000) return `₱${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 10_000) return `₱${(v / 1_000).toFixed(1)}k`
  return `₱${v.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`
}
export const count = (n: number) => Number(n ?? 0).toLocaleString('en-PH')

/** Change vs the previous equivalent period; null when there is nothing to compare. */
export function change(c: Pick<Compare, 'value' | 'previous'>): { text: string; direction: 'up' | 'down' | 'flat' | 'new' } | null {
  if (!c) return null
  if (c.previous === 0) return c.value > 0 ? { text: 'New', direction: 'new' } : null
  const pct = ((c.value - c.previous) / Math.abs(c.previous)) * 100
  if (Math.abs(pct) < 0.5) return { text: '0%', direction: 'flat' }
  return { text: `${pct > 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`, direction: pct > 0 ? 'up' : 'down' }
}
