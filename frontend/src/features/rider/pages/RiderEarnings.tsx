import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { ChevronLeft, ChevronRight, DollarSign, ArrowRight, Bike } from 'lucide-react'

interface Earning {
  id: number
  order_number: string
  business_name: string
  status: string
  payment_method: string
  payment_status: string
  customer_payment: number
  delivery_fee: number
  tip: number
  earnings: number
  completed_at: string
}

const ITEMS_PER_PAGE = 15

export default function RiderEarnings() {
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery<{
    data: Earning[]
    meta: { current_page: number; last_page: number; total: number }
    summary: { total_earnings: number; completed_deliveries: number }
  }>({
    queryKey: ['rider-earnings', page],
    queryFn: () => get(`/rider/earnings?page=${page}`),
  })

  if (isLoading) return <DashboardSkeleton />

  const earnings = data?.data ?? []
  const totalEarnings = data?.summary?.total_earnings ?? 0
  const totalPages = data?.meta?.last_page ?? 1
  const paginated = earnings

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Earnings</h1>
          <p className="mt-1 text-sm text-[#6B7280]">Your delivery earnings history</p>
        </div>
        <div className="bg-[#FFF8E1] border border-[#F4B400]/30 rounded-2xl px-5 py-3 flex items-center gap-3">
          <DollarSign className="w-5 h-5 text-[#F4B400]" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#A87500]">Total Earned</p>
            <p className="text-xl font-bold text-[#17201B]">{formatCurrency(totalEarnings)}</p>
          </div>
        </div>
      </div>

      {earnings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] p-12 text-center">
          <p className="text-[#6B7280]">No earnings yet. Complete deliveries to start earning.</p>
        </div>
      ) : (
        <>
          <div className="w-full space-y-3">
            {paginated.map((e) => (
              <Link
                key={e.id}
                to={`/rider/earnings/${e.id}`}
                aria-label={`View delivery ${e.order_number}`}
                className="block w-full text-left bg-white rounded-2xl border border-[#E5E9E7] px-4 py-3 shadow-sm hover:border-[#087F3F]/40 hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-[#E9F7EF] flex items-center justify-center shrink-0">
                      <Bike className="w-4 h-4 text-[#087F3F]" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-[#17201B] truncate">{e.order_number}</p>
                      <p className="text-xs text-[#6B7280] truncate">{e.business_name}</p>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-[#087F3F] shrink-0" />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="capitalize text-[#4B5563]">{e.status.replaceAll('_', ' ')}</span>
                  <span className="capitalize text-[#6B7280]">{e.payment_method} · {e.payment_status}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3 border-t border-[#E5E9E7] pt-2">
                  <div>
                    <p className="text-[11px] text-[#6B7280]">Rider fee</p>
                    <p className="font-semibold text-[#17201B]">{formatCurrency(e.delivery_fee)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] text-[#6B7280]">Earned</p>
                    <p className="font-semibold text-[#087F3F]">{formatCurrency(e.earnings)}</p>
                  </div>
                </div>
                <p className="mt-2 text-xs text-[#9CA3AF]">{formatDateTime(e.completed_at)}</p>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[#6B7280]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, data?.meta?.total ?? 0)} of {data?.meta?.total ?? 0}
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
