import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import type { Booking } from '@/shared/types'
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react'

const ITEMS_PER_PAGE = 8
const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'in_progress', 'completed', 'cancelled']

export default function BusinessOwnerBookings() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-bookings', selectedBusinessId],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedBusinessId) params.set('business_id', String(selectedBusinessId))
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const qs = params.toString()
      return get<{ data: Booking[] }>(`/business-owner/bookings${qs ? `?${qs}` : ''}`)
    },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      patch(`/business-owner/bookings/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-bookings'] }),
  })

  if (isLoading) return <DashboardSkeleton />

  const allBookings = data?.data ?? []
  const filtered = statusFilter === 'all' ? allBookings : allBookings.filter((b) => b.status === statusFilter)
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Bookings</h1>
        <p className="mt-1 text-sm text-[#647067]">Manage customer bookings</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Filter className="w-4 h-4 text-[#647067]" />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === s
                ? 'bg-[#16803C] text-white'
                : 'bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4]'
            }`}
          >
            {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <p className="text-[#647067]">No bookings found.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Booking #</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Guest</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Type</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Status</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Dates</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Amount</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {paginated.map((b) => (
                    <tr key={b.id} className="hover:bg-[#F6F8F4] transition-colors">
                      <td className="px-5 lg:px-6 py-3 font-medium text-[#17201A] whitespace-nowrap">{b.booking_number}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap">{b.customer_name}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap capitalize">{b.booking_type}</td>
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap"><StatusBadge status={b.status} /></td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap text-xs">
                        {b.check_in_date ? (
                          <>{formatDateTime(b.check_in_date)}<br/>→ {b.check_out_date ? formatDateTime(b.check_out_date) : '—'}</>
                        ) : '—'}
                      </td>
                      <td className="px-5 lg:px-6 py-3 text-right font-medium text-[#17201A] whitespace-nowrap">{formatCurrency(b.total_amount)}</td>
                      <td className="px-5 lg:px-6 py-3 text-right whitespace-nowrap">
                        {b.status === 'pending' && (
                          <button onClick={() => statusMutation.mutate({ id: b.id, status: 'confirmed' })} className="text-xs bg-[#16803C] hover:bg-[#126B32] text-white px-3 py-1.5 rounded-lg transition">
                            Confirm
                          </button>
                        )}
                        {b.status === 'confirmed' && (
                          <button onClick={() => statusMutation.mutate({ id: b.id, status: 'in_progress' })} className="text-xs bg-[#16803C] hover:bg-[#126B32] text-white px-3 py-1.5 rounded-lg transition">
                            Check In
                          </button>
                        )}
                        {b.status === 'in_progress' && (
                          <button onClick={() => statusMutation.mutate({ id: b.id, status: 'completed' })} className="text-xs bg-[#16803C] hover:bg-[#126B32] text-white px-3 py-1.5 rounded-lg transition">
                            Complete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[#647067]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
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
