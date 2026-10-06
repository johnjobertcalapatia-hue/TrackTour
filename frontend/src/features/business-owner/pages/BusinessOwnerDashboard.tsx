import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { Package, DollarSign, CalendarCheck, ClipboardList, Utensils, Megaphone, ArrowRight, ClipboardCheck, Leaf, Bed, Users, Car, MapPin, Truck, ShoppingBag } from 'lucide-react'

interface DashboardData {
  businesses: { id: number; name: string; category: string; status: string; logo: string | null }[]
  selected_business_id: number | null
  business: { name: string; category: string }
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
  const warn = { labelClass: 'text-[#A66F00]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' }

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

function getShortcuts(category: string, stats: DashboardData['stats']): Shortcut[] {
  const pending = stats?.pending_orders ?? 0
  const active = stats?.active_bookings ?? 0
  const items = stats?.total_menu_items ?? 0

  const food: Shortcut[] = [
    { label: 'Manage Orders', path: '/business-owner/orders', icon: Package, count: `${pending} pending` },
    { label: 'Manage Bookings', path: '/business-owner/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Menu Items', path: '/business-owner/menu', icon: Utensils, count: `${items} items` },
  ]

  const accommodation: Shortcut[] = [
    { label: 'Reservations', path: '/business-owner/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Room Management', path: '/business-owner/offerings', icon: Bed, count: `${items} rooms` },
    { label: 'Check-in / Check-out', path: '/business-owner/bookings/calendar', icon: ClipboardList, count: `${pending} pending` },
  ]

  const tours: Shortcut[] = [
    { label: 'Tour Bookings', path: '/business-owner/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Tour Packages', path: '/business-owner/menu', icon: Package, count: `${items} packages` },
    { label: 'Schedules', path: '/business-owner/scheduling', icon: ClipboardList, count: 'Manage' },
  ]

  const shop: Shortcut[] = [
    { label: 'Manage Orders', path: '/business-owner/orders', icon: ShoppingBag, count: `${pending} pending` },
    { label: 'Products', path: '/business-owner/offerings', icon: Package, count: `${items} products` },
    { label: 'Delivery', path: '/business-owner/dispatch', icon: Truck, count: 'Dispatch' },
  ]

  const transport: Shortcut[] = [
    { label: 'Bookings', path: '/business-owner/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Vehicles', path: '/business-owner/offerings', icon: Car, count: `${items} vehicles` },
    { label: 'Drivers', path: '/business-owner/staff', icon: Users, count: 'Manage' },
  ]

  const facilities: Shortcut[] = [
    { label: 'Bookings', path: '/business-owner/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Gallery', path: '/business-owner/gallery', icon: MapPin, count: 'Manage' },
    { label: 'Customers', path: '/business-owner/customers', icon: Users, count: 'View' },
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

function TourismBackdrop() {
  return (
    <svg className="w-full h-full" viewBox="0 0 1200 240" preserveAspectRatio="xMidYMid slice" fill="none" aria-hidden>
      <circle cx="1060" cy="52" r="24" fill="#F4B400" />
      <path d="M0 240 L150 96 L330 240 Z" fill="#1E7A48" />
      <path d="M260 240 L440 48 L660 240 Z" fill="#126B32" />
      <path d="M580 240 L780 104 L1000 240 Z" fill="#16803C" />
      <path d="M900 240 L1060 132 L1200 240 Z" fill="#0F5C33" />
      <path d="M150 140 q9 -9 18 0 q9 -9 18 0" stroke="#126B32" strokeWidth="3" strokeLinecap="round" />
      <path d="M210 116 q7 -7 14 0 q7 -7 14 0" stroke="#16803C" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M178 104 q7 -7 14 0" stroke="#126B32" strokeWidth="2.5" strokeLinecap="round" />
      <g transform="translate(80 160)">
        <path d="M12 70 q-7 -32 4 -62" stroke="#126B32" strokeWidth="4.5" strokeLinecap="round" />
        <path d="M16 14 q-19 -7 -32 4 M16 14 q-21 2 -29 15 M16 14 q19 -7 32 4 M16 14 q21 2 29 15" stroke="#16803C" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g transform="translate(1125 175)">
        <path d="M10 55 q-5 -24 3 -48" stroke="#126B32" strokeWidth="4" strokeLinecap="round" />
        <path d="M13 11 q-15 -5 -25 4 M13 11 q-16 2 -22 12 M13 11 q15 -5 25 4 M13 11 q16 2 22 12" stroke="#16803C" strokeWidth="3.5" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export default function BusinessOwnerDashboard() {
  const navigate = useNavigate()
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const getSelectedBusiness = useBusinessOwnerStore((s) => s.getSelectedBusiness)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-dashboard', selectedBusinessId],
    queryFn: () => {
      const params = selectedBusinessId ? `?business_id=${selectedBusinessId}` : ''
      return get<DashboardData>(`/business-owner/dashboard${params}`)
    },
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className="text-center py-20 text-[#647067]">Unable to load dashboard data.</div>

  const { business, stats, recent_orders: orders, recent_bookings: bookings } = data
  const selectedBiz = getSelectedBusiness()
  const category = selectedBiz?.category || business?.category || 'Restaurant'

  const categoryLabel: Record<string, string> = {
    Restaurant: 'Restaurant',
    Café: 'Café',
    'Food Hub': 'Food Hub',
    'Hotel & Restaurant Combination': 'Hotel & Restaurant',
    Hotel: 'Hotel',
    Resort: 'Resort',
    Homestay: 'Homestay',
    'Tourist Attraction': 'Tourist Attraction',
    'Tour Guide': 'Tour Guide',
    'Travel Agency': 'Travel Agency',
    'Souvenir Shop': 'Souvenir Shop',
    'Transport Service': 'Transport Service',
    'Camping Site': 'Camping Site',
    'Dive Shop': 'Dive Shop',
    'Event Venue': 'Event Venue',
    'Farm Tourism': 'Farm Tourism',
  }

  const dashboardLabel = categoryLabel[category] || category
  const isAllBusinesses = !selectedBusinessId

  const navigateTo = (a: { id: number; type: 'Order' | 'Booking' }) =>
    a.type === 'Order' ? `/business-owner/orders/${a.id}` : `/business-owner/bookings/${a.id}`

  const activities = [
    ...orders.map((o) => ({ key: `o-${o.id}`, id: o.id, type: 'Order' as const, ref: o.order_number, customer: o.customer_name, status: o.status, date: o.created_at, amount: o.total })),
    ...bookings.map((b) => ({ key: `b-${b.id}`, id: b.id, type: 'Booking' as const, ref: b.booking_number, customer: b.customer_name, status: b.status, date: b.created_at, amount: b.total_amount })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)

  const activeStats = getStatCards(category)
  const activeShortcuts = getShortcuts(category, stats)

  return (
    <div>
      {/* Page Header with subtle tourism backdrop */}
      <div className="relative overflow-hidden rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism mb-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08]" aria-hidden>
          <TourismBackdrop />
        </div>
        <div className="relative px-6 py-5 lg:px-8 lg:py-6">
          <h1 className="text-2xl lg:text-[32px] font-bold text-[#126B32] leading-tight">
            {isAllBusinesses ? 'All Businesses' : (business?.name || dashboardLabel)}
          </h1>
          <p className="mt-1 text-sm text-[#647067]">
            {isAllBusinesses ? `${data.businesses?.length || 0} businesses` : dashboardLabel} &bull; Owner Dashboard
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
        {activeStats.map((card) => {
          const value = stats?.[card.key] ?? 0
          const Icon = card.icon
          return (
            <div key={card.key} className="bg-white border border-[#E2E8E3] rounded-2xl p-[26px] shadow-tourism transition-all duration-200 hover:shadow-[0_10px_24px_rgba(22,128,60,0.1)] hover:-translate-y-0.5">
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
              className="group relative overflow-hidden rounded-[14px] px-6 py-[22px] text-left text-white bg-[#16803C] shadow-tourism transition-all duration-200 hover:bg-[#126B32] hover:shadow-[0_14px_28px_rgba(22,128,60,0.2)] hover:-translate-y-0.5"
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
      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-7 min-h-[230px]">
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 className="text-lg font-bold text-[#17201A]">Recent Activity</h2>
          <button
            onClick={() => navigate('/business-owner/activity-logs')}
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
            <p className="mt-1 text-sm text-[#647067]">Activity logs will appear here once there are updates.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[#E2E8E3]">
            {activities.map((a) => (
              <li
              key={a.key}
              onClick={() => navigate(navigateTo(a))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate(navigateTo(a))
                }
              }}
              role="button"
              tabIndex={0}
              className="flex items-center gap-4 py-3 cursor-pointer rounded-lg px-1 -mx-1 transition hover:bg-[#F6F8F4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#16803C]/40"
            >
                <div className="w-9 h-9 rounded-lg bg-[#EAF6ED] flex items-center justify-center shrink-0">
                  {a.type === 'Order' ? (
                    <Package className="w-4 h-4 text-[#16803C]" />
                  ) : (
                    <CalendarCheck className="w-4 h-4 text-[#16803C]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#17201A] truncate">
                    {a.type} {a.ref} <span className="text-[#647067]">&bull;</span> {a.customer}
                  </p>
                  <p className="text-xs text-[#647067]">{formatDateTime(a.date)}</p>
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
