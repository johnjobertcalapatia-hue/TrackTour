import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Building2, MapPin, Calendar, Megaphone, Users, TrendingUp } from 'lucide-react'

interface DashboardData {
  stats: {
    total_business_owners: number
    approved_owners: number
    pending_owners: number
  }
  tourism: {
    total_destinations: number
    active_destinations: number
    total_events: number
    upcoming_events: number
    total_announcements: number
    published_announcements: number
  }
  recent_businesses: { id: number; name: string; category: string; status: string; municipality: string }[]
  top_municipalities: { name: string; businesses: number; bookings: number }[]
}

export default function TourismOfficeDashboard() {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['to-dashboard'],
    queryFn: () => get<DashboardData>('/tourism-office/dashboard'),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className="text-center py-20 text-ink-soft">Unable to load dashboard data.</div>

  const { stats, tourism } = data

  const statCards = [
    { label: 'Total Destinations', value: tourism?.total_destinations ?? 0, icon: MapPin, iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', onClick: () => navigate('/tourism-office/destinations') },
    { label: 'Active Destinations', value: tourism?.active_destinations ?? 0, icon: MapPin, iconBg: 'bg-blue-50', iconText: 'text-blue-600', onClick: () => navigate('/tourism-office/destinations') },
    { label: 'Upcoming Events', value: tourism?.upcoming_events ?? 0, icon: Calendar, iconBg: 'bg-purple-50', iconText: 'text-purple-600', onClick: () => navigate('/tourism-office/events') },
    { label: 'Total Events', value: tourism?.total_events ?? 0, icon: Calendar, iconBg: 'bg-pink-50', iconText: 'text-pink-600', onClick: () => navigate('/tourism-office/events') },
    { label: 'Published Announcements', value: tourism?.published_announcements ?? 0, icon: Megaphone, iconBg: 'bg-amber-50', iconText: 'text-amber-600', onClick: () => navigate('/tourism-office/announcements') },
    { label: 'Total Business Owners', value: stats.total_business_owners, icon: Building2, iconBg: 'bg-gray-100', iconText: 'text-gray-600', onClick: () => navigate('/tourism-office/business-owners') },
    { label: 'Approved Owners', value: stats.approved_owners, icon: Users, iconBg: 'bg-emerald-50', iconText: 'text-emerald-600' },
    { label: 'Pending Approvals', value: stats.pending_owners, icon: TrendingUp, iconBg: 'bg-amber-50', iconText: 'text-amber-600', onClick: () => navigate('/tourism-office/business-owners') },
  ]

  const quickActions = [
    { label: 'Add Destination', icon: MapPin, path: '/tourism-office/destinations', color: 'bg-emerald-600 hover:bg-emerald-700' },
    { label: 'Add Event', icon: Calendar, path: '/tourism-office/events', color: 'bg-purple-600 hover:bg-purple-700' },
    { label: 'Add Announcement', icon: Megaphone, path: '/tourism-office/announcements', color: 'bg-amber-600 hover:bg-amber-700' },
  ]

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-ink">Tourism Office Dashboard</h1>
        <p className="mt-1 text-sm text-ink-soft">Overview of tourism activities in the municipality</p>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3 mb-8">
        {quickActions.map((action) => {
          const Icon = action.icon
          return (
            <button
              key={action.label}
              onClick={() => navigate(action.path)}
              className={`${action.color} text-white px-4 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5`}
            >
              <Icon className="w-4 h-4" />
              {action.label}
            </button>
          )
        })}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map((card, i) => {
          const Icon = card.icon
          return (
            <div
              key={i}
              onClick={card.onClick}
              className={`bg-white border border-gray-200 rounded-2xl p-5 shadow-glass transition-all duration-200 hover:shadow-glass-lg hover:-translate-y-0.5 ${card.onClick ? 'cursor-pointer' : ''}`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">{card.label}</p>
                  <p className="mt-2 text-2xl lg:text-3xl font-bold text-ink">{card.value}</p>
                </div>
                <div className={`w-10 h-10 ${card.iconBg} rounded-xl flex items-center justify-center`}>
                  <Icon className={`w-5 h-5 ${card.iconText}`} />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
