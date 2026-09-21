import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import { API_ENDPOINTS } from '@/shared/constants'
import type { PaginatedResponse, Notification } from '@/shared/types'
import { Bell, CheckCheck } from 'lucide-react'
import { useState } from 'react'

export default function AdminNotifications() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-notifications', page],
    queryFn: () =>
      get<PaginatedResponse<Notification>>(API_ENDPOINTS.ADMIN.NOTIFICATIONS, {
        params: { page },
      }),
  })

  const markAllReadMutation = useMutation({
    mutationFn: () => post('/admin/notifications/mark-all-read'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-notifications'] })
    },
  })

  if (isLoading) return <TableSkeleton rows={8} cols={4} />

  const notifications = data?.data ?? []
  const meta = data?.meta

  return (
    <div>
      <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism mb-8 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5 pointer-events-none">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="tourism-pattern" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
                <circle cx="20" cy="20" r="1.5" fill="#16803C" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#tourism-pattern)" />
          </svg>
        </div>
        <div className="relative z-10 px-6 py-6 sm:px-8 sm:py-8">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Notifications</h1>
              <p className="mt-1 text-sm lg:text-base text-[#6B7280]">View system and user notifications</p>
            </div>
            <button
              onClick={() => markAllReadMutation.mutate()}
              disabled={markAllReadMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition disabled:opacity-50 shadow-tourism"
            >
              <CheckCheck className="w-4 h-4" />
              {markAllReadMutation.isPending ? 'Marking...' : 'Mark All Read'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F3F8F4]">
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280] w-10" />
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Title</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Message</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Type</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {notifications.map((notif) => (
                <tr
                  key={notif.id}
                  className={`hover:bg-[#F3F8F4] transition-colors ${!notif.read_at ? 'bg-[#EAF6ED]' : ''}`}
                >
                  <td className="px-5 lg:px-6 py-3">
                    {notif.read_at ? (
                      <CheckCheck className="w-4 h-4 text-[#6B7280]" />
                    ) : (
                      <Bell className="w-4 h-4 text-[#16803C]" />
                    )}
                  </td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <span className={`font-medium ${notif.read_at ? 'text-[#6B7280]' : 'text-[#17201A]'}`}>
                      {notif.title}
                    </span>
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] max-w-sm truncate">{notif.message}</td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[#EAF6ED] border border-[#D7E8DB] text-xs text-[#16803C] capitalize">
                      {notif.type.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                    {formatDateTime(notif.created_at)}
                  </td>
                </tr>
              ))}
              {notifications.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">
                    <Bell className="w-8 h-8 mx-auto mb-3 text-[#D7E8DB]" />
                    No notifications
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {meta && meta.last_page > 1 && (
          <div className="px-5 lg:px-6 py-4 border-t border-[#E2E8E3] flex items-center justify-between">
            <p className="text-sm text-[#6B7280]">
              Page {meta.current_page} of {meta.last_page}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 rounded-lg bg-white text-[#16803C] border border-[#D7E8DB] text-sm hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                disabled={page === meta.last_page}
                className="px-4 py-2 rounded-lg bg-white text-[#16803C] border border-[#D7E8DB] text-sm hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
