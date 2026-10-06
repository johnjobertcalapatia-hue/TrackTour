import { useState, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import { cn } from '@/shared/utils'
import {
  ChevronUp,
  ChevronDown,
  MapPin,
  Store,
  User,
  CheckCircle,
  Package,
  Wallet,
} from 'lucide-react'
import { resolveStopArrival, formatStopDistance } from '@/features/rider/stop-arrival'
import { pickupReadyLabel, pickupStopReasonLabel } from '@/features/rider/pickup-stops'
import { useOsrmRoute } from '@/features/rider/hooks/useOsrmRoute'

// Shares the `rider-map-location` cache key with RiderActiveTripProvider and
// RiderMap, so this sheet never issues a duplicate request — it re-renders on
// the same 10s authoritative poll cycle those components already drive.
interface OrderInfo {
  id: number
  order_id: number
  status: string
  pickup_address: string
  pickup_lat: number | null
  pickup_lng: number | null
  delivery_address: string
  delivery_lat: number | null
  delivery_lng: number | null
  business_name?: string | null
  customer_name?: string | null
  created_at?: string | null
}

// Minimum vertical drag (px) before a pull-up/pull-down toggles the sheet.
const DRAG_THRESHOLD_PX = 56

function formatDate(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatEta(distanceKm: number | null, durationMin: number | null): string {
  if (distanceKm == null && durationMin == null) return ''
  const parts: string[] = []
  if (durationMin != null) parts.push(`~${Math.max(1, Math.round(durationMin))} min`)
  if (distanceKm != null) parts.push(`${distanceKm.toFixed(1)} km`)
  return parts.join(' · ')
}

export default function RiderOrderInfoSheet() {
  const {
    activeDelivery,
    tripState,
    riderPosition,
    pickupStopsData,
  } = useRiderActiveTrip()
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragDelta, setDragDelta] = useState(0)
  const startYRef = useRef(0)
  const movedRef = useRef(false)

  const { data } = useQuery({
    queryKey: ['rider-map-location'],
    queryFn: async () => (await get<{ deliveries?: OrderInfo[] }>('/rider/map/location')) ?? { deliveries: [] },
    refetchInterval: 10000,
    staleTime: 5000,
    retry: false,
  })

  const activeId = activeDelivery?.id ?? null
  const purchaseStops = pickupStopsData?.stops ?? []
  const collectedCount = purchaseStops.filter((p) => p.status === 'collected').length
  const pickupOrigin = pickupStopsData?.pickup_origin ?? null
  const dropoff = pickupStopsData?.dropoff ?? null
  const isPickupStage = !!activeDelivery && ['assigned', 'arrived_pickup'].includes(activeDelivery.status)
  const isDropLeg = tripState === 'OUT_FOR_DELIVERY' || tripState === 'ARRIVED_AT_DROP'

  const {
    activeStop,
    distanceMeters: activeStopDistanceMeters,
    arrived: arrivedAtActiveStop,
  } = resolveStopArrival({
    riderLatitude: riderPosition[0],
    riderLongitude: riderPosition[1],
    stops: purchaseStops.map((stop) => ({
      id: stop.id,
      sequence: stop.sequence,
      status: stop.status,
      latitude: stop.pickup_lat,
      longitude: stop.pickup_lng,
      business_name: stop.business_name,
    })),
  })

  const dropPlanWaypoints: [number, number][] | null =
    pickupOrigin?.latitude != null &&
    pickupOrigin.longitude != null &&
    dropoff?.latitude != null &&
    dropoff.longitude != null &&
    (pickupOrigin.latitude !== dropoff.latitude || pickupOrigin.longitude !== dropoff.longitude)
      ? [[pickupOrigin.latitude, pickupOrigin.longitude], [dropoff.latitude, dropoff.longitude]]
      : null
  const plannedDropRoute = useOsrmRoute(
    dropPlanWaypoints,
    !!dropPlanWaypoints && isPickupStage && !isDropLeg
  )
  const plannedDropEtaLabel = formatEta(plannedDropRoute.distanceKm, plannedDropRoute.durationMin)

  const deliveries = data?.deliveries ?? []
  const active =
    activeId != null ? (deliveries.find((d) => d.id === activeId) ?? activeDelivery) : null
  const others = activeId != null ? deliveries.filter((d) => d.id !== activeId) : deliveries

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    startYRef.current = event.clientY
    movedRef.current = false
    setDragging(true)
    setDragDelta(0)
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is best-effort (some embedded webviews reject it).
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragging) return
    const delta = event.clientY - startYRef.current
    if (Math.abs(delta) > 4) movedRef.current = true
    // Expanded: only a pull-down (positive) can collapse — never push the sheet
    // above the screen. Collapsed: a pull-up (negative) previews the opening.
    setDragDelta(expanded ? Math.max(0, delta) : Math.min(0, delta))
  }

  const endDrag = () => {
    if (!dragging) return
    setDragging(false)
    const delta = dragDelta
    setDragDelta(0)
    if (expanded) {
      if (delta > DRAG_THRESHOLD_PX) setExpanded(false)
    } else if (delta < -DRAG_THRESHOLD_PX) {
      setExpanded(true)
    }
  }

  const handleClick = () => {
    // A drag release also composes a click — ignore it so a swipe never toggles.
    if (movedRef.current) return
    setExpanded((open) => !open)
  }

  // Hidden entirely when there is nothing worth showing (idle rider, no orders).
  if (!active && others.length === 0) return null

  const orderCount = deliveries.length

  return (
    <div
      className={cn(
        'w-full select-none overflow-hidden rounded-2xl border border-[#E5E9E7] bg-white/95 shadow-lg backdrop-blur-md',
        !dragging && 'transition-transform duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)]'
      )}
      style={{ transform: dragging ? `translateY(${dragDelta}px)` : undefined }}
    >
      {!expanded ? (
        <button
          type="button"
          aria-expanded={false}
          aria-label="Show order details"
          onClick={handleClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="flex w-full touch-none items-center justify-center gap-2 px-4 py-2.5"
        >
          <span className="h-1 w-10 shrink-0 rounded-full bg-[#DCDEE3]" aria-hidden="true" />
          <span className="text-[11px] font-semibold text-[#17201B]">Order details</span>
          {orderCount > 0 && (
            <span className="rounded-full bg-[#E9F7EF] px-1.5 py-0.5 text-[10px] font-bold text-[#087F3F]">
              {orderCount}
            </span>
          )}
          <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
        </button>
      ) : (
        <div className="max-h-[46vh] overflow-y-auto custom-scrollbar">
          <button
            type="button"
            aria-expanded={true}
            aria-label="Hide order details"
            onClick={handleClick}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="flex w-full touch-none items-center justify-between gap-2 border-b border-[#E5E9E7] px-4 py-3"
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-1 w-10 shrink-0 rounded-full bg-[#DCDEE3]" aria-hidden="true" />
              <span className="text-xs font-bold text-[#17201B]">Order details</span>
              {orderCount > 0 && (
                <span className="rounded-full bg-[#E9F7EF] px-1.5 py-0.5 text-[10px] font-bold text-[#087F3F]">
                  {orderCount}
                </span>
              )}
            </div>
            <span className="flex items-center gap-1 text-[10px] font-semibold text-[#6B7280]">
              Drag down or tap <ChevronDown className="h-3.5 w-3.5" />
            </span>
          </button>
          {active && (
            <div className="space-y-3 border-b border-[#E5E9E7] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-xs font-extrabold text-[#17202A]">Order #{active.order_id}</span>
                  <StatusBadge status={active.status} />
                </div>
                {active.created_at && (
                  <span className="shrink-0 text-[10px] font-medium text-[#9CA3AF]">{formatDate(active.created_at)}</span>
                )}
              </div>
              {!active.business_name && !active.customer_name && (
                <p className="text-[10px] font-medium uppercase tracking-wider text-[#6B7280]">Active delivery</p>
              )}
              <div className="flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EAF6ED]">
                  <Store className="h-4 w-4 text-[#087F3F]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#087F3F]">Pickup</p>
                  <p className="truncate text-xs font-semibold text-[#17202A]">{active.business_name || 'Restaurant'}</p>
                  <p className="text-[11px] leading-snug text-[#68727C]">{active.pickup_address}</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#FDECEC]">
                  <User className="h-4 w-4 text-[#DC2626]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#DC2626]">Delivery</p>
                  <p className="truncate text-xs font-semibold text-[#17202A]">{active.customer_name || 'Tourist'}</p>
                  <p className="text-[11px] leading-snug text-[#68727C]">{active.delivery_address}</p>
                </div>
              </div>
            </div>
          )}
          {isPickupStage && purchaseStops.length > 0 && (
            <div className={cn('px-4 py-3', others.length > 0 && 'border-b border-[#E5E9E7]')}>
              <div className="flex items-center gap-2">
                <span className="w-8 h-8 shrink-0 rounded-full bg-[#E9F7EF] border border-[#D7E8DB] flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-[#B45309]" />
                </span>
                <div className="flex-1">
                  <p className="text-xs font-bold text-[#17202A]">
                    Pickup Stops · {collectedCount}/{purchaseStops.length} confirmed
                  </p>
                  <p className="text-[10px] text-[#6B7280] font-semibold">
                    Confirm the item pickup at every restaurant in order
                  </p>
                </div>
              </div>

              {pickupOrigin && dropoff && (
                <div className="mt-3 rounded-xl bg-[#F5FBF7] border border-[#D7E8DB] px-3 py-2.5 space-y-1">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#087F3F]">Route</p>
                  <p className="text-[11px] font-medium text-[#17202A] truncate">
                    Pickups: {purchaseStops.map((stop) => stop.business_name).join(' → ')}
                  </p>
                  <p className="text-[11px] font-medium text-[#17202A]">
                    Last pickup: <span className="text-[#087F3F]">{pickupOrigin.business_name}</span>
                  </p>
                  <p className="text-[11px] font-medium text-[#17202A]">
                    Drop-off: <span className="text-[#DC2626]">{dropoff.address || '—'}</span>
                    {plannedDropEtaLabel ? ` · ${plannedDropEtaLabel}` : ''}
                  </p>
                </div>
              )}

              <div className="mt-3 space-y-2">
                {activeStop && !arrivedAtActiveStop && (
                  <div className="rounded-xl bg-[#FFF7ED] border border-amber-200 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                          Pickup {activeStop.sequence} of {purchaseStops.length}
                        </p>
                        <p className="text-xs font-bold text-[#17202A] truncate">
                          {activeStop.business_name || `Business #${activeStop.id}`}
                        </p>
                        <p className="text-[10px] font-semibold text-[#B45309]">
                          {activeStopDistanceMeters != null
                            ? `${formatStopDistance(activeStopDistanceMeters)} away`
                            : 'Heading to pickup'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {purchaseStops.map((stop) => {
                  const stopConfirmed = stop.status === 'collected'
                  const isActiveStop = stop.id === activeStop?.id
                  const arrivedAtStop = isActiveStop && arrivedAtActiveStop
                  const reasonLabel = stop.status === 'pending' ? pickupStopReasonLabel(stop.reason) : null

                  return (
                    <div key={stop.id} className="flex items-center gap-3 rounded-xl border border-[#E4E9E6] bg-[#FAFBFB] px-3 py-2.5">
                      <span className={`w-8 h-8 shrink-0 rounded-full flex items-center justify-center ${
                        stopConfirmed ? 'bg-[#087F3F]/15' : 'bg-gray-100'
                      }`}>
                        {stopConfirmed
                          ? <CheckCircle className="w-4 h-4 text-[#087F3F]" />
                          : <Package className="w-4 h-4 text-[#9CA3AF]" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="inline-flex items-center justify-center w-4 h-4 shrink-0 rounded-full bg-[#087F3F] text-white text-[9px] font-bold">
                            {stop.sequence}
                          </span>
                          <p className="text-xs font-semibold text-[#17202A] truncate">{stop.business_name || `Business #${stop.business_id}`}</p>
                        </div>
                        <p className="text-[10px] text-[#6B7280] font-medium">
                          {`${stop.active_item_count} item${stop.active_item_count === 1 ? '' : 's'}`}
                          {stop.preparation_time != null ? ` · ~${stop.preparation_time} min prep` : ''}
                        </p>
                        {!stopConfirmed && (
                          <span className={`inline-flex mt-1 text-[10px] font-semibold rounded-md px-1.5 py-0.5 ${
                            stop.is_ready ? 'bg-[#EAF6ED] text-[#087F3F]' : 'bg-amber-50 text-amber-700'
                          }`}>
                            {pickupReadyLabel(stop.ready_label)}
                          </span>
                        )}
                        {stop.items && stop.items.length > 0 && (
                          <div className="mt-1.5 space-y-0.5 border-t border-[#E4E9E6]/70 pt-1.5">
                            {stop.items.map((item) => (
                              <p key={item.id} className="text-[11px] font-medium text-[#68727C] leading-snug">
                                {item.quantity}× {item.product_name}
                                {item.notes ? <span className="text-amber-700"> — {item.notes}</span> : null}
                              </p>
                            ))}
                          </div>
                        )}
                        {isActiveStop && (
                          <p className={`text-[10px] font-semibold ${arrivedAtStop ? 'text-[#087F3F]' : 'text-[#B45309]'}`}>
                            {arrivedAtStop
                              ? '✓ You\'ve arrived'
                              : activeStopDistanceMeters != null
                                ? `${formatStopDistance(activeStopDistanceMeters)} away`
                                : 'Heading to pickup'}
                          </p>
                        )}
                        {reasonLabel && (
                          <p className="text-[10px] font-medium text-[#9CA3AF] mt-0.5">{reasonLabel}</p>
                        )}
                      </div>
                      <div className="shrink-0 flex gap-1.5">
                        {stopConfirmed && (
                          <span className="text-[11px] font-semibold text-[#087F3F] self-center">Collected ✓</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {others.length > 0 && (
            <div className={cn('px-4 py-3', !active && 'pt-4')}>
              <p className="pb-2 text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">
                {active ? 'Other orders' : 'Recent orders'}
              </p>
              <div className="space-y-2.5">
                {others.map((delivery) => (
                  <div key={delivery.id} className="rounded-xl border border-[#E4E9E6] bg-[#FAFBFB] px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[#17202A]">Order #{delivery.order_id}</span>
                      <StatusBadge status={delivery.status} />
                    </div>
                    <div className="mt-1.5 flex items-start gap-1.5">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                      <p className="truncate text-[11px] font-medium text-[#68727C]">{delivery.pickup_address}</p>
                    </div>
                    <div className="mt-1 flex items-start gap-1.5">
                      <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
                      <p className="truncate text-[11px] font-medium text-[#68727C]">{delivery.delivery_address}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}