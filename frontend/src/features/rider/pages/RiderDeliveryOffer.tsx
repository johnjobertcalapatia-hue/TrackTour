import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Clock, Eye, MapPin, Package, Store, UserCheck, UtensilsCrossed } from 'lucide-react'
import { del, patch, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn, formatDateTime, toAssetUrl } from '@/shared/utils'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { km, orderLabel, paymentLabel, peso, type DeliveryOffer, type OfferResponse, type TakenOffer } from '@/features/rider/services/delivery-offers'

/** Hold renewal while the review page is open (server hold lapses after ~90 s without it). */
const HEARTBEAT_MS = 30_000

const apiMessage = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[#6B7280]">{label}</dt>
      <dd className="text-lg font-bold text-[#17201B]">{value}</dd>
    </div>
  )
}

/**
 * Delivery offer details: order, delivery type, money, distance, pickups,
 * destination and ordered items.
 *
 * Opening the page claims the exclusive review hold (POST
 * /rider/deliveries/{id}/review): while this rider reviews, no other rider can
 * view or accept the offer. There is no visible timer (product decision
 * 2026-11-07 — the 30 s countdown belongs to the targeted ping popup): the page
 * renews the hold every 30 s while open (PATCH …/review) and releases it when
 * the rider accepts elsewhere, finds other offers, or leaves. An abandoned page
 * stops renewing and the server lets the hold lapse.
 */
