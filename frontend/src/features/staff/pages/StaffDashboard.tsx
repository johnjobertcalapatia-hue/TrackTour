import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { Package, DollarSign, CalendarCheck, ClipboardList, Utensils, Megaphone, ArrowRight, ClipboardCheck, Leaf, Bed, Users, Car, MapPin, Truck, ShoppingBag } from 'lucide-react'

interface StaffDashboardData {
  staff: { status: string; role: string }
  business: { name: string; category: string }
  today_summary: {
    pending: number
    confirmed: number
    in_progress: number
    completed_today: number
    cancelled_today: number
    revenue_today: number
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
    booking_type: string
    status: string
    check_in_date: string
    check_out_date: string
    total_amount: number
    created_at?: string
  }[]
}

interface StatCard {
  key: string
  label: string
  icon: typeof Package
  labelClass: string
  iconBg: string
  iconText: string
  isCurrency?: boolean
}

interface Shortcut {
  label: string
  path: string
  icon: typeof Package
  count: string
}

function getStatCards(category: string): StatCard[] {
  const base = { labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' }
  const warn = { labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' }

  const food: StatCard[] = [
    { key: 'total_orders', label: 'Total Orders', icon: Package, ...base },
    { key: 'total_revenue', label: 'Total Revenue', icon: DollarSign, ...warn, isCurrency: true },
    { key: 'active_bookings', label: 'Active Bookings', icon: CalendarCheck, ...base },
    { key: 'pending_orders', label: 'Pending Orders', icon: ClipboardList, ...warn },
    { key: 'total_menu_items', label: 'Menu Items', icon: Utensils, ...base },
    { key: 'active_promotions', label: 'Active Promos', icon: Megaphone, ...warn },
  ]

  const accommodation: StatCard[] = [
    { key: 'active_bookings', label: 'Active Reservations', icon: CalendarCheck, ...base },
    { key: 'total_revenue', label: 'Total Revenue', icon: DollarSign, ...warn, isCurrency: true },
    { key: 'pending_orders', label: 'Pending Check-ins', icon: ClipboardList, ...warn },
    { key: 'total_menu_items', label: 'Rooms', icon: Bed, ...base },
    { key: 'total_orders', label: 'Total Bookings', icon: Package, ...base },
    { key: 'active_promotions', label: 'Active Promos', icon: Megaphone, ...warn },
  ]

  const tours: StatCard[] = [
    { key: 'active_bookings', label: 'Active Bookings', icon: CalendarCheck, ...base },
    { key: 'total_revenue', label: 'Total Revenue', icon: DollarSign, ...warn, isCurrency: true },
    { key: 'pending_orders', label: 'Pending Bookings', icon: ClipboardList, ...warn },
    { key: 'total_menu_items', label: 'Tour Packages', icon: Package, ...base },
    { key: 'total_orders', label: 'Total Customers', icon: Users, ...base },
    { key: 'active_promotions', label: 'Active Promos', icon: Megaphone, ...warn },
  ]

  const shop: StatCard[] = [
    { key: 'total_orders', label: 'Total Orders', icon: ShoppingBag, ...base },
    { key: 'total_revenue', label: 'Total Revenue', icon: DollarSign, ...warn, isCurrency: true },
    { key: 'pending_orders', label: 'Pending Orders', icon: ClipboardList, ...warn },
    { key: 'total_menu_items', label: 'Products', icon: Package, ...base },
    { key: 'active_bookings', label: 'Deliveries', icon: Truck, ...base },
    { key: 'active_promotions', label: 'Active Promos', icon: Megaphone, ...warn },
  ]

  const transport: StatCard[] = [
    { key: 'active_bookings', label: 'Active Bookings', icon: CalendarCheck, ...base },
    { key: 'total_revenue', label: 'Total Revenue', icon: DollarSign, ...warn, isCurrency: true },
    { key: 'pending_orders', label: 'Pending Bookings', icon: ClipboardList, ...warn },
    { key: 'total_menu_items', label: 'Vehicles', icon: Car, ...base },
    { key: 'total_orders', label: 'Total Customers', icon: Users, ...base },
    { key: 'active_promotions', label: 'Active Promos', icon: Megaphone, ...warn },
  ]

  const facilities: StatCard[] = [
    { key: 'active_bookings', label: 'Active Bookings', icon: CalendarCheck, ...base },
    { key: 'total_revenue', label: 'Total Revenue', icon: DollarSign, ...warn, isCurrency: true },
    { key: 'pending_orders', label: 'Pending Bookings', icon: ClipboardList, ...warn },
    { key: 'total_menu_items', label: 'Gallery Items', icon: Package, ...base },
    { key: 'total_orders', label: 'Total Customers', icon: Users, ...base },
    { key: 'active_promotions', label: 'Active Promos', icon: Megaphone, ...warn },
  ]

  switch (category) {
    case 'Hotel':
    case 'Resort':
    case 'Homestay':
      return accommodation
    case 'Tour Guide':
    case 'Travel Agency':
      return tours
    case 'Souvenir Shop':
      return shop
    case 'Transport Service':
      return transport
    case 'Tourist Attraction':
    case 'Camping Site':
    case 'Event Venue':
    case 'Farm Tourism':
    case 'Dive Shop':
      return facilities
    case 'Restaurant':
    case 'Café':
    case 'Food Hub':
    case 'Hotel & Restaurant Combination':
    default:
      return food
  }
}

function getShortcuts(category: string, stats: Record<string, any>): Shortcut[] {
  const pending = stats?.pending_orders ?? 0
  const active = stats?.active_bookings ?? 0
  const items = stats?.total_menu_items ?? 0

  const food: Shortcut[] = [
    { label: 'Manage Orders', path: '/staff/orders', icon: Package, count: `${pending} pending` },
    { label: 'Manage Bookings', path: '/staff/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Menu Items', path: '/staff/menu', icon: Utensils, count: `${items} items` },
  ]

  const accommodation: Shortcut[] = [
    { label: 'Reservations', path: '/staff/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Room Management', path: '/staff/offerings', icon: Bed, count: `${items} rooms` },
    { label: 'Check-in / Check-out', path: '/staff/bookings/calendar', icon: ClipboardList, count: `${pending} pending` },
  ]

  const tours: Shortcut[] = [
    { label: 'Tour Bookings', path: '/staff/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Tour Packages', path: '/staff/menu', icon: Package, count: `${items} packages` },
    { label: 'Schedules', path: '/staff/scheduling', icon: ClipboardList, count: 'Manage' },
  ]

  const shop: Shortcut[] = [
    { label: 'Manage Orders', path: '/staff/orders', icon: ShoppingBag, count: `${pending} pending` },
    { label: 'Products', path: '/staff/offerings', icon: Package, count: `${items} products` },
    { label: 'Delivery', path: '/staff/dispatch', icon: Truck, count: 'Dispatch' },
  ]

  const transport: Shortcut[] = [
    { label: 'Bookings', path: '/staff/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Vehicles', path: '/staff/offerings', icon: Car, count: `${items} vehicles` },
    { label: 'Drivers', path: '/staff/staff', icon: Users, count: 'Manage' },
  ]

  const facilities: Shortcut[] = [
    { label: 'Bookings', path: '/staff/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Gallery', path: '/staff/gallery', icon: MapPin, count: 'Manage' },
    { label: 'Customers', path: '/staff/customers', icon: Users, count: 'View' },
  ]

  switch (category) {
    case 'Hotel':
    case 'Resort':
    case 'Homestay':
      return accommodation
    case 'Tour Guide':
    case 'Travel Agency':
      return tours
    case 'Souvenir Shop':
      return shop
    case 'Transport Service':
      return transport
    case 'Tourist Attraction':
    case 'Camping Site':
    case 'Event Venue':
    case 'Farm Tourism':
    case 'Dive Shop':
      return facilities
    case 'Restaurant':
    case 'Café':
    case 'Food Hub':
    case 'Hotel & Restaurant Combination':
    default:
      return food
  }
}

export default function StaffDashboard() {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['staff-dashboard'],
    queryFn: () => get<StaffDashboardData>(`/staff/dashboard`),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className="text-center py-20 text-[#6B7280]">Unable to load dashboard data.</div>

  const { staff, business, today_summary: summary, recent_orders: orders, recent_bookings: bookings } = data

  // Map staff summary to owner-style stats where possible
  const stats = {
    total_orders: (orders?.length ?? 0) + (bookings?.length ?? 0),
    total_revenue: summary?.revenue_today ?? 0,
    active_bookings: bookings?.length ?? 0,
    pending_orders: summary?.pending ?? 0,
    total_menu_items: 0,
    active_promotions: 0,
  }

  const category = business?.category || 'Restaurant'
  const activeStats = getStatCards(category)
  const activeShortcuts = getShortcuts(category, stats)

  const activities = [
    ...orders.map((o) => ({ key: `o-${o.id}`, type: 'Order' as const, ref: o.order_number, customer: o.customer_name, status: o.status, date: o.created_at, amount: o.total })),
    ...bookings.map((b) => ({ key: `b-${b.id}`, type: 'Booking' as const, ref: b.booking_number, customer: b.customer_name, status: b.status, date: b.created_at || '', amount: b.total_amount })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)

  return (
    <div>
      {/* Page Header with subtle tourism backdrop */}
      <div className="relative overflow-hidden rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism mb-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08]" aria-hidden>
          <TourismBackdrop />
        </div>
        <div className="relative px-6 py-5 lg:px-8 lg:py-6">
          <h1 className="text-2xl lg:text-[32px] font-bold text-[#126B32] leading-tight">{business?.name || 'Staff Dashboard'}</h1>
          <p className="mt-1 text-sm text-[#6B7280]">{business?.category || 'Business'} &bull; Staff Dashboard</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
        {activeStats.map((card) => {
          const value = (stats as any)?.[card.key] ?? 0
          const Icon = card.icon
          return (
            <div key={card.key} className="bg-white border border-[#E2E8E3] rounded-2xl p-[26px] shadow-tourism transition-all duration-200 hover:shadow-[0_10px_24px_rgba(22,101,52,0.12)] hover:-translate-y-0.5">
              <div className="flex items-start justify-between">
                <div>
                  <p className={`text-[13px] font-bold uppercase tracking-[0.03em] ${card.labelClass}`}>{card.label}</p>
                  <p className="mt-2 text-2xl lg:text-[32px] font-bold text-[#17201A] leading-tight">
                    {card.isCurrency ? formatCurrency(Number(value)) : value}
                  </p>
                </div>
                <div className={`w-12 h-12 ${card.iconBg} rounded-xl flex items-center justify-center shrink-0`}>
                  <Icon className={`w-6 h-6 ${card.iconText}`} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Management Shortcut Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
        {activeShortcuts.map((s) => {
          const Icon = s.icon
          return (
            <button
              key={s.label}
              onClick={() => navigate(s.path)}
              className="group relative overflow-hidden rounded-[14px] px-6 py-[22px] text-left text-white bg-gradient-to-br from-[#126B32] to-[#16803C] shadow-tourism-lg transition-all duration-200 hover:shadow-[0_14px_28px_rgba(22,101,52,0.25)] hover:-translate-y-0.5"
            >
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-white/15 flex items-center justify-center shrink-0">
                  <Icon className="w-7 h-7 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-white text-base">{s.label}</h3>
                  <p className="text-sm text-white/75">{s.count}</p>
                </div>
                <ArrowRight className="w-5 h-5 text-white/80 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </div>
            </button>
          )
        })}
      </div>

      {/* Recent Activity Panel */}
      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-[0_6px_18px_rgba(22,101,52,0.05)] p-7 min-h-[230px]">
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 className="text-lg font-bold text-[#17201A]">Recent Activity</h2>
          <button
            onClick={() => navigate('/staff/activity-logs')}
            className="bg-white text-[#16803C] border border-[#D7E8DB] rounded-[10px] px-4 py-[10px] text-sm font-medium transition-colors hover:bg-[#EAF6ED]"
          >
            View All Activity
          </button>
        </div>

        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="relative mb-4">
              <div className="w-16 h-16 rounded-full bg-[#EAF6ED] flex items-center justify-center">
                <ClipboardCheck className="w-8 h-8 text-[#16803C]" />
              </div>
              <Leaf className="absolute -top-1.5 -right-2 w-5 h-5 text-[#126B32]/40" />
              <Leaf className="absolute -bottom-1.5 -left-2 w-4 h-4 text-[#16803C]/40 rotate-[-25deg]" />
            </div>
            <p className="text-sm font-medium text-[#17201A]">No recent activity yet.</p>
            <p className="mt-1 text-sm text-[#6B7280]">Activity logs will appear here once there are updates.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#E2E8E3]">
            {activities.map((a) => (
              <li key={a.key} className="flex items-center gap-4 py-3">
                <div className="w-9 h-9 rounded-lg bg-[#EAF6ED] flex items-center justify-center shrink-0">
                  {a.type === 'Order' ? (
                    <Package className="w-4 h-4 text-[#16803C]" />
                  ) : (
                    <CalendarCheck className="w-4 h-4 text-[#16803C]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#17201A] truncate">
                    {a.type} {a.ref} <span className="text-[#6B7280]">&bull;</span> {a.customer}
                  </p>
                  <p className="text-xs text-[#6B7280]">{formatDateTime(a.date)}</p>
                </div>
                <span className="text-sm font-semibold text-[#17201A] shrink-0">{formatCurrency(a.amount)}</span>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
