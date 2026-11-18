import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { get, apiErrorMessage } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatCurrency, formatDate } from '@/shared/utils'
import { card, DetailRow, PageHeader } from '@/features/municipal/components/MunicipalUi'
import { MUNICIPAL_API, type TouristRow } from '@/features/municipal/types'

interface TouristDetail {
  tourist: TouristRow
  orders: { id: number; order_number: string; business_name: string; status: string; payment_method: string | null; total: number; created_at: string }[]
  bookings: { id: number; booking_number: string; business_name: string; booking_type: string | null; status: string; check_in_date: string | null; total_amount: number; created_at: string }[]
}

export default function MunicipalTouristShow() {
  const { id } = useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['municipal', 'tourist', id],
    queryFn: () => get<TouristDetail>(`${MUNICIPAL_API.TOURISTS}/${id}`),
  })

  if (isLoading) return <DashboardSkeleton />
  if (error || !data) return <Alert type="error" message={apiErrorMessage(error, 'Tourist not found.')} />

  const { tourist, orders, bookings } = data

  return (
    <div>
      <Link to="/municipal/tourists" className="inline-flex items-center gap-1 text-sm text-[#2E8B57] hover:underline mb-3">
        <ArrowLeft className="w-4 h-4" /> Back to tourists
      </Link>
      <PageHeader title={tourist.name} subtitle="Activity with businesses in your municipality (read-only)" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className={`${card} p-5`} aria-label="Tourist">
          <dl>
            <DetailRow label="Email" value={tourist.email} />
            <DetailRow label="Mobile" value={tourist.phone} />
            <DetailRow label="Nationality" value={tourist.nationality} />
            <DetailRow label="Account" value={<StatusBadge status={tourist.account_status} />} />
            <DetailRow label="Orders here" value={tourist.orders_count} />
            <DetailRow label="Bookings here" value={tourist.bookings_count} />
            <DetailRow label="Member since" value={formatDate(tourist.created_at)} />
          </dl>
        </section>

        <div className="lg:col-span-2 space-y-4">
          <section className={`${card} overflow-hidden`} aria-label="Recent orders">
            <h2 className="px-5 py-4 border-b border-[#E7E2D6] text-sm font-semibold text-[#1C2B22]">Recent orders</h2>
            {orders.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[#66736B]">No orders.</p>
            ) : (
              <ul className="divide-y divide-[#F1EDE3]">
                {orders.map((o) => (
                  <li key={o.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-[#1C2B22] truncate">{o.business_name}</p>
                      <p className="text-xs text-[#66736B]">
                        {o.order_number} · {formatDate(o.created_at)} · {o.payment_method?.toUpperCase() ?? '—'}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-semibold text-[#1C2B22]">{formatCurrency(o.total)}</span>
                      <StatusBadge status={o.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={`${card} overflow-hidden`} aria-label="Recent bookings">
            <h2 className="px-5 py-4 border-b border-[#E7E2D6] text-sm font-semibold text-[#1C2B22]">Recent bookings</h2>
            {bookings.length === 0 ? (
              <p className="px-5 py-6 text-sm text-[#66736B]">No bookings.</p>
            ) : (
              <ul className="divide-y divide-[#F1EDE3]">
                {bookings.map((b) => (
                  <li key={b.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-[#1C2B22] truncate">{b.business_name}</p>
                      <p className="text-xs text-[#66736B]">
                        {b.booking_number} · {b.check_in_date ? `Check-in ${formatDate(b.check_in_date)}` : formatDate(b.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="font-semibold text-[#1C2B22]">{formatCurrency(b.total_amount)}</span>
                      <StatusBadge status={b.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
