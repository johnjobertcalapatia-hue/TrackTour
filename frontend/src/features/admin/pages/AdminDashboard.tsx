import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDate } from '@/shared/utils'
import { API_ENDPOINTS } from '@/shared/constants'
import { Users, Building2, MapPin, ClipboardCheck, Briefcase, FileCheck, CheckCircle } from 'lucide-react'

interface DashboardData {
  user: { id: number; name: string; role: string }
  stats: {
    total_users: number
    total_businesses: number
    total_municipalities: number
    pending_verifications: number
    business_owners: number
    pending_review: number
    approved_owners: number
  }
  usersByRole: Record<string, number>
  recentUsers: {
    id: number
    name: string
    email: string
    role: string
    account_status: string
    created_at: string
  }[]
  recentBusinesses: {
    id: number
    name: string
    category: string
    municipality: string
    status: string
    created_at: string
  }[]
}

const statCards = [
  { key: 'total_users' as const, label: 'Total Users', icon: Users, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'total_businesses' as const, label: 'Total Businesses', icon: Building2, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' },
  { key: 'total_municipalities' as const, label: 'Municipalities', icon: MapPin, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'pending_verifications' as const, label: 'Pending Verifications', icon: ClipboardCheck, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' },
  { key: 'business_owners' as const, label: 'Business Owners', icon: Briefcase, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
  { key: 'pending_review' as const, label: 'Pending Review', icon: FileCheck, labelClass: 'text-[#F4B400]', iconBg: 'bg-[#FFF7D6]', iconText: 'text-[#F4B400]' },
  { key: 'approved_owners' as const, label: 'Approved Owners', icon: CheckCircle, labelClass: 'text-[#16803C]', iconBg: 'bg-[#EAF6ED]', iconText: 'text-[#16803C]' },
]

const roleColors: Record<string, string> = {
  tourist: 'bg-[#16803C]',
  business_owner: 'bg-[#F4B400]',
  staff: 'bg-[#6B7280]',
  rider: 'bg-[#EA580C]',
  bansud_tourism_office: 'bg-[#DC2626]',
  tourism_office: 'bg-[#0891B2]',
}

const roleLabels: Record<string, string> = {
  tourist: 'Tourists',
  business_owner: 'Business Owners',
  staff: 'Staff',
  rider: 'Riders',
  bansud_tourism_office: 'Admin',
  tourism_office: 'Tourism Office',
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

export default function AdminDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => get<DashboardData>(API_ENDPOINTS.ADMIN.DASHBOARD),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className="text-center py-20 text-[#6B7280]">Unable to load dashboard data.</div>

  const { stats, usersByRole, recentUsers, recentBusinesses } = data
  const maxRoleCount = Math.max(...Object.values(usersByRole), 1)

  return (
    <div>
      {/* Page Header with tourism backdrop */}
      <div className="relative overflow-hidden rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism mb-6">
        <div className="pointer-events-none absolute inset-0 opacity-[0.08]" aria-hidden>
          <TourismBackdrop />
        </div>
        <div className="relative px-6 py-5 lg:px-8 lg:py-6">
          <h1 className="text-2xl lg:text-[32px] font-bold text-[#126B32] leading-tight">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-[#6B7280]">System overview and management</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
        {statCards.map((card) => {
          const value = stats[card.key] ?? 0
          const Icon = card.icon
          return (
            <div key={card.key} className="bg-white border border-[#E2E8E3] rounded-2xl p-5 shadow-tourism transition-all duration-200 hover:shadow-[0_10px_24px_rgba(22,101,52,0.12)] hover:-translate-y-0.5">
              <div className="flex items-start justify-between">
                <div>
                  <p className={`text-xs font-semibold uppercase tracking-wider ${card.labelClass}`}>{card.label}</p>
                  <p className="mt-2 text-2xl lg:text-3xl font-bold text-[#17201A]">{value}</p>
                </div>
                <div className={`w-12 h-12 ${card.iconBg} rounded-xl flex items-center justify-center shrink-0`}>
                  <Icon className={`w-6 h-6 ${card.iconText}`} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Users by Role */}
      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism mb-6 p-6">
        <h2 className="text-lg font-bold text-[#17201A] mb-4">Users by Role</h2>
        <div className="space-y-3">
          {Object.entries(usersByRole).map(([role, count]) => (
            <div key={role} className="flex items-center gap-4">
              <span className="text-sm text-[#6B7280] w-36 truncate">{roleLabels[role] || role}</span>
              <div className="flex-1 bg-[#F3F4F6] rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full rounded-full ${roleColors[role] || 'bg-[#6B7280]'} transition-all duration-500`}
                  style={{ width: `${(Number(count) / maxRoleCount) * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium text-[#6B7280] w-12 text-right">{Number(count)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Registrations */}
        <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism overflow-hidden">
          <div className="px-5 lg:px-6 py-4 border-b border-[#E2E8E3] bg-[#F6F8F4]">
            <h2 className="text-lg font-bold text-[#17201A]">Recent Registrations</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Name</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Role</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E3]">
                {recentUsers.map((user) => (
                  <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="font-medium text-[#17201A]">{user.name}</div>
                      <div className="text-xs text-[#6B7280]">{user.email}</div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap capitalize">
                      {user.role.replace(/_/g, ' ')}
                    </td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <StatusBadge status={user.account_status} />
                    </td>
                    <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                      {formatDate(user.created_at)}
                    </td>
                  </tr>
                ))}
                {recentUsers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 lg:px-6 py-8 text-center text-[#6B7280]">No recent registrations</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Businesses */}
        <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism overflow-hidden">
          <div className="px-5 lg:px-6 py-4 border-b border-[#E2E8E3] bg-[#F6F8F4]">
            <h2 className="text-lg font-bold text-[#17201A]">Recent Businesses</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Business</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Category</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E3]">
                {recentBusinesses.map((business) => (
                  <tr key={business.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="font-medium text-[#17201A]">{business.name}</div>
                      <div className="text-xs text-[#6B7280]">{business.municipality}</div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{business.category}</td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <StatusBadge status={business.status} />
                    </td>
                    <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                      {formatDate(business.created_at)}
                    </td>
                  </tr>
                ))}
                {recentBusinesses.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 lg:px-6 py-8 text-center text-[#6B7280]">No recent businesses</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
