import { useNavigate } from 'react-router-dom'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { Package, CalendarCheck, ClipboardCheck, Leaf } from 'lucide-react'
import type { DashboardData } from './types'

export function RecentActivity({ data }: { data: DashboardData }) {
  const navigate = useNavigate()
  const { recent_orders: orders, recent_bookings: bookings } = data

  const activities = [
    ...orders.map((o) => ({ key: `o-${o.id}`, type: 'Order' as const, ref: o.order_number, customer: o.customer_name, status: o.status, date: o.created_at, amount: o.total })),
    ...bookings.map((b) => ({ key: `b-${b.id}`, type: 'Booking' as const, ref: b.booking_number, customer: b.customer_name, status: b.status, date: b.created_at, amount: b.total_amount })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8)

  return (
    <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-[0_6px_18px_rgba(22,101,52,0.05)] p-7 min-h-[230px]">
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
  )
}
