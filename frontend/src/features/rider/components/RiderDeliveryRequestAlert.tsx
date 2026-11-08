import { useEffect, useId, useState } from 'react'
import { Banknote, BellRing, Check, ChevronRight, Clock, MapPin, Navigation, Users, UtensilsCrossed, XCircle } from 'lucide-react'
import { cn, toAssetUrl } from '@/shared/utils'

export interface ModifierLine {
  name: string
  quantity?: number
  price?: number
}

export interface ReceiptItem {
  name: string
  quantity: number
  price: number
  subtotal?: number
  modifiers?: ModifierLine[]
}

export interface RiderDeliveryRequestData {
  id?: number
  delivery_id?: number
  order_id?: number
  order_number?: string
  business_name?: string
  business_address?: string
  subtotal?: number
  pickup_address?: string | null
  delivery_address?: string | null
  rider_commission?: number | null
  rider_payout?: number
  distance_km?: number | null
  duration_minutes?: number
  items?: ReceiptItem[]
  stops?: number
  restaurant_count?: number
  cod_amount?: number
  expires_in?: number
  initial_timeout?: number
  dispatched_at?: string
  /** Offer card facts (RiderDispatchController::offerCardFacts). */
  image?: string | null
  items_count?: number
  payment_method?: string | null
  is_cod?: boolean
  is_group?: boolean
  /** Rider → first pickup estimate (minutes). */
  pickup_minutes?: number | null
  /** Restaurant → tourist route duration (minutes). */
  dropoff_minutes?: number | null
}

interface Props {
  orderData: RiderDeliveryRequestData | null
  onAccept: () => void
  onDecline: () => void
  acceptPending?: boolean
  declinePending?: boolean
}

/** Fallback rider speed for "Pickup: N min" when the server sent no estimate. */
const FALLBACK_SPEED_KMH = 25

/** Seconds → "00:01:25". */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

/** "Pickup: 3 min • Drop-off: 8 min" (parts without data are left out). */
export function offerMinutesLine(o: Pick<RiderDeliveryRequestData, 'pickup_minutes' | 'dropoff_minutes' | 'duration_minutes' | 'distance_km'>): string | null {
  const pickup = o.pickup_minutes
    ?? (o.distance_km != null ? Math.max(1, Math.ceil((Number(o.distance_km) / FALLBACK_SPEED_KMH) * 60)) : null)
  const dropoff = o.dropoff_minutes ?? (o.duration_minutes ? o.duration_minutes : null)
  const parts = [
    pickup != null ? `Pickup: ${pickup} min` : null,
    dropoff != null ? `Drop-off: ${dropoff} min` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' • ') : null
}

const peso = (n: number | null | undefined) => `₱${Number(n ?? 0).toFixed(2)}`

/**
 * The rider's live delivery offer popup (targeted 30 s offer). A white bottom
 * card: offer + countdown pills, food photo, restaurant, distance, tourist
 * location, item / group / payment chips, pickup and drop-off minutes (tap to
 * see the items and payout), then Decline / Accept. The countdown declines
 * automatically at 0 (the server owns the real deadline).
 */
