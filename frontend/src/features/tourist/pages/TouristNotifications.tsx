import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import type { Notification } from '@/shared/types'
import { Bell, CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react'

const ITEMS_PER_PAGE = 8

export default function TouristNotifications() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-notifications'],
    queryFn: () => get<{ notifications: Notification[] }>('/tourist/notifications'),
  })

  const markReadMutation = useMutation({
    mutationFn: (id: number) => patch(`/tourist/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tourist-notifications'] }),
  })

  const markAllMutation = useMutation({
    mutationFn: () => patch('/tourist/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tourist-notifications'] }),
  })

  if (isLoading) return <DashboardSkeleton />

  const notifications = data?.notifications ?? []
  const unreadCount = notifications.filter((n) => !n.read_at).length
  const totalPages = Math.ceil(notifications.length / ITEMS_PER_PAGE)
  const paginated = notifications.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Notifications</h1>
          <p className="mt-1 text-sm text-gray-400">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
            className="inline-flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-gray-300 px-4 py-2.5 rounded-xl text-sm font-medium transition"
          >
            <CheckCheck className="w-4 h-4" /> Mark all as read
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-12 text-center">
          <Bell className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-gray-400">No notifications yet.</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {paginated.map((n) => (
              <div
                key={n.id}
                onClick={() => !n.read_at && markReadMutation.mutate(n.id)}
                className={`bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-5 flex items-start gap-4 transition-all duration-200 ${
                  !n.read_at ? 'border-l-2 border-l-emerald-500 hover:border-emerald-500/50' : 'opacity-60 hover:opacity-80'
                } cursor-pointer`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  !n.read_at ? 'bg-emerald-900/30' : 'bg-gray-800'
                }`}>
                  <Bell className={`w-5 h-5 ${!n.read_at ? 'text-emerald-400' : 'text-gray-500'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className={`font-semibold text-sm ${!n.read_at ? 'text-gray-100' : 'text-gray-300'}`}>{n.title}</h3>
                  <p className="text-sm text-gray-400 mt-1">{n.message}</p>
                  <p className="text-xs text-gray-500 mt-2">{formatDateTime(n.created_at)}</p>
                </div>
                {!n.read_at && (
                  <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full shrink-0 mt-1" />
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-400">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, notifications.length)} of {notifications.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-gray-400">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 disabled:opacity-40 transition">
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
