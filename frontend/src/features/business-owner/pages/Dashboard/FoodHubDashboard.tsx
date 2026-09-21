import { Package, DollarSign, CalendarCheck, ClipboardList, Utensils, Megaphone } from 'lucide-react'
import { StatCard } from './StatCard'
import { QuickActionCard } from './QuickActionCard'
import { RecentActivity } from './RecentActivity'
import { EmptyDashboard } from './EmptyDashboard'
import type { DashboardProps, StatCardConfig, QuickAction } from './types'

const statCards: StatCardConfig[] = [
  { key: 'total_orders', label: 'Total Orders', icon: Package, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'total_revenue', label: 'Total Revenue', icon: DollarSign, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]', isCurrency: true },
  { key: 'pending_orders', label: 'Pending Orders', icon: ClipboardList, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' },
  { key: 'total_menu_items', label: 'Menu Items', icon: Utensils, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'active_bookings', label: 'Active Bookings', icon: CalendarCheck, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'active_promotions', label: 'Active Promos', icon: Megaphone, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' },
]

export function FoodHubDashboard({ data, businessName }: DashboardProps) {
  const { stats } = data
  const pending = stats?.pending_orders ?? 0
  const active = stats?.active_bookings ?? 0
  const items = stats?.total_menu_items ?? 0

  const shortcuts: QuickAction[] = [
    { label: 'Manage Orders', path: '/business-owner/orders', icon: Package, count: `${pending} pending` },
    { label: 'Menu Items', path: '/business-owner/menu', icon: Utensils, count: `${items} items` },
    { label: 'Manage Bookings', path: '/business-owner/bookings', icon: CalendarCheck, count: `${active} active` },
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

      {stats?.total_orders === 0 && stats?.active_bookings === 0 ? (
        <EmptyDashboard
          title="No orders yet"
          description={`Once customers start ordering from ${businessName}, their orders will appear here.`}
        />
      ) : (
        <RecentActivity data={data} />
      )}
    </div>
  )
}
