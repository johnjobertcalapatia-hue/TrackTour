import { CalendarCheck, DollarSign, Bed, ClipboardList, Package, Megaphone } from 'lucide-react'
import { StatCard } from './StatCard'
import { QuickActionCard } from './QuickActionCard'
import { RecentActivity } from './RecentActivity'
import { EmptyDashboard } from './EmptyDashboard'
import type { DashboardProps, StatCardConfig, QuickAction } from './types'

const statCards: StatCardConfig[] = [
  { key: 'active_bookings', label: 'Active Reservations', icon: CalendarCheck, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'total_revenue', label: 'Total Revenue', icon: DollarSign, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]', isCurrency: true },
  { key: 'pending_orders', label: 'Pending Check-ins', icon: ClipboardList, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' },
  { key: 'total_menu_items', label: 'Rooms', icon: Bed, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'total_orders', label: 'Total Bookings', icon: Package, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'active_promotions', label: 'Active Promos', icon: Megaphone, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' },
]

export function HotelDashboard({ data, businessName }: DashboardProps) {
  const { stats } = data
  const active = stats?.active_bookings ?? 0
  const pending = stats?.pending_orders ?? 0
  const rooms = stats?.total_menu_items ?? 0

  const shortcuts: QuickAction[] = [
    { label: 'Reservations', path: '/business-owner/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Room Management', path: '/business-owner/offerings', icon: Bed, count: `${rooms} rooms` },
    { label: 'Check-in / Check-out', path: '/business-owner/bookings/calendar', icon: ClipboardList, count: `${pending} pending` },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {statCards.map((card) => (
          <StatCard key={card.key} config={card} value={stats?.[card.key] ?? 0} />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {shortcuts.map((s) => (
          <QuickActionCard key={s.label} action={s} />
        ))}
      </div>

      {stats?.active_bookings === 0 && stats?.total_orders === 0 ? (
        <EmptyDashboard
          title="No reservations yet"
          description={`Once guests make reservations at ${businessName}, they will appear here.`}
        />
      ) : (
        <RecentActivity data={data} />
      )}
    </div>
  )
}
