import { useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Bike, Car, ChevronLeft, ChevronRight, Clock, MapPin, Package, Search, Stethoscope, Store, Truck, Wallet } from 'lucide-react'
import { get, post } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { cn, formatDateTime } from '@/shared/utils'
import TripDiagnosticsPanel from '@/features/admin/components/TripDiagnosticsPanel'
import { useOfficePortal } from '@/features/admin/office-portal'
import type { DestinationChange } from '@/features/tourist/services/destination-change'

interface LiveCodPurchase {
  id: number
  business_id: number
  business_name?: string | null
  purchase_amount: number
  status: 'pending' | 'purchased' | 'collected'
}

interface DeliveryRecord {
  id: number
  order_id: number | null
  order_number: string | null
  order_type: 'delivery' | 'transport' | null
  customer_name: string | null
  customer_phone: string | null
  restaurants: string[]
  rider_name: string | null
  rider_phone: string | null
  status: string
  pickup_address: string | null
  delivery_address: string | null
  distance_km: number | null
  delivery_fee: number | null
  total: number | null
  order?: { payment_method?: string | null } | null
  purchasing_cash?: number | null
  purchasing_cash_issued_at?: string | null
  purchasing_cash_received_at?: string | null
  cod_purchases?: LiveCodPurchase[]
  /** Ride: the passenger's one destination change (original vs final destination, fare adjustment). */
  destination_change?: DestinationChange | null
  delivered_at: string | null
  created_at: string
  updated_at: string
}

type Bucket = 'active' | 'completed' | 'cancelled' | 'all'

interface DeliveriesResponse {
  data: DeliveryRecord[]
  meta: {
    municipality: { id: number; name: string }
    bucket: Bucket
    counts: Record<Bucket, number>
    total: number
    current_page: number
    last_page: number
  }
}