export default function RiderDeliveryOffer() {
  const { deliveryId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fetchUser = useAuthStore((s) => s.fetchUser)
  const [actionError, setActionError] = useState<string | null>(null)

  const { data: offer, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['rider-delivery-offer', deliveryId],
    queryFn: () => post<OfferResponse>(`/rider/deliveries/${deliveryId}/review`),
    retry: false,
    refetchOnWindowFocus: false,
  })

  const reviewingByMe = Boolean(offer && offer.availability === 'available' && offer.reviewing_by_me)

  // Keep the hold alive while the page is open (no visible timer). If the
  // server reports the hold was lost (taken, or another rider got it after a
  // lapse), reload the offer to show its current state.
  useEffect(() => {
    if (!reviewingByMe) return
    const t = window.setInterval(() => {
      void patch<{ held: boolean }>(`/rider/deliveries/${deliveryId}/review`)
        .then((res) => { if (res && res.held === false) void refetch() })
        .catch(() => undefined)
    }, HEARTBEAT_MS)
    return () => window.clearInterval(t)
  }, [reviewingByMe, deliveryId, refetch])

  // Leaving the page without accepting hands the offer back right away.
  const holding = useRef(false)
  const accepted = useRef(false)
  holding.current = reviewingByMe
  useEffect(() => () => {
    if (holding.current && !accepted.current) void del(`/rider/deliveries/${deliveryId}/review`).catch(() => undefined)
  }, [deliveryId])

  const release = () => del(`/rider/deliveries/${deliveryId}/review`).catch(() => undefined)

  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: ['rider-deliveries-pending'] })
    void queryClient.invalidateQueries({ queryKey: ['rider-deliveries-active'] })
    void queryClient.invalidateQueries({ queryKey: ['rider-map-location'] })
    void queryClient.invalidateQueries({ queryKey: ['rider-dashboard'] })
  }

  const accept = useMutation({
    mutationFn: () => patch('/rider/dispatch/accept', { delivery_id: Number(deliveryId) }),
    onMutate: () => { accepted.current = true },
    onSuccess: () => {
      setActionError(null)
      void fetchUser()
      refreshLists()
      // Accepted: follow the delivery stage by stage (RiderTripStatus).
      navigate(`/rider/deliveries/${deliveryId}/status`, { replace: true })
    },
    onError: (e) => {
      accepted.current = false
      // Another rider got it first (409) or an eligibility gate refused (422).
      setActionError(apiMessage(e, 'Failed to accept the delivery. Please try again.'))
      refreshLists()
      void queryClient.invalidateQueries({ queryKey: ['rider-delivery-offer', deliveryId] })
    },
  })

  const decline = useMutation({
    mutationFn: () => patch('/rider/dispatch/decline', { delivery_id: Number(deliveryId) }),
    onSuccess: () => {
      void release()
      refreshLists()
      navigate('/rider/deliveries/pending', { replace: true })
    },
    onError: (e) => setActionError(apiMessage(e, 'Could not decline this offer.')),
  })

  const findOther = useMutation({
    mutationFn: release,
    onSettled: () => {
      holding.current = false
      refreshLists()
      navigate('/rider/deliveries/pending', { replace: true })
    },
  })

  // `replace`: returning to the list swaps out this offer page instead of
  // stacking another list page on top (list Back ↔ offer link loop).
  const back = (
    <Link to="/rider/deliveries/pending" replace className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#17201B] mb-6 transition">
      <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Available deliveries
    </Link>
  )

  if (isLoading) return <DashboardSkeleton />
  if (isError || !offer) {
    return (
      <div>
        {back}
        <div className="bg-white rounded-2xl border border-[#E5E9E7] p-10 text-center">
          <Package className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" aria-hidden="true" />
          <p className="font-semibold text-[#17201B]">{apiMessage(error, 'This delivery offer is no longer available.')}</p>
          <p className="text-sm text-[#6B7280] mt-1">It may have been accepted by another rider.</p>
        </div>
      </div>
    )
  }

  if (offer.availability === 'taken' || offer.availability === 'reviewing') {
    return <RestrictedOfferView offer={offer as TakenOffer} back={back} onRetry={() => void refetch()} />
  }

  // Restricted states returned above: this is the full offer.
  const detail = offer as DeliveryOffer

  const isBooking = detail.items.length === 0 && detail.pickups.length === 0
  const fast = detail.delivery_speed === 'fast'
  const busy = accept.isPending || decline.isPending || findOther.isPending

  return (
    <div className="max-w-2xl">
      {back}

      <div className="bg-white rounded-2xl border border-[#E5E9E7] divide-y divide-[#EEF1EF]">
        <header className="p-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#17201B]">{isBooking ? 'Booking' : 'Delivery'} Offer</h1>
            <p className="text-sm text-[#6B7280]">Order {orderLabel(detail)}</p>
            <p className="text-xs text-[#9CA3AF] mt-0.5">{formatDateTime(detail.created_at)}</p>
          </div>
          <span className={fast ? 'shrink-0 rounded-full bg-[#DBEAFE] text-[#1D4ED8] px-3 py-1 text-xs font-semibold' : 'shrink-0 rounded-full bg-[#F3F4F6] text-[#4B5563] px-3 py-1 text-xs font-semibold'}>
            {detail.delivery_type_label}
          </span>
        </header>

        <section className="p-5" aria-labelledby="offer-overview">
          <h2 id="offer-overview" className="text-sm font-bold text-[#17201B] mb-3">Delivery overview</h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Stat label="Estimated distance" value={km(detail.distance_km)} />
            <Stat label="Delivery fee" value={peso(detail.delivery_fee)} />
            <Stat label="Customer tip" value={peso(detail.rider_tip)} />
            {!isBooking && <Stat label="Food items" value={String(detail.items_count)} />}
            {detail.estimated_duration_minutes != null && <Stat label="Estimated time" value={`${detail.estimated_duration_minutes} min`} />}
            <Stat label="Payment" value={paymentLabel(detail)} />
          </dl>
          {detail.is_cod && (
            <p className="mt-3 text-xs text-[#6B7280]">Cash on delivery: you collect the payment from the customer at drop-off.</p>
          )}
        </section>

        <section className="p-5 space-y-4" aria-labelledby="offer-route">
          <h2 id="offer-route" className="text-sm font-bold text-[#17201B]">Delivery information</h2>
          {detail.pickups.length > 0 ? (
            <ol className="space-y-3" aria-label="Pickup locations">
              {detail.pickups.map((p, i) => (
                <li key={p.id} className="flex items-start gap-3">
                  <Store className="w-5 h-5 text-[#16803C] shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#17201B]">
                      Pickup location{detail.pickups.length > 1 ? ` ${i + 1}` : ''}
                    </p>
                    <p className="text-sm text-[#17201B]">{p.name}</p>
                    <p className="text-xs text-[#6B7280]">{p.address ?? detail.pickup.address}</p>
                    {detail.pickups.length > 1 && <p className="text-xs text-[#6B7280]">{p.items_count} {p.items_count === 1 ? 'item' : 'items'}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-[#16803C] shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-[#17201B]">Pickup location</p>
                <p className="text-xs text-[#6B7280]">{detail.pickup.address}</p>
              </div>
            </div>
          )}
          <div className="flex items-start gap-3">
            <MapPin className="w-5 h-5 text-[#DC2626] shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-[#17201B]">Delivery destination</p>
              <p className="text-xs text-[#6B7280]">{detail.dropoff.address}</p>
            </div>
          </div>
        </section>

        {detail.items.length > 0 && (
          <section className="p-5" aria-labelledby="offer-items">
            <h2 id="offer-items" className="text-sm font-bold text-[#17201B] mb-3">Ordered items</h2>
            <ul className="space-y-3">
              {detail.items.map((it) => (
                <li key={it.id} className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-lg overflow-hidden bg-[#F3F4F6] shrink-0 flex items-center justify-center">
                    {it.image ? <img src={toAssetUrl(it.image)} alt="" className="w-full h-full object-cover" /> : <UtensilsCrossed className="w-5 h-5 text-[#9CA3AF]" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#17201B] truncate">{it.product_name}</p>
                    <p className="text-xs text-[#6B7280]">
                      Quantity: {it.quantity}
                      {detail.pickups.length > 1 && ` · ${detail.pickups.find((p) => p.id === it.business_id)?.name ?? ''}`}
                    </p>
                    {it.notes && <p className="text-xs text-[#6B7280] italic truncate">Note: {it.notes}</p>}
                  </div>
                  <p className="text-sm font-bold text-[#17201B]">{peso(it.subtotal)}</p>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t border-[#EEF1EF] flex justify-between text-sm">
              <span className="text-[#6B7280]">Food total</span>
              <span className="font-bold text-[#17201B]">{peso(detail.items_total)}</span>
            </div>
          </section>
        )}

        <section className="p-5 space-y-2.5" aria-label="Offer actions">
          {actionError && (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{actionError}</p>
          )}
          {detail.is_mine ? (
            <Link to="/rider/map" className="flex items-center justify-center gap-2 h-11 rounded-full bg-[#16803C] text-white text-sm font-semibold">
              <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> You accepted this delivery. Open trip
            </Link>
          ) : (
            <>
              <button
                type="button"
                onClick={() => { setActionError(null); accept.mutate() }}
                disabled={busy}
                className="w-full flex items-center justify-center gap-2 h-11 rounded-full bg-[#16803C] hover:bg-[#126B32] disabled:opacity-50 text-white text-sm font-semibold"
              >
                <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> {accept.isPending ? 'Accepting…' : `Accept ${isBooking ? 'Booking' : 'Delivery'}`}
              </button>
              {detail.offered_to_me ? (
                <button
                  type="button"
                  onClick={() => { setActionError(null); decline.mutate() }}
                  disabled={busy}
                  className="w-full h-11 rounded-full border border-[#D1D5DB] text-sm font-semibold text-[#17201B] hover:bg-[#F9FAFB] disabled:opacity-50"
                >
                  {decline.isPending ? 'Declining…' : 'Decline Offer'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => { setActionError(null); findOther.mutate() }}
                  disabled={busy}
                  className="w-full h-11 rounded-full border border-[#D1D5DB] text-sm font-semibold text-[#17201B] hover:bg-[#F9FAFB] disabled:opacity-50"
                >
                  Find other offers
                </button>
              )}
              <p className="flex items-center justify-center gap-1 text-xs text-[#9CA3AF]">
                <Clock className="w-3.5 h-3.5" aria-hidden="true" /> Other riders can't view or accept this offer while you review it.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/** Another rider has it (reviewing now, or accepted): show the state, never an accept action. */
function RestrictedOfferView({ offer, back, onRetry }: { offer: TakenOffer; back: ReactNode; onRetry: () => void }) {
  const reviewing = offer.availability === 'reviewing'
  return (
    <div className="max-w-2xl">
      {back}
      <div className="bg-white rounded-2xl border border-[#E5E9E7] divide-y divide-[#EEF1EF]">
        <header className="p-5 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#17201B]">{offer.order_type === 'transport' ? 'Booking' : 'Delivery'} Offer</h1>
            <p className="text-sm text-[#6B7280]">Order {orderLabel(offer)}</p>
          </div>
          <span className="shrink-0 rounded-full bg-[#F3F4F6] text-[#4B5563] px-3 py-1 text-xs font-semibold">{offer.delivery_type_label}</span>
        </header>
        <div role="status" className={cn('p-5 flex items-start gap-3', reviewing ? 'bg-[#FFFBEB]' : 'bg-[#FEF2F2]')}>
          {reviewing
            ? <Eye className="w-5 h-5 text-[#92400E] shrink-0 mt-0.5" aria-hidden="true" />
            : <UserCheck className="w-5 h-5 text-[#B91C1C] shrink-0 mt-0.5" aria-hidden="true" />}
          <div>
            <p className={cn('text-sm font-bold', reviewing ? 'text-[#92400E]' : 'text-[#B91C1C]')}>{offer.status_label}</p>
            <p className={cn('text-xs mt-0.5', reviewing ? 'text-[#78350F]' : 'text-[#7F1D1D]')}>
              {reviewing
                ? 'You can view or accept it only if that rider lets it go. Find another offer meanwhile.'
                : 'This offer can no longer be accepted. Check Available Deliveries for other orders.'}
            </p>
          </div>
        </div>
        <dl className="p-5 grid grid-cols-2 gap-x-4 gap-y-4">
          <Stat label="Estimated distance" value={km(offer.distance_km)} />
          <Stat label="Delivery fee" value={peso(offer.delivery_fee)} />
          <Stat label="Customer tip" value={peso(offer.rider_tip)} />
          {offer.pickup_names.length > 0 && <Stat label="Pickup" value={offer.pickup_names.join(', ')} />}
        </dl>
        <div className="p-5 space-y-2.5">
          <Link to="/rider/deliveries/pending" replace className="flex items-center justify-center h-11 rounded-full bg-[#16803C] text-white text-sm font-semibold">
            See other deliveries
          </Link>
          {reviewing && (
            <button type="button" onClick={onRetry} className="w-full h-11 rounded-full border border-[#D1D5DB] text-sm font-semibold text-[#17201B] hover:bg-[#F9FAFB]">
              Check again
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
