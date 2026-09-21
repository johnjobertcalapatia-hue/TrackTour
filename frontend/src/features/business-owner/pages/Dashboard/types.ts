import { type LucideIcon } from 'lucide-react'

export interface DashboardData {
  businesses: { id: number; name: string; category: string; status: string; logo: string | null }[]
  selected_business_id: number | null
  business: { name: string; category: string } | null
  stats: {
    total_orders: number
    total_revenue: number
    active_bookings: number
    pending_orders: number
    total_menu_items: number
    active_promotions: number
  }
  recent_orders: {
    id: number
    order_number: string
    customer_name: string
    status: string
    total: number
    created_at: string
  }[]
  recent_bookings: {
    id: number
    booking_number: string
    customer_name: string
    status: string
    check_in_date: string
    check_out_date: string
    total_amount: number
    created_at: string
  }[]
}

export interface StatCardConfig {
  key: string
  label: string
  icon: LucideIcon
  labelClass: string
  iconBg: string
  iconText: string
  isCurrency?: boolean
}

export interface QuickAction {
  label: string
  path: string
  icon: LucideIcon
  count: string
}

export interface DashboardProps {
  data: DashboardData
  businessName: string
}
