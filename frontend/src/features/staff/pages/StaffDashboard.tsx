import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { apiErrorMessage, get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { useStaffPermissions, type StaffPermission } from '../services/use-staff-permissions'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import {
  ArrowRight, BarChart3, BookOpen, CalendarCheck, CheckCircle2, ClipboardCheck, ClipboardList, CookingPot, CreditCard,
  DoorOpen, Hourglass, LayoutDashboard, Megaphone, Package, UserRound, XCircle,
} from 'lucide-react'

interface DashboardItem { status: string; total_price?: number | string | null; unit_price?: number | string | null; quantity?: number | null }

interface StaffDashboardData {
  staff: { full_name: string; role: string; employee_id?: string | null }
  business: { name: string; category: string }
  /** Orders (orders.view) or bookings (bookings.view) counts for today. */
  today_summary: Partial<Record<'pending' | 'confirmed' | 'in_progress' | 'completed_today' | 'cancelled_today', number>>
  recent_orders: { id: number; order_number: string; customer_name: string; status: string; total: number; created_at: string; items?: DashboardItem[]; shared_with_other_restaurants?: boolean }[]
  recent_bookings: { id: number; booking_number: string; customer_name: string; status: string; total_amount: number; created_at?: string }[]
}

const CARD = 'rounded-[20px] border border-[#E2E8E3] bg-[#fff] shadow-[0_6px_18px_rgba(22,101,52,0.06)]'

interface Stat { key: keyof StaffDashboardData['today_summary']; label: string; hint: string; icon: ReactNode; tone: 'green' | 'gold' | 'red' }

const ORDER_STATS: Stat[] = [
  { key: 'pending', label: 'Finding a rider', hint: 'Preparation starts when a rider accepts', icon: <Hourglass />, tone: 'gold' },
  { key: 'in_progress', label: 'Preparing or ready', hint: 'Food being made or waiting for pickup', icon: <CookingPot />, tone: 'green' },
  { key: 'completed_today', label: 'Completed today', hint: 'Delivered or picked up', icon: <CheckCircle2 />, tone: 'green' },
  { key: 'cancelled_today', label: 'Cancelled today', hint: 'Cancelled or rejected', icon: <XCircle />, tone: 'red' },
]

const BOOKING_STATS: Stat[] = [
  { key: 'pending', label: 'Pending bookings', hint: 'Waiting for confirmation', icon: <Hourglass />, tone: 'gold' },
  { key: 'confirmed', label: 'Confirmed', hint: 'Guests on the way', icon: <CalendarCheck />, tone: 'green' },
  { key: 'in_progress', label: 'Checked in', hint: 'Guests staying now', icon: <DoorOpen />, tone: 'green' },
  { key: 'completed_today', label: 'Completed today', hint: 'Checked out today', icon: <CheckCircle2 />, tone: 'green' },
]

const TONES: Record<Stat['tone'], string> = {
  green: 'bg-[#EAF6ED] text-[#16803C]',
  gold: 'bg-[#FFF6DB] text-[#B7791F]',
  red: 'bg-[#FDECEC] text-[#B91C1C]',
}

/** Every staff page, with the permission that opens it. */
const SHORTCUTS: { to: string; label: string; description: string; icon: ReactNode; permission: StaffPermission }[] = [
  { to: '/staff/orders', label: 'Orders', description: 'Mark food ready, confirm rider cash and handovers', icon: <ClipboardList />, permission: 'orders.view' },
  { to: '/staff/bookings', label: 'Bookings', description: 'Confirm, check in and complete bookings', icon: <CalendarCheck />, permission: 'bookings.view' },
  { to: '/staff/menu', label: 'Menu', description: 'Dishes, photos and availability', icon: <BookOpen />, permission: 'menu.view' },
  { to: '/staff/promotions', label: 'Deals & Posts', description: 'Posts, dish sales and badges', icon: <Megaphone />, permission: 'promotions.manage' },
  { to: '/staff/reports', label: 'Sales & Reports', description: 'Sales, earnings and COD settlements', icon: <BarChart3 />, permission: 'finance.view' },
  { to: '/staff/expenses', label: 'Expenses', description: 'Record and review expenses', icon: <CreditCard />, permission: 'finance.view' },
]

/** A staff member in a shared (group) order sees only their own items: their total. */
function orderAmount(order: StaffDashboardData['recent_orders'][number]): number {
  if (!order.shared_with_other_restaurants || !order.items) return Number(order.total ?? 0)
  return order.items
    .filter((i) => !['cancelled', 'rejected'].includes(i.status))
    .reduce((sum, i) => sum + Number(i.total_price ?? Number(i.unit_price ?? 0) * Number(i.quantity ?? 0)), 0)
}

/**
 * Staff dashboard (owner-portal look, 2026-11-24): today's counts for what the
 * role covers (orders or bookings), shortcuts to the pages the role opens, and
 * the latest orders/bookings. No revenue: that is not a staff permission.
 */
export default function StaffDashboard() {
  const { can } = useStaffPermissions()
  const { data, isLoading, error } = useQuery({
    queryKey: ['staff-dashboard'],
    queryFn: () => get<StaffDashboardData>('/staff/dashboard'),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className={`${CARD} p-12 text-center text-sm text-[#5E6B63]`}>{apiErrorMessage(error, "Couldn't load your dashboard.")}</div>

  const { staff, business, today_summary: summary = {}, recent_orders: orders = [], recent_bookings: bookings = [] } = data
  const stats = can('orders.view') ? ORDER_STATS : can('bookings.view') ? BOOKING_STATS : []
  const shortcuts = SHORTCUTS.filter((s) => can(s.permission))
  const firstName = staff?.full_name?.split(' ')[0] || 'there'

  const activities = [
    ...orders.map((o) => ({ key: `o-${o.id}`, type: 'Order' as const, to: `/staff/orders/${o.id}`, ref: o.order_number, customer: o.customer_name, status: o.status, date: o.created_at, amount: orderAmount(o) })),
    ...bookings.map((b) => ({ key: `b-${b.id}`, type: 'Booking' as const, to: '/staff/bookings', ref: b.booking_number, customer: b.customer_name, status: b.status, date: b.created_at || '', amount: Number(b.total_amount ?? 0) })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)
  const seeAll = can('orders.view') ? '/staff/orders' : can('bookings.view') ? '/staff/bookings' : null

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0F4D2B] text-white"><LayoutDashboard className="h-6 w-6" aria-hidden="true" /></span>
        <div>
          <h1 className="text-2xl font-bold text-[#17201B] lg:text-3xl">Good day, {firstName}!</h1>
          <p className="mt-1 text-sm text-[#5E6B63]">{staff?.role ?? 'Staff'} at {business?.name}</p>
        </div>
      </div>

      {stats.length > 0 && (
        <section aria-label="Today" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.key} className={`${CARD} p-5`} data-testid={`stat-${stat.key}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">{stat.label}</p>
                  <p className="mt-2 text-3xl font-bold tabular-nums text-[#17201B]">{Number(summary[stat.key] ?? 0)}</p>
                </div>
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl [&>svg]:h-5 [&>svg]:w-5 ${TONES[stat.tone]}`}>{stat.icon}</span>
              </div>
              <p className="mt-2 text-xs text-[#8A948E]">{stat.hint}</p>
            </div>
          ))}
        </section>
      )}

      <section aria-label="Your pages" className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shortcuts.map((s) => (
          <Link
            key={s.to}
            to={s.to}
            className="group flex items-center gap-4 rounded-[20px] bg-gradient-to-br from-[#0F4D2B] to-[#16803C] px-5 py-5 text-white shadow-[0_10px_24px_rgba(15,77,43,0.18)] transition hover:-translate-y-0.5"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#ffffff26] [&>svg]:h-6 [&>svg]:w-6">{s.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{s.label}</span>
              <span className="block text-sm text-[#D7EBDD]">{s.description}</span>
            </span>
            <ArrowRight className="h-5 w-5 shrink-0 text-[#D7EBDD] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        ))}
        <Link to="/staff/profile" className={`${CARD} group flex items-center gap-4 px-5 py-5 transition hover:-translate-y-0.5`}>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#EAF6ED] text-[#16803C]"><UserRound className="h-6 w-6" aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold text-[#17201B]">My Profile</span>
            <span className="block text-sm text-[#5E6B63]">Contact details, photo and password</span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 text-[#8A948E] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </section>

      {seeAll && (
        <section aria-label="Recent activity" className={`${CARD} p-5 sm:p-6`}>
          <div className="mb-4 flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-[#17201B]">Recent activity</h2>
            <Link to={seeAll} className="rounded-xl border border-[#D7E8DB] bg-[#fff] px-4 py-2 text-sm font-semibold text-[#16803C] transition hover:bg-[#EAF6ED]">
              See all
            </Link>
          </div>
          {activities.length === 0 ? (
            <div className="flex flex-col items-center py-10 text-center">
              <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#EAF6ED]"><ClipboardCheck className="h-7 w-7 text-[#16803C]" aria-hidden="true" /></span>
              <p className="text-sm font-medium text-[#17201B]">Nothing yet.</p>
              <p className="mt-1 text-sm text-[#5E6B63]">New orders and bookings will appear here.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[#E2E8E3]">
              {activities.map((a) => (
                <li key={a.key}>
                  <Link to={a.to} className="-mx-2 flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-[#F6F8F4] sm:gap-4">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#EAF6ED] text-[#16803C]">
                      {a.type === 'Order' ? <Package className="h-4 w-4" aria-hidden="true" /> : <CalendarCheck className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[#17201B]">{a.type} {a.ref} <span className="text-[#8A948E]">·</span> {a.customer}</span>
                      <span className="block text-xs text-[#5E6B63]">{formatDateTime(a.date)}</span>
                    </span>
                    <span className="hidden shrink-0 text-sm font-semibold tabular-nums text-[#17201B] sm:block">{formatCurrency(a.amount)}</span>
                    <StatusBadge status={a.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