const PICKUP_STAGE_STATUSES = ['assigned', 'arrived_pickup']
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All records' },
]
const peso = (n: number | null | undefined) => `₱${Number(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const th = 'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[#66736B]'

/**
 * Bansud Tourism Office delivery record: every delivery of its own
 * municipality (restaurant in Bansud; ride-hailing by a Bansud rider) —
 * live active trips plus the completed / cancelled history.
 */
/** Admin trip history: when the passenger changed the destination and what it did to the fare. */
function DestinationChangeNote({ change }: { change: DestinationChange }) {
  const final = change.final_fare
  const adjustment = final != null ? Math.round((final - change.original_fare) * 100) / 100 : null
  return (
    <span className="mt-1.5 block max-w-xs rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-[#7C4A03]" data-testid="destination-change-note">
      <span className="block font-semibold">Destination changed{change.confirmed_at ? ` ${formatDateTime(change.confirmed_at)}` : ''}</span>
      <span className="block">Booked {peso(change.original_fare)} · estimate {peso(change.estimated_fare)} · max {peso(change.max_fare)}</span>
      {final != null ? (
        <span className="block">
          Final {peso(final)} ({adjustment! >= 0 ? '+' : '−'}{peso(Math.abs(adjustment!))}) · {(change.verified_km ?? 0).toFixed(2)} km verified
          {(change.cap_adjustment ?? 0) > 0 && ` · capped −${peso(change.cap_adjustment)}`}
        </span>
      ) : (
        <span className="block">Final fare at the drop-off</span>
      )}
      {change.fare_review_status === 'needs_review' && <span className="block font-semibold text-[#B91C1C]">Needs review: {change.review_reasons.join(' ')}</span>}
      <span className="block">Driver {change.rider_acknowledged_at ? 'acknowledged' : change.rider_notification_status === 'failed' ? 'not reached by push (sees it in the app)' : 'notified'}</span>
    </span>
  )
}

export default function AdminLiveDeliveries() {
  const queryClient = useQueryClient()
  const [diagnosing, setDiagnosing] = useState<number | null>(null)
  const [bucket, setBucket] = useState<Bucket>('active')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)

  const params: Record<string, string | number> = { bucket, page }
  if (search.trim()) params.search = search.trim()
  if (type) params.type = type
  if (from) params.from = from
  if (to) params.to = to

  // Bansud: /admin (its own municipality). Municipal office: /municipal (its own town).
  const portal = useOfficePortal()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-live-deliveries', portal.api, params],
    queryFn: () => get<DeliveriesResponse>(`${portal.api}/live/deliveries`, { params }),
    placeholderData: keepPreviousData,
    refetchInterval: bucket === 'active' ? 10000 : false,
  })

  const issueCashMutation = useMutation({
    mutationFn: (deliveryId: number) => post(`${portal.api}/deliveries/${deliveryId}/issue-purchasing-cash`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-live-deliveries'] }),
  })

  const reset = (fn: () => void) => {
    fn()
    setPage(1)
  }

  if (isLoading) return <TableSkeleton rows={6} cols={6} />

  const deliveries = data?.data ?? []
  const meta = data?.meta
  const municipality = meta?.municipality.name ?? 'Bansud'
  const isCod = (d: DeliveryRecord) => (d.order?.payment_method ?? '').toLowerCase() === 'cash'
  const canIssue = (d: DeliveryRecord) => PICKUP_STAGE_STATUSES.includes(d.status) && d.purchasing_cash_issued_at == null && (d.cod_purchases?.length ?? 0) > 0

  const purchasingCash = (d: DeliveryRecord) => {
    if (d.purchasing_cash_issued_at == null) {
      if (!isCod(d) || ['delivered', 'completed', 'cancelled'].includes(d.status)) return <span className="text-xs text-[#9AA39D]">—</span>
      return (
        <button
          type="button"
          disabled={!canIssue(d) || issueCashMutation.isPending}
          onClick={() => issueCashMutation.mutate(d.id)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#B45309] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Wallet className="h-3.5 w-3.5" /> Issue Cash
        </button>
      )
    }
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-[#B45309]">
        <Banknote className="h-3.5 w-3.5" /> {peso(d.purchasing_cash)} · {d.purchasing_cash_received_at ? 'Received' : 'Issued'}
      </span>
    )
  }

  return (
    <div className="space-y-5">
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-[#1C2B22] lg:text-3xl">{municipality} Deliveries</h1>
          {bucket === 'active' && (
            <span className="relative flex h-2.5 w-2.5" aria-label="Live">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2E8B57] opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#2E8B57]" />
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-[#66736B]">
          Delivery record of {municipality}: food from {municipality} restaurants and ride-hailing trips by {municipality} riders.
          {bucket === 'active' && <span className="ml-1 text-[#9AA39D]">Active trips refresh every 10 s.</span>}
        </p>
      </header>

      {/* Record tabs with counts */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Delivery record">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            role="tab"
            aria-selected={bucket === b.key}
            onClick={() => reset(() => setBucket(b.key))}
            className={cn(
              'inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition',
              bucket === b.key ? 'border-[#0F2E1D] bg-[#0F2E1D] text-white' : 'border-[#E7E2D6] bg-white text-[#1C2B22] hover:bg-[#FAF7F0]'
            )}
          >
            {b.label}
            <span className={cn('rounded-full px-2 text-xs font-bold tabular-nums', bucket === b.key ? 'bg-[#FFD700] text-[#5C4A00]' : 'bg-[#F1EDE3] text-[#66736B]')}>
              {meta?.counts[b.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 rounded-2xl border border-[#E7E2D6] bg-white p-3 lg:flex-row lg:items-center">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA39D]" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search deliveries"
            placeholder="Search order no., customer, rider or address"
            value={search}
            onChange={(e) => reset(() => setSearch(e.target.value))}
            className="w-full rounded-xl border border-[#E7E2D6] py-2 pl-9 pr-3 text-sm outline-none focus:border-[#2E8B57]"
          />
        </label>
        <select aria-label="Type" value={type} onChange={(e) => reset(() => setType(e.target.value))} className="rounded-xl border border-[#E7E2D6] px-3 py-2 text-sm outline-none">
          <option value="">Food & ride-hailing</option>
          <option value="delivery">Food delivery</option>
          <option value="transport">Ride-hailing</option>
        </select>
        <div className="flex items-center gap-1.5 text-sm">
          <input type="date" aria-label="From" value={from} onChange={(e) => reset(() => setFrom(e.target.value))} className="rounded-xl border border-[#E7E2D6] px-2 py-2 outline-none" />
          <span className="text-[#9AA39D]">–</span>
          <input type="date" aria-label="To" value={to} min={from || undefined} onChange={(e) => reset(() => setTo(e.target.value))} className="rounded-xl border border-[#E7E2D6] px-2 py-2 outline-none" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#E7E2D6] bg-white">
        {deliveries.length === 0 ? (
          <div className="p-12 text-center">
            <Truck className="mx-auto mb-3 h-10 w-10 text-[#9AA39D]" />
            <p className="font-medium text-[#66736B]">{bucket === 'active' ? 'No active deliveries' : 'No deliveries found'}</p>
            <p className="mt-1 text-sm text-[#9AA39D]">
              {bucket === 'active' ? `There are no deliveries in progress in ${municipality}.` : 'Try another tab or clear the filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="border-b border-[#E7E2D6] bg-[#FAF7F0]">
                <tr>
                  <th className={th}>Order</th>
                  <th className={th}>Restaurant</th>
                  <th className={th}>Rider</th>
                  <th className={th}>Route</th>
                  <th className={th}>Status</th>
                  <th className={th}>Purchasing cash</th>
                  <th className={cn(th, 'text-right')}>Amount</th>
                  <th className={th}>{bucket === 'active' ? 'Updated' : 'Date'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F1EDE3]">
                {deliveries.map((d) => (
                  <tr key={d.id} className="align-top hover:bg-[#FAF7F0]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#E6F2EB]">
                          {d.order_type === 'transport' ? <Car className="h-4 w-4 text-[#2E8B57]" /> : <Package className="h-4 w-4 text-[#2E8B57]" />}
                        </span>
                        <span>
                          <span className="block font-medium text-[#1C2B22]">{d.order_number ?? `Delivery #${d.id}`}</span>
                          <span className="block text-xs text-[#66736B]">{d.customer_name ?? '—'}</span>
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-[#1C2B22]">
                      {d.restaurants.length ? (
                        <span className="flex items-start gap-1.5"><Store className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2E8B57]" />{d.restaurants.join(', ')}</span>
                      ) : (
                        <span className="text-[#9AA39D]">{d.order_type === 'transport' ? 'Ride-hailing' : '—'}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {d.rider_name ? (
                        <span>
                          <span className="flex items-center gap-1.5 text-[#1C2B22]"><Bike className="h-3.5 w-3.5 text-[#66736B]" />{d.rider_name}</span>
                          {d.rider_phone && <span className="block pl-5 text-xs text-[#66736B]">{d.rider_phone}</span>}
                        </span>
                      ) : (
                        <span className="text-xs text-[#9AA39D]">Unassigned</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex max-w-xs items-start gap-1.5 text-xs text-[#66736B]"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2E8B57]" />{d.pickup_address ?? '—'}</span>
                      {d.destination_change && (
                        <span className="mt-1 flex max-w-xs items-start gap-1.5 text-xs text-[#9AA39D] line-through" title="Original destination"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />{d.destination_change.original.address ?? '—'}</span>
                      )}
                      <span className="mt-1 flex max-w-xs items-start gap-1.5 text-xs text-[#66736B]"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#DC2626]" />{d.delivery_address ?? '—'}</span>
                      {d.distance_km !== null && <span className="mt-0.5 block pl-5 text-[11px] text-[#9AA39D]">{d.distance_km.toFixed(1)} km</span>}
                      {d.destination_change && <DestinationChangeNote change={d.destination_change} />}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="flex items-center gap-2">
                        <StatusBadge status={d.status} />
                        {isCod(d) && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#B45309]">COD</span>}
                      </span>
                      {/* Trip diagnostics can repair trips: Bansud only. */}
                      {portal.district && (
                        <button
                          type="button"
                          onClick={() => setDiagnosing(d.id)}
                          aria-label={`Diagnose trip ${d.order_number ?? d.id}`}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[#2E8B57] hover:underline"
                        >
                          <Stethoscope className="h-3.5 w-3.5" /> Diagnose
                        </button>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{purchasingCash(d)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <span className="block font-semibold tabular-nums text-[#1C2B22]">{d.total !== null ? peso(d.total) : '—'}</span>
                      {d.delivery_fee !== null && <span className="block text-xs text-[#66736B]">Fee {peso(d.delivery_fee)}</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className="flex items-center gap-1.5 text-xs text-[#66736B]">
                        <Clock className="h-3 w-3" /> {formatDateTime(bucket === 'active' ? d.updated_at : (d.delivered_at ?? d.updated_at))}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.last_page > 1 && (
          <div className="flex items-center justify-between border-t border-[#F1EDE3] px-4 py-3 text-sm">
            <span className="text-[#66736B]">Page {meta.current_page} of {meta.last_page} · {meta.total} deliveries</span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-[#E7E2D6] p-1.5 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" disabled={page >= meta.last_page} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-[#E7E2D6] p-1.5 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </div>

      {portal.district && diagnosing !== null && <TripDiagnosticsPanel deliveryId={diagnosing} onClose={() => setDiagnosing(null)} />}
    </div>
  )
}