export default function RiderDeliveryRequestAlert({
  orderData,
  onAccept,
  onDecline,
  acceptPending = false,
  declinePending = false,
}: Props) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null)
  const [showDetails, setShowDetails] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const titleId = useId()

  useEffect(() => {
    const initial = orderData?.initial_timeout ?? 30
    setTimeLeft(initial)
    setShowDetails(false)
    setImageFailed(false)
  }, [orderData?.delivery_id])

  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return
    const timer = setInterval(() => setTimeLeft((prev) => (prev === null || prev <= 0 ? prev : prev - 1)), 1000)
    return () => clearInterval(timer)
  }, [timeLeft])

  useEffect(() => {
    if (timeLeft !== 0) return
    if (orderData) {
      onDecline()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, orderData?.delivery_id])

  if (!orderData) return null

  const items = orderData.items ?? []
  const itemCount = orderData.items_count ?? items.reduce((acc, item) => acc + (item.quantity || 0), 0)
  const currentSeconds = timeLeft ?? orderData.initial_timeout ?? 30
  const isUrgent = currentSeconds <= 7
  const isGroup = orderData.is_group ?? (orderData.restaurant_count ?? 1) > 1
  const isCod = orderData.is_cod ?? false
  const minutes = offerMinutesLine(orderData)
  const image = orderData.image && !imageFailed ? toAssetUrl(orderData.image) : null
  const address = orderData.business_address ?? orderData.pickup_address ?? null

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/40 p-3 animate-fade-in"
      style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-[24px] bg-white p-4 shadow-2xl animate-slide-up max-h-[85vh] overflow-y-auto"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#D1D5DB]" aria-hidden="true" />

        {/* Offer + countdown */}
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#16803C] px-3 py-1.5 text-sm font-semibold text-white">
            <BellRing className="h-4 w-4" aria-hidden="true" /> New Delivery Offer
          </span>
          <span
            role="timer"
            aria-label={`Offer expires in ${currentSeconds} seconds`}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold tabular-nums',
              isUrgent ? 'border-[#FCA5A5] bg-[#FEF2F2] text-[#B91C1C]' : 'border-[#BBF7D0] bg-[#F0FDF4] text-[#166534]',
            )}
          >
            <Clock className="h-4 w-4" aria-hidden="true" /> {formatCountdown(currentSeconds)}
          </span>
        </div>

        {/* Photo + restaurant + route */}
        <div className="mt-4 flex gap-3">
          <div className="h-[92px] w-[92px] shrink-0 overflow-hidden rounded-xl bg-[#F0FDF4]">
            {image ? (
              <img src={image} alt="" className="h-full w-full object-cover" onError={() => setImageFailed(true)} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[#16803C]">
                <UtensilsCrossed className="h-8 w-8" aria-hidden="true" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-lg font-bold text-[#17201B]">
              {orderData.business_name ?? 'Restaurant'}
            </h2>
            <div className="mt-1 flex items-center gap-2 text-sm text-[#4B5563]">
              <MapPin className="h-4 w-4 shrink-0 text-[#6B7280]" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{address ?? 'Pickup location'}</span>
              {orderData.distance_km != null && (
                <span className="flex shrink-0 items-center gap-1 border-l border-[#E5E7EB] pl-2 font-semibold text-[#17201B]">
                  <Navigation className="h-3.5 w-3.5" aria-hidden="true" /> {Number(orderData.distance_km).toFixed(1)} km
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 text-sm text-[#4B5563]">
              <MapPin className="h-4 w-4 shrink-0 text-[#16803C]" aria-hidden="true" />
              <span className="truncate">{orderData.delivery_address || 'Tourist Location'}</span>
            </div>
            <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[#4B5563]" aria-label="Order facts">
              <li className="flex items-center gap-1">
                <UtensilsCrossed className="h-3.5 w-3.5" aria-hidden="true" /> {itemCount} {itemCount === 1 ? 'item' : 'items'}
              </li>
              {isGroup && (
                <li className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" /> Group Order
                </li>
              )}
              <li className="flex items-center gap-1">
                <Banknote className="h-3.5 w-3.5" aria-hidden="true" /> {isCod ? 'COD' : 'Paid online'}
              </li>
            </ul>
          </div>
        </div>

        {/* Pickup / drop-off minutes; tap for the items and payout */}
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          aria-expanded={showDetails}
          className="mt-3 flex w-full items-center gap-2 rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2.5 text-left text-sm font-semibold text-[#166534]"
        >
          <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{minutes ?? 'Trip details'}</span>
          <ChevronRight className={cn('h-4 w-4 shrink-0 transition-transform', showDetails && 'rotate-90')} aria-hidden="true" />
        </button>

        {showDetails && (
          <div className="mt-2 rounded-xl border border-[#E5E7EB] p-3 text-sm" data-testid="offer-details">
            <div className="flex items-center justify-between text-xs text-[#6B7280]">
              <span>Order {orderData.order_number ?? `TT-${String(orderData.order_id ?? 0).padStart(5, '0')}`}</span>
              {orderData.subtotal != null && <span>Food {peso(orderData.subtotal)}</span>}
            </div>
            {items.length > 0 && (
              <ul className="mt-2 space-y-1">
                {items.map((item, idx) => (
                  <li key={idx} className="flex justify-between gap-2 text-[#17201B]">
                    <span className="min-w-0 truncate"><span className="font-semibold text-[#16803C]">{item.quantity}×</span> {item.name}</span>
                    <span className="shrink-0 tabular-nums">{peso(item.subtotal ?? item.price * item.quantity)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex justify-between border-t border-[#EEF1EF] pt-2 font-semibold text-[#166534]">
              <span>Your payout</span>
              <span className="tabular-nums">{peso(orderData.rider_payout)}</span>
            </div>
          </div>
        )}

        {/* Decline / Accept */}
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onDecline}
            disabled={declinePending}
            aria-label="Decline offer"
            className="flex h-12 items-center justify-center gap-2 rounded-full border-2 border-[#16803C] bg-white text-base font-bold text-[#16803C] transition active:scale-[0.99] disabled:opacity-60"
          >
            <XCircle className="h-5 w-5" aria-hidden="true" /> Decline
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={acceptPending}
            aria-label="Accept order request"
            className="flex h-12 items-center justify-center gap-2 rounded-full bg-[#16803C] text-base font-bold text-white shadow-md transition hover:bg-[#126B32] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {acceptPending ? 'Accepting…' : (<><Check className="h-5 w-5" aria-hidden="true" /> Accept</>)}
          </button>
        </div>
      </section>
    </div>
  )
}
