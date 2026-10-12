import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn, formatCurrency, formatDateTime } from '@/shared/utils'
import { ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Bike, MapPin, Store } from 'lucide-react'

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

interface EarningItem {
  name: string
  quantity: number
  subtotal: number
}

interface EarningDetail {
  id: number
  order_number: string
  business_name: string
  status: string
  payment_method: string
  payment_status: string
  customer_payment: number
  delivery_fee: number
  tip: number
  rider_commission: number
  earnings: number
  pickup_address: string | null
  delivery_address: string | null
  distance_km: number | string | null
  estimated_duration_minutes: number | null
  assigned_at: string | null
  picked_up_at: string | null
  completed_at: string | null
  items: EarningItem[]
}

const ITEMS_PER_PAGE = 15

function FeeRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[#4B5563]">{label}</span>
      <span className="font-medium text-[#17201B]">{value}</span>
    </div>
  )
}

function InfoRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[#087F3F]" />
      <div className="min-w-0">
        <p className="text-[11px] text-[#6B7280]">{label}</p>
        <p className="break-words text-sm text-[#17201B]">{value}</p>
      </div>
    </div>
  )
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-[#F8FAF9] px-3 py-2">
      <p className="text-[11px] text-[#6B7280]">{label}</p>
      <p className="text-sm font-semibold capitalize text-[#17201B]">{value}</p>
    </div>
  )
}

function EarningCard({ earning }: { earning: Earning }) {
  const [expanded, setExpanded] = useState(false)

  const { data: detail, isLoading } = useQuery<EarningDetail>({
    queryKey: ['rider-earning', earning.id],
    queryFn: () => get(`/rider/earnings/${earning.id}`),
    enabled: expanded,
    staleTime: 60_000,
  })

  const distance = detail?.distance_km != null ? `${Number(detail.distance_km).toFixed(2)} km` : '—'
  const duration = detail?.estimated_duration_minutes != null ? `${detail.estimated_duration_minutes} min` : '—'

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-[#E5E9E7] bg-white shadow-sm transition hover:border-[#087F3F]/40 hover:shadow-md">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Hide' : 'View'} details for delivery ${earning.order_number}`}
        className="w-full px-4 py-3 text-left"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E9F7EF]">
              <Bike className="h-4 w-4 text-[#087F3F]" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold text-[#17201B]">{earning.order_number}</p>
              <p className="truncate text-xs text-[#6B7280]">{earning.business_name}</p>
            </div>
          </div>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-[#087F3F] transition-transform', expanded && 'rotate-180')} />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs">
          <span className="capitalize text-[#4B5563]">{earning.status.replaceAll('_', ' ')}</span>
          <span className="capitalize text-[#6B7280]">{earning.payment_method} · {earning.payment_status}</span>
        </div>
        <div className="mt-2 flex items-end justify-between border-t border-[#E5E9E7] pt-2">
          <div>
            <p className="text-[11px] text-[#6B7280]">Rider fee</p>
            <p className="font-semibold text-[#17201B]">{formatCurrency(earning.delivery_fee)}</p>
            <p className="mt-1 text-xs text-[#9CA3AF]">{formatDateTime(earning.completed_at)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-[#6B7280]">Earned</p>
            <p className="font-semibold text-[#087F3F]">{formatCurrency(earning.earnings)}</p>
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#E5E9E7] px-4 py-4">
          {isLoading ? (
            <p className="text-sm text-[#6B7280]">Loading delivery details...</p>
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <DetailStat label="Delivery ID" value={`#${detail.id}`} />
                <DetailStat label="Distance" value={distance} />
                <DetailStat label="Est. time" value={duration} />
                <DetailStat label="Status" value={detail.status.replaceAll('_', ' ')} />
              </div>

              <div className="space-y-2">
                <InfoRow icon={Store} label="Restaurant" value={detail.business_name} />
                {detail.pickup_address && <InfoRow icon={MapPin} label="Pickup" value={detail.pickup_address} />}
                {detail.delivery_address && <InfoRow icon={MapPin} label="Drop-off" value={detail.delivery_address} />}
              </div>

              {detail.items.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Ordered items</p>
                  <div className="space-y-1.5">
                    {detail.items.map((item, index) => (
                      <div key={index} className="flex items-center justify-between text-sm">
                        <span className="text-[#17201B]">{item.name} × {item.quantity}</span>
                        <span className="font-medium text-[#17201B]">{formatCurrency(item.subtotal)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5 rounded-xl bg-[#F3F8F5] p-3">
                <FeeRow label="Delivery fee" value={formatCurrency(detail.delivery_fee)} />
                <FeeRow label="Tip" value={formatCurrency(detail.tip)} />
                <FeeRow label="Rider commission" value={formatCurrency(detail.rider_commission)} />
                {detail.customer_payment > 0 && (
                  <FeeRow label="Cash collected (COD)" value={formatCurrency(detail.customer_payment)} />
                )}
                <div className="flex items-center justify-between border-t border-[#D7E2DC] pt-1.5">
                  <span className="text-sm font-semibold text-[#17201B]">Earned</span>
                  <span className="text-sm font-bold text-[#087F3F]">{formatCurrency(detail.earnings)}</span>
                </div>
                <p className="pt-1 text-xs capitalize text-[#6B7280]">Payment: {detail.payment_method} · {detail.payment_status}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[#6B7280]">Details unavailable.</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function RiderEarnings() {
  const [page, setPage] = useState(1)
  const navigate = useNavigate()

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/rider/map')
  }

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

  return (
    <div>
      <div className="mb-3 flex justify-start">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-xl border border-[#E5E9E7] bg-white px-3.5 py-2 text-sm font-semibold text-[#17201B] transition hover:bg-[#F3F8F5] hover:text-[#087F3F]"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#087F3F]">Earnings</h1>
          <p className="mt-1 text-sm text-[#087F3F]">Your delivery earnings history</p>
        </div>
        <div className="bg-[#FFF8E1] border border-[#F4B400]/30 rounded-2xl px-5 py-3 flex items-center gap-3">
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
            {earnings.map((e) => (
              <EarningCard key={e.id} earning={e} />
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
