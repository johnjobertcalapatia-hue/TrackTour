import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDate } from '@/shared/utils'
import type { Booking } from '@/shared/types'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const ITEMS_PER_PAGE = 8

export default function TouristBooking() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-bookings'],
    queryFn: () => get<{ bookings: { data: Booking[] } }>('/tourist/history', { params: { tab: 'bookings' } }),
  })

  if (isLoading) return <DashboardSkeleton />

  const bookings = data?.bookings?.data ?? []
  const totalPages = Math.ceil(bookings.length / ITEMS_PER_PAGE)
  const paginated = bookings.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">My Bookings</h1>
        <p className="mt-1 text-sm text-gray-400">View and manage your reservations</p>
      </div>

      {bookings.length === 0 ? (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-12 text-center">
          <p className="text-gray-400">No bookings yet. Explore businesses to make a reservation.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {paginated.map((b) => (
              <div
                key={b.id}
                onClick={() => navigate(`/tourist/booking/${b.id}`)}
                className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-5 hover:border-emerald-500/30 transition-all duration-200 cursor-pointer"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-3 mb-1">
                      <span className="font-medium text-gray-100">{b.booking_number}</span>
                      <StatusBadge status={b.status} />
                    </div>
                    <p className="text-sm text-gray-400">{b.booking_type} &bull; {b.customer_name}</p>
                    {b.check_in_date && (
                      <p className="text-xs text-gray-500 mt-1">
                        {formatDate(b.check_in_date)} → {b.check_out_date ? formatDate(b.check_out_date) : '—'}
                      </p>
                    )}
                  </div>
                  <span className="font-semibold text-emerald-400">{formatCurrency(b.total_amount)}</span>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-400">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, bookings.length)} of {bookings.length}
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
