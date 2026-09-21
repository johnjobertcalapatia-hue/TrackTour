import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import type { Delivery } from '@/shared/types'
import { ChevronLeft, ChevronRight, CheckCircle } from 'lucide-react'

const ITEMS_PER_PAGE = 8

export default function RiderDeliveriesCompleted() {
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['rider-deliveries-completed'],
    queryFn: () => get<{ data: Delivery[] }>('/rider/deliveries/completed'),
  })

  if (isLoading) return <DashboardSkeleton />

  const deliveries = data?.data ?? []
  const totalPages = Math.ceil(deliveries.length / ITEMS_PER_PAGE)
  const paginated = deliveries.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Completed Deliveries</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Your delivery history</p>
      </div>

      {deliveries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] p-12 text-center">
          <CheckCircle className="w-12 h-12 text-[#9CA3AF] mx-auto mb-4" />
          <p className="text-[#6B7280]">No completed deliveries yet.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-[#E5E9E7] shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E5E9E7] bg-[#F3F8F5]">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Order</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Pickup</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Delivery</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E5E9E7]">
                  {paginated.map((d) => (
                    <tr key={d.id} className="hover:bg-[#F3F8F5] transition-colors">
                      <td className="px-5 lg:px-6 py-3 font-medium text-[#17201B] whitespace-nowrap">#{d.order_id}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap max-w-[200px] truncate">{d.pickup_address}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap max-w-[200px] truncate">{d.delivery_address}</td>
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap"><StatusBadge status={d.status} /></td>
                      <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{formatDateTime(d.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[#6B7280]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, deliveries.length)} of {deliveries.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-[#D7E2DC] text-[#6B7280] hover:bg-[#F3F8F5] disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#6B7280]">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg border border-[#D7E2DC] text-[#6B7280] hover:bg-[#F3F8F5] disabled:opacity-40 transition">
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
