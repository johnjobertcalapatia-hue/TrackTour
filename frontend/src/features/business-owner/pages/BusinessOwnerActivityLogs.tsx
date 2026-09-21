import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface ActivityLog {
  id: number
  action: string
  description: string
  ip_address: string
  created_at: string
}

const ITEMS_PER_PAGE = 8

export default function BusinessOwnerActivityLogs() {
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-activity-logs'],
    queryFn: () => get<{ data: ActivityLog[] }>('/business-owner/activity-logs'),
  })

  if (isLoading) return <DashboardSkeleton />

  const logs = data?.data ?? []
  const totalPages = Math.ceil(logs.length / ITEMS_PER_PAGE)
  const paginated = logs.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Activity Logs</h1>
        <p className="mt-1 text-sm text-[#647067]">Track all activity on your account</p>
      </div>

      {logs.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <p className="text-[#647067]">No activity logs yet.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Action</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Description</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">IP Address</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {paginated.map((log) => (
                    <tr key={log.id} className="hover:bg-[#F6F8F4] transition-colors">
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#F3F4F6] text-[#647067] border border-[#E5E7EB]">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563]">{log.description}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#647067] whitespace-nowrap font-mono text-xs">{log.ip_address}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#647067] whitespace-nowrap">{formatDateTime(log.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[#647067]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, logs.length)} of {logs.length}
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
