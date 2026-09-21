import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import type { Notification } from '@/shared/types'
import { Bell, CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react'

const ITEMS_PER_PAGE = 8

export default function BusinessOwnerNotifications() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-notifications'],
    queryFn: () => get<{ data: Notification[] }>('/business-owner/notifications'),
  })

  const markReadMutation = useMutation({
    mutationFn: (id: number) => patch(`/business-owner/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-notifications'] }),
  })

  const markAllMutation = useMutation({
    mutationFn: () => patch('/business-owner/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-notifications'] }),
  })

  if (isLoading) return <DashboardSkeleton />

  const notifications = data?.data ?? []
  const unreadCount = notifications.filter((n) => !n.read_at).length
  const totalPages = Math.ceil(notifications.length / ITEMS_PER_PAGE)
  const paginated = notifications.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Notifications</h1>
          <p className="mt-1 text-sm text-[#647067]">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
            className="inline-flex items-center gap-2 bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <CheckCheck className="w-4 h-4" /> Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <Bell className="w-12 h-12 text-[#647067] mx-auto mb-4" />
          <p className="text-[#647067]">No notifications yet.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {paginated.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.read_at && markReadMutation.mutate(n.id)}
                className={`bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-5 flex items-start gap-4 transition-all duration-200 ${
                  !n.read_at ? 'border-l-2 border-l-[#16803C] hover:border-[#16803C]/50' : 'opacity-60 hover:opacity-80'
                } cursor-pointer`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  !n.read_at ? 'bg-[#EAF6ED]' : 'bg-[#F3F8F4]'
                }`}>
                  <Bell className={`w-5 h-5 ${!n.read_at ? 'text-[#16803C]' : 'text-[#647067]'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className={`font-semibold text-sm ${!n.read_at ? 'text-[#17201A]' : 'text-[#4B5563]'}`}>{n.title}</h3>
                  <p className="text-sm text-[#647067] mt-1">{n.message}</p>
                  <p className="text-xs text-[#647067] mt-2">{formatDateTime(n.created_at)}</p>
                </div>
                {!n.read_at && (
                  <span className="w-2.5 h-2.5 bg-[#16803C] rounded-full shrink-0 mt-1" />
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[#647067]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, notifications.length)} of {notifications.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-[#E2E8E3] text-[#647067] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#647067]">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg border border-[#E2E8E3] text-[#647067] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
