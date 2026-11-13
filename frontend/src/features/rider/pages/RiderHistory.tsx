import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { ChevronLeft, ChevronRight, CheckCircle, Motorbike } from 'lucide-react'

type Tab = 'food' | 'ride'

/** GET /rider/deliveries/completed?type=food|ride (RiderDeliveryController::historyRow). */
interface HistoryRow {
  id: number
  order_id: number | null
  order_number: string | null
  type: 'food' | 'ride'
  customer_name: string | null
  business_name: string | null
  pickup_address: string | null
  delivery_address: string | null
  status: string
  payment_method: string | null
  is_cod: boolean
  total_amount: number
  earning: number
  completed_at: string | null
}

interface HistoryPage {
  data: HistoryRow[]
  meta?: { current_page: number; last_page: number; total: number }
}

/** "Nov 11, 10:51 AM" (Philippine time), short enough for the compact table. */
const shortDate = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })

const peso = (n: number | null | undefined) =>
  `₱${Number(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Compact table (2026-11-11): 3 columns that fit a phone, tight padding,
// secondary facts (date, restaurant / route, earning) as a small second line.
const th = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] whitespace-nowrap'
const td = 'px-3 py-2 whitespace-nowrap align-top'

function Payment({ row }: { row: HistoryRow }) {
  return (
    <span className={`inline-flex rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${row.is_cod ? 'bg-[#FFF7D6] text-[#92400E]' : 'bg-[#E0F2FE] text-[#075985]'}`}>
      {row.is_cod ? (row.type === 'ride' ? 'Cash' : 'COD') : 'Online'}
    </span>
  )
}

/**
 * Rider History: completed food deliveries and ride bookings, each in its own
 * tab and paged on the server, with the order / booking number, customer,
 * payment, what the customer paid and what the rider earned.
 */
export default function RiderHistory() {
  const [tab, setTab] = useState<Tab>('food')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['rider-history', tab, page],
    queryFn: () => get<HistoryPage>('/rider/deliveries/completed', { params: { type: tab, page } }),
    // Keep the old page while the next page of the SAME tab loads; never show
    // one tab's rows under the other tab's heading.
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === tab ? previous : undefined),
  })

  const rows = data?.data ?? []
  const lastPage = data?.meta?.last_page ?? 1
  const total = data?.meta?.total ?? rows.length
  const isRide = tab === 'ride'

  const changeTab = (next: Tab) => {
    setTab(next)
    setPage(1)
  }

  const tabClass = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition ${
      active ? 'bg-white text-[#17201B] shadow-sm' : 'text-[#6B7280] hover:text-[#17201B]'
    }`

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">History</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Your completed deliveries and rides</p>
      </div>

      <div className="flex gap-1 bg-[#F3F8F5] p-1 rounded-xl mb-6" role="tablist" aria-label="History type">
        <button type="button" role="tab" aria-selected={!isRide} onClick={() => changeTab('food')} className={tabClass(!isRide)}>
          <CheckCircle className="w-4 h-4" aria-hidden="true" /> Deliveries
        </button>
        <button type="button" role="tab" aria-selected={isRide} onClick={() => changeTab('ride')} className={tabClass(isRide)}>
          <Motorbike className="w-4 h-4" aria-hidden="true" /> Ride Hailing
        </button>
      </div>

      {isLoading && !data ? (
        <DashboardSkeleton />
      ) : (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full table-fixed text-xs" aria-label={isRide ? 'Completed rides' : 'Completed deliveries'}>
              <colgroup>
                <col className="w-[34%] sm:w-[26%]" />
                <col />
                <col className="w-[33%] sm:w-[22%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[#E5E9E7] bg-[#F3F8F5] text-left">
                  <th className={th}>{isRide ? 'Booking' : 'Order'}</th>
                  <th className={th}>{isRide ? 'Passenger' : 'Customer'}</th>
                  <th className={`${th} text-right`}>{isRide ? 'Fare' : 'Total'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E9E7]">
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-[#F3F8F5] transition-colors">
                    <td className="px-3 py-2 align-top">
                      <p className="truncate font-semibold text-[#17201B]" title={row.order_number ?? undefined}>{row.order_number ?? `#${row.order_id ?? row.id}`}</p>
                      <p className="truncate text-[11px] text-[#9CA3AF]">{row.completed_at ? shortDate(row.completed_at) : '—'}</p>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <p className="truncate font-medium text-[#17201B]" title={row.customer_name ?? undefined}>{row.customer_name ?? '—'}</p>
                      {isRide ? (
                        <p className="truncate text-[11px] text-[#6B7280]" title={`${row.pickup_address ?? ''} → ${row.delivery_address ?? ''}`}>
                          {row.pickup_address ?? '—'} → {row.delivery_address ?? '—'}
                        </p>
                      ) : (
                        <p className="truncate text-[11px] text-[#6B7280]" title={row.business_name ?? undefined}>{row.business_name ?? '—'}</p>
                      )}
                    </td>
                    <td className={`${td} text-right`}>
                      <p className="flex items-center justify-end gap-1.5 font-semibold text-[#17201B]">
                        <Payment row={row} /> <span>{peso(row.total_amount)}</span>
                      </p>
                      <p className="text-[11px] text-[#16803C]">
                        Earned <span className="font-semibold">{peso(row.earning)}</span>
                      </p>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-5 py-10 text-center text-[#9CA3AF]">
                      {isRide ? (
                        <>
                          <Motorbike className="w-10 h-10 mx-auto mb-2 opacity-50" aria-hidden="true" />
                          No completed rides yet
                        </>
                      ) : (
                        'No completed deliveries yet'
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lastPage > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-[#6B7280]">
            Page {page} of {lastPage} · {total} {isRide ? (total === 1 ? 'ride' : 'rides') : total === 1 ? 'delivery' : 'deliveries'}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              aria-label="Previous page"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg border border-[#E5E9E7] text-[#6B7280] hover:bg-[#F3F8F5] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Next page"
              onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
              disabled={page >= lastPage}
              className="p-2 rounded-lg border border-[#E5E9E7] text-[#6B7280] hover:bg-[#F3F8F5] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
