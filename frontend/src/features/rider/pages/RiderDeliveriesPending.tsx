import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn, formatDateTime } from '@/shared/utils'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { ArrowLeft, MapPin, Navigation, Store } from 'lucide-react'
import { boardSummaryLine, isRestricted, km, orderLabel, peso, type PendingDelivery } from '@/features/rider/services/delivery-offers'
import type { ReactNode } from 'react'

/**
 * Available Deliveries: one card per offer with the decision facts (order,
 * type, pickup, distance, fee, tip, items). The card opens the offer page,
 * where the rider accepts (RiderDeliveryOffer).
 *
 * Dispatch Stage 3: the server lists this rider's own targeted offer first,
 * then the manual board nearest first (by distance to the first pickup).
 * Offers another rider won leave the list; the offer page explains it.
 */
/** Available offers open the offer page; ones another rider has (reviewing or accepted) are shown but inert. */
function CardShell({ d, label, children }: { d: PendingDelivery; label: string; children: ReactNode }) {
  if (isRestricted(d)) {
    return (
      <article aria-label={label} aria-disabled="true" className="block bg-[#F9FAFB] rounded-2xl border border-[#E5E9E7] p-5 opacity-80">
        {children}
      </article>
    )
  }
  return (
    <Link
      to={`/rider/deliveries/offer/${d.id}`}
      aria-label={`View offer for ${label}`}
      className="block bg-white rounded-2xl border border-[#E5E9E7] p-5 hover:border-[#16803C]/40 hover:shadow-sm transition"
    >
      {children}
    </Link>
  )
}

export default function RiderDeliveriesPending() {
  const navigate = useNavigate()
  const currentService = useAuthStore((state) => state.user?.current_service)
  const isRideHailing = currentService === 'transport'

  const { data, isLoading } = useQuery({
    queryKey: ['rider-deliveries-pending'],
    queryFn: () => get<PendingDelivery[]>('/rider/deliveries/pending'),
    // Review holds last 90 s; refresh often so freed offers reappear quickly.
    refetchInterval: 10000,
  })

  if (isLoading) return <DashboardSkeleton />

  const deliveries = data ?? []

  return (
    <div>
      {/* A fixed destination, not history back: the offer page links here,
          so "back" from the list must never bounce into an offer (loop). */}
      <button
        type="button"
        onClick={() => navigate('/rider/map')}
        className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#17201B] mb-6 transition"
      >
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">
          {isRideHailing ? 'Available Bookings' : 'Available Deliveries'}
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          {isRideHailing ? 'Accept bookings to start earning' : 'Accept deliveries to start earning'}
        </p>
      </div>

      {deliveries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] p-12 text-center">
          <Navigation className="w-12 h-12 text-[#9CA3AF] mx-auto mb-4" />
          <p className="text-[#6B7280]">
            No available {isRideHailing ? 'bookings' : 'deliveries'} right now. Check back soon!
          </p>
        </div>
      ) : (
        <ul className="space-y-4" aria-label={isRideHailing ? 'Available bookings' : 'Available deliveries'}>
          {deliveries.map((d) => {
            const isBooking = d.order_type === 'transport'
            const pickupName = d.pickup_names.length > 1 ? `${d.pickup_names.length} restaurants` : d.pickup_names[0]
            const restricted = isRestricted(d)
            const reviewing = d.availability === 'reviewing'
            return (
              <li key={d.id}>
                <CardShell d={d} label={`${isBooking ? 'booking' : 'order'} ${orderLabel(d)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-bold text-[#17201B]">{isBooking ? 'Booking' : 'Order'} {orderLabel(d)}</p>
                    {restricted ? (
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold',
                          reviewing ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-[#FEE2E2] text-[#B91C1C]',
                        )}
                      >
                        {d.status_label ?? (reviewing ? 'Another rider is reviewing this offer' : 'Already accepted by another rider')}
                      </span>
                    ) : d.reviewing_by_me ? (
                      <span className="shrink-0 rounded-full bg-[#DCFCE7] text-[#166534] px-2.5 py-0.5 text-xs font-semibold">
                        You're reviewing
                      </span>
                    ) : (
                    <span
                      className={
                        d.delivery_speed === 'fast'
                          ? 'shrink-0 rounded-full bg-[#DBEAFE] text-[#1D4ED8] px-2.5 py-0.5 text-xs font-semibold'
                          : 'shrink-0 rounded-full bg-[#F3F4F6] text-[#4B5563] px-2.5 py-0.5 text-xs font-semibold'
                      }
                    >
                      {d.delivery_speed === 'fast' ? 'Priority' : 'Standard'}
                    </span>
                    )}
                  </div>
                  {!isBooking && (
                    <p className="mt-1 text-xs font-medium text-[#4B5563]" data-testid="board-summary">{boardSummaryLine(d)}</p>
                  )}

                  <div className="mt-3 space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      {isBooking ? <MapPin className="w-4 h-4 text-[#16803C] mt-0.5 shrink-0" aria-hidden="true" /> : <Store className="w-4 h-4 text-[#16803C] mt-0.5 shrink-0" aria-hidden="true" />}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#17201B]">Pickup</p>
                        {pickupName && <p className="text-xs text-[#4B5563] truncate">{pickupName}</p>}
                        <p className="text-xs text-[#6B7280] truncate">{d.pickup_address}</p>
                      </div>
                    </div>
                    {d.delivery_address && <div className="flex items-start gap-2.5">
                      <MapPin className="w-4 h-4 text-[#DC2626] mt-0.5 shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#17201B]">{isBooking ? 'Drop-off' : 'Delivery'}</p>
                        <p className="text-xs text-[#6B7280] truncate">{d.delivery_address}</p>
                      </div>
                    </div>}
                  </div>

                  <dl className="mt-4 pt-4 border-t border-[#EEF1EF] grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <dt className="text-xs text-[#6B7280]">Distance</dt>
                      <dd className="text-base font-bold text-[#17201B]">{km(d.distance_km)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[#6B7280]">Delivery fee</dt>
                      <dd className="text-base font-bold text-[#17201B]">{peso(d.delivery_fee)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-[#6B7280]">Customer tip</dt>
                      <dd className="text-base font-bold text-[#17201B]">{peso(d.rider_tip)}</dd>
                    </div>
                    {!isBooking && (
                      <div>
                        <dt className="text-xs text-[#6B7280]">Food items</dt>
                        <dd className="text-base font-bold text-[#17201B]">{d.items_count} {d.items_count === 1 ? 'item' : 'items'}</dd>
                      </div>
                    )}
                  </dl>

                  <span
                    className={cn(
                      'mt-4 flex items-center justify-center h-11 rounded-full text-sm font-semibold',
                      restricted ? 'bg-[#E5E7EB] text-[#6B7280]' : 'bg-[#16803C] text-white',
                    )}
                  >
                    {reviewing
                      ? 'Being reviewed by another rider'
                      : restricted
                        ? 'Accepted by another rider'
                        : d.reviewing_by_me
                          ? 'Continue reviewing'
                          : `View ${isBooking ? 'Booking' : 'Delivery'} Offer`}
                  </span>
                  <p className="mt-2 text-xs text-[#9CA3AF]">{formatDateTime(d.created_at)}</p>
                </CardShell>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
