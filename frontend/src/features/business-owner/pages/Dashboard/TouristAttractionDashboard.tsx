import { CalendarCheck, DollarSign, Users, ClipboardList, Package, Megaphone } from 'lucide-react'
import { StatCard } from './StatCard'
import { QuickActionCard } from './QuickActionCard'
import { RecentActivity } from './RecentActivity'
import { EmptyDashboard } from './EmptyDashboard'
import type { DashboardProps, StatCardConfig, QuickAction } from './types'

const statCards: StatCardConfig[] = [
  { key: 'total_orders', label: 'Total Visitors', icon: Users, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'active_bookings', label: 'Active Bookings', icon: CalendarCheck, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'total_revenue', label: 'Total Revenue', icon: DollarSign, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]', isCurrency: true },
  { key: 'pending_orders', label: 'Pending Bookings', icon: ClipboardList, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' },
  { key: 'total_menu_items', label: 'Gallery Items', icon: Package, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'active_promotions', label: 'Active Promos', icon: Megaphone, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' },
]

export function TouristAttractionDashboard({ data, businessName }: DashboardProps) {
  const { stats } = data
  const active = stats?.active_bookings ?? 0

  const shortcuts: QuickAction[] = [
    { label: 'Manage Bookings', path: '/business-owner/bookings', icon: CalendarCheck, count: `${active} active` },
    { label: 'Gallery', path: '/business-owner/gallery', icon: Package, count: 'Manage' },
    { label: 'Customers', path: '/business-owner/customers', icon: Users, count: 'View' },
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
          title="No bookings yet"
          description={`Once visitors start booking at ${businessName}, their bookings will appear here.`}
        />
      ) : (
        <RecentActivity data={data} />
      )}
    </div>
  )
}
