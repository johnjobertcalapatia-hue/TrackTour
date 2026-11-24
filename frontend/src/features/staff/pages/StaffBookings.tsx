import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, get, patch } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import type { Booking } from '@/shared/types'
import { CalendarCheck, ChevronLeft, ChevronRight, Filter } from 'lucide-react'
import { useStaffPermissions } from '../services/use-staff-permissions'

const STATUS_FILTERS = ['all', 'pending', 'confirmed', 'in_progress', 'completed', 'cancelled']
const label = (s: string) => (s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()))

/** The next step a staff member can take, by booking status. */
const NEXT: Record<string, { status: string; label: string }> = {
  pending: { status: 'confirmed', label: 'Confirm' },
  confirmed: { status: 'in_progress', label: 'Check In' },
  in_progress: { status: 'completed', label: 'Complete' },
}

interface BookingsResponse {
  bookings: Booking[]
  status_counts?: Record<string, number>
  pagination?: { current_page: number; last_page: number; per_page: number; total: number }
}

const CARD = 'rounded-[20px] border border-[#E2E8E3] bg-[#fff] shadow-[0_6px_18px_rgba(22,101,52,0.06)]'
const TH = 'px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067] lg:px-6'

/**
 * Staff bookings (owner-portal look, 2026-11-24): their business's bookings,
 * filtered and paged on the server (GET /staff/bookings). Status buttons need
 * bookings.update; the server checks it too.
 */
export default function StaffBookings() {
  const queryClient = useQueryClient()
  const { can } = useStaffPermissions()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['staff-bookings', statusFilter, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      return get<BookingsResponse>(`/staff/bookings?${params.toString()}`)
    },
    placeholderData: (previous) => previous,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => patch(`/staff/bookings/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-bookings'] }),
  })

  if (isLoading) return <DashboardSkeleton />

  const bookings = data?.bookings ?? []
  const pagination = data?.pagination
  const totalPages = Math.max(1, pagination?.last_page ?? 1)
  const current = Math.min(page, totalPages)
  const counts = data?.status_counts ?? {}
  const countFor = (s: string) => (s === 'all' ? Object.values(counts).reduce((a, b) => a + Number(b), 0) : Number(counts[s] ?? 0))
  const canUpdate = can('bookings.update')

  return (
    <div>
      <div className="mb-8 flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#0F4D2B] text-white"><CalendarCheck className="h-6 w-6" aria-hidden="true" /></span>
        <div>
          <h1 className="text-2xl font-bold text-[#17201B] lg:text-3xl">Bookings</h1>
          <p className="mt-1 text-sm text-[#5E6B63]">Your business&apos;s bookings and their status</p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2" role="group" aria-label="Filter by status">
        <Filter className="h-4 w-4 text-[#647067]" aria-hidden="true" />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={statusFilter === s}
            onClick={() => { setStatusFilter(s); setPage(1) }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              statusFilter === s ? 'bg-[#16803C] text-white' : 'border border-[#D7E8DB] bg-[#fff] text-[#16803C] hover:bg-[#F3F8F4]'
            }`}
          >
            {label(s)}
            <span className={`ml-1.5 tabular-nums ${statusFilter === s ? 'text-white/80' : 'text-[#647067]'}`}>{countFor(s)}</span>
          </button>
        ))}
      </div>

      {statusMutation.isError && (
        <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {apiErrorMessage(statusMutation.error, "Couldn't update the booking. Please try again.")}
        </p>
      )}

      {bookings.length === 0 ? (
        <div className={`${CARD} p-12 text-center`}>
          <p className="text-[#647067]">{statusFilter === 'all' ? 'No bookings yet.' : 'No bookings with this status.'}</p>
        </div>
      ) : (
        <>
          <div className={`${CARD} overflow-hidden transition-opacity ${isFetching ? 'opacity-60' : ''}`} aria-busy={isFetching}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    <th className={`${TH} text-left`}>Booking #</th>
                    <th className={`${TH} text-left`}>Guest</th>
                    <th className={`${TH} text-left`}>Type</th>
                    <th className={`${TH} text-left`}>Status</th>
                    <th className={`${TH} text-left`}>Dates</th>
                    <th className={`${TH} text-right`}>Amount</th>
                    {canUpdate && <th className={`${TH} text-right`}>Action</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {bookings.map((b) => {
                    const next = NEXT[b.status]
                    return (
                      <tr key={b.id} className="transition-colors hover:bg-[#F6F8F4]">
                        <td className="whitespace-nowrap px-5 py-3 font-semibold text-[#17201B] lg:px-6">{b.booking_number}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-[#3F4A43] lg:px-6">{b.customer_name}</td>
                        <td className="whitespace-nowrap px-5 py-3 capitalize text-[#3F4A43] lg:px-6">{b.booking_type?.replace(/_/g, ' ')}</td>
                        <td className="whitespace-nowrap px-5 py-3 lg:px-6"><StatusBadge status={b.status} /></td>
                        <td className="whitespace-nowrap px-5 py-3 text-xs text-[#3F4A43] lg:px-6">
                          {b.check_in_date ? (
                            <>{formatDateTime(b.check_in_date)}<br />→ {b.check_out_date ? formatDateTime(b.check_out_date) : '—'}</>
                          ) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right font-semibold tabular-nums text-[#17201B] lg:px-6">{formatCurrency(Number(b.total_amount ?? 0))}</td>
                        {canUpdate && (
                          <td className="whitespace-nowrap px-5 py-3 text-right lg:px-6">
                            {next && (
                              <button
                                type="button"
                                onClick={() => statusMutation.mutate({ id: b.id, status: next.status })}
                                disabled={statusMutation.isPending}
                                className="rounded-lg bg-[#16803C] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#126B32] disabled:opacity-50"
                              >
                                {next.label}
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-[#647067]">
              {pagination ? `Showing ${(current - 1) * pagination.per_page + 1}–${Math.min(current * pagination.per_page, pagination.total)} of ${pagination.total}` : `${bookings.length} bookings`}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Previous page" onClick={() => setPage(Math.max(1, current - 1))} disabled={current === 1} className="rounded-lg border border-[#D7E8DB] bg-[#fff] p-2 text-[#16803C] transition hover:bg-[#F3F8F4] disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-sm text-[#647067]">Page {current} of {totalPages}</span>
                <button type="button" aria-label="Next page" onClick={() => setPage(Math.min(totalPages, current + 1))} disabled={current === totalPages} className="rounded-lg border border-[#D7E8DB] bg-[#fff] p-2 text-[#16803C] transition hover:bg-[#F3F8F4] disabled:opacity-40">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
