import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Car, Clock, Flag, MapPin, Phone, ReceiptText, Star, User, Wallet } from 'lucide-react'
import { get } from '@/shared/services/api'
import { ONLINE_PAYMENT_NAME, paidViaName } from '@/shared/services/payment'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useBackOr } from '@/shared/hooks/use-back-or'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { vehicleLabel } from '@/features/tourist/components/ride/RidePhases'
import type { CancellationPenalty } from '@/features/tourist/components/ride/CancellationPenaltyCard'

/** The parts of GET /tourist/transport/trip/{id}/status this page shows. */
interface TripDetails {
  id: number
  order_number: string
  status: string
  pickup_address: string | null
  pickup_latitude: number | null
  pickup_longitude: number | null
  destination_address: string | null
  destination_latitude: number | null
  destination_longitude: number | null
  vehicle_type: string
  passenger_count: number
  payment_method: string
  payment_status: string
  paid_amount: number
  paid_via?: string | null
  fare: number
  ride_fare: number
  base_fare: number
  distance_fare: number
  service_fee: number
  additional_charges?: { id: number; type: string; label: string; amount: number; duration_seconds: number }[]
  distance_km: number
  duration_min: number
  booking_notes?: string | null
  rider: {
    name: string | null
    rating: number | null
    contact_number: string | null
    vehicle_type: string | null
    vehicle_make: string | null
    vehicle_model: string | null
    plate_number: string | null
  } | null
  created_at: string | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  cancellation_penalty?: CancellationPenalty | null
  destination_change?: { original?: { address?: string | null }; new?: { name?: string | null; address?: string | null }; verified_km?: number | null } | null
  trip_times?: {
    booked_at: string | null
    accepted_at: string | null
    arrived_pickup_at: string | null
    picked_up_at: string | null
    arrived_destination_at: string | null
    completed_at: string | null
  }
  payment_reference?: string | null
  rating?: number | null
}

const coords = (lat: number | null, lng: number | null) =>
  lat != null && lng != null ? `${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}` : 'Not recorded'

/** "1 h 5 min", "12 min", "45 s"; null when either time is missing. */
export function durationBetween(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!from || !to) return null
  const s = Math.round((Date.parse(to) - Date.parse(from)) / 1000)
  if (!Number.isFinite(s) || s < 0) return null
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

const dateOnly = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-PH', { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' }) : '—'

const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed', cancelled: 'Cancelled', searching: 'Finding a driver', arriving: 'Driver on the way',
  driver_arrived: 'Driver arrived', in_progress: 'In progress',
}

/**
 * A past (or current) ride from My Activities › Travels (2026-11-18): where
 * from and to (place names and coordinates — no map), how the fare was
 * worked out, how it was paid, and the driver's details.
 */
export default function TouristTripDetails() {
  const { id } = useParams<{ id: string }>()
  const goBack = useBackOr('/tourist/activities?view=travels')
  const { data: trip, isLoading, isError } = useQuery<TripDetails>({
    queryKey: ['tourist', 'trip-details', id],
    queryFn: () => get(`/tourist/transport/trip/${id}/status`),
    enabled: !!id,
  })

  if (isLoading) return <DashboardSkeleton />
  if (isError || !trip) {
    return (
      <div className="mx-auto lg:mx-0 max-w-3xl rounded-2xl border border-[#E5E9E7] bg-white p-10 text-center">
        <p className="text-lg font-bold text-[#17201B]">Trip not found</p>
        <Link to="/tourist/activities?view=travels" className="mt-4 inline-flex h-10 items-center rounded-full bg-[#087F3F] px-5 text-sm font-semibold text-white">My travels</Link>
      </div>
    )
  }

  const cancelled = trip.status === 'cancelled'
  const charges = trip.additional_charges ?? []
  const breakdownSum = Number(trip.base_fare || 0) + Number(trip.distance_fare || 0) + Number(trip.service_fee || 0)
  // The booked breakdown is the estimate; a destination change can move the final ride fare.
  const adjustment = Math.round((Number(trip.ride_fare || 0) - breakdownSum) * 100) / 100
  const paid = trip.payment_status === 'paid'
  const methodName = trip.payment_method === 'cash' ? 'Cash' : trip.payment_method === 'card' ? 'Card'
    : paid ? paidViaName(trip.paid_via) : `${ONLINE_PAYMENT_NAME} (online)`
  const vehicle = trip.rider ? [trip.rider.vehicle_make, trip.rider.vehicle_model].filter(Boolean).join(' ') : ''
  const t = trip.trip_times ?? { booked_at: trip.created_at, accepted_at: null, arrived_pickup_at: null, picked_up_at: trip.started_at, arrived_destination_at: null, completed_at: trip.completed_at }
  const time = (iso: string | null | undefined) => (iso ? formatDateTime(iso) : '—')
  const travelTime = durationBetween(t.picked_up_at, t.arrived_destination_at ?? t.completed_at)
  const pickupWait = durationBetween(t.arrived_pickup_at, t.picked_up_at)
  const totalTime = durationBetween(t.booked_at ?? trip.created_at, cancelled ? trip.cancelled_at : t.completed_at)

  return (
    <main aria-label="Trip details" className="mx-auto lg:mx-0 w-full max-w-3xl space-y-4">
      <button type="button" onClick={goBack} className="inline-flex items-center gap-2 text-sm font-semibold text-[#087F3F] hover:text-[#056B35]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
      </button>

      <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[#E5E9E7] bg-white p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-500/10"><Car className="h-5 w-5 text-blue-500" aria-hidden="true" /></span>
          <div>
            <h1 className="text-xl font-bold text-[#17201B]">Trip #{trip.order_number}</h1>
            <p className="text-xs text-[#6B7280]">Booked {trip.created_at ? formatDateTime(trip.created_at) : '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={trip.status} />
          <span className="sr-only">{STATUS_LABEL[trip.status] ?? trip.status}</span>
        </div>
      </header>

      {/* Route: place names and coordinates (no map). */}
      <section aria-label="Route" className="rounded-2xl border border-[#E5E9E7] bg-white p-5">
        <h2 className="mb-3 text-sm font-bold text-[#17201B]">Route</h2>
        <dl className="space-y-4">
          <div className="flex gap-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#087F3F]" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Pickup point</dt>
              <dd className="font-semibold text-[#17201B]">{trip.pickup_address || 'Pickup point'}</dd>
              <dd className="font-mono text-xs text-[#56615B]" data-testid="pickup-coordinates">{coords(trip.pickup_latitude, trip.pickup_longitude)}</dd>
            </div>
          </div>
          <div className="flex gap-3">
            <Flag className="mt-0.5 h-5 w-5 shrink-0 text-[#D97706]" aria-hidden="true" />
            <div className="min-w-0">
              <dt className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Destination</dt>
              <dd className="font-semibold text-[#17201B]">{trip.destination_address || 'Destination'}</dd>
              <dd className="font-mono text-xs text-[#56615B]" data-testid="destination-coordinates">{coords(trip.destination_latitude, trip.destination_longitude)}</dd>
              {trip.destination_change?.original?.address && (
                <dd className="mt-1 text-xs text-[#6B7280]">Changed during the ride. Originally: {trip.destination_change.original.address}</dd>
              )}
            </div>
          </div>
        </dl>
        <p className="mt-4 border-t border-[#EEF1EF] pt-3 text-xs text-[#56615B]">
          {vehicleLabel(trip.vehicle_type)} · {trip.passenger_count} passenger{trip.passenger_count === 1 ? '' : 's'} · {Number(trip.distance_km).toFixed(1)} km · about {trip.duration_min} min
        </p>
      </section>

      {/* Fare calculation */}
      <section aria-label="Fare" className="rounded-2xl border border-[#E5E9E7] bg-white p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#17201B]"><ReceiptText className="h-4 w-4 text-[#087F3F]" aria-hidden="true" /> Fare calculation</h2>
        <dl className="space-y-1.5 text-sm">
          <Row label="Base fare" value={formatCurrency(trip.base_fare)} />
          <Row label={`Distance (${Number(trip.distance_km).toFixed(1)} km)`} value={formatCurrency(trip.distance_fare)} />
          {Number(trip.service_fee) > 0 && <Row label="Service fee" value={formatCurrency(trip.service_fee)} />}
          {adjustment !== 0 && <Row label={trip.destination_change ? 'Fare change (new destination)' : 'Fare adjustment'} value={`${adjustment > 0 ? '+' : '−'}${formatCurrency(Math.abs(adjustment))}`} />}
          {charges.map((c) => <Row key={c.id} label={c.label} value={formatCurrency(c.amount)} />)}
          <div className="flex items-center justify-between border-t border-[#EEF1EF] pt-2">
            <dt className="font-bold text-[#17201B]">Total fare</dt>
            <dd className="text-lg font-bold text-[#17201B]" data-testid="trip-total">{formatCurrency(trip.fare)}</dd>
          </div>
        </dl>
        {cancelled && <p className="mt-2 text-xs text-[#6B7280]">This ride was cancelled, so the fare was not charged.</p>}
        {trip.cancellation_penalty && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-[#7C4A03]">
            Cancellation fee: {formatCurrency(trip.cancellation_penalty.amount)} ({trip.cancellation_penalty.status === 'owed' ? 'owed' : trip.cancellation_penalty.status === 'collected' ? 'paid' : trip.cancellation_penalty.status.replace('_', ' ')}).
          </p>
        )}
      </section>

      {/* Payment */}
      <section aria-label="Payment" className="rounded-2xl border border-[#E5E9E7] bg-white p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#17201B]"><Wallet className="h-4 w-4 text-[#087F3F]" aria-hidden="true" /> Payment</h2>
        <dl className="space-y-1.5 text-sm">
          <Row label="Payment method" value={methodName} />
          <Row label="Status" value={cancelled && !paid ? 'Not charged' : paid ? 'Paid' : 'Not paid yet'} />
          {paid && <Row label="Amount paid" value={formatCurrency(trip.paid_amount || trip.fare)} />}
        </dl>
      </section>

      {/* Driver */}
      <section aria-label="Driver" className="rounded-2xl border border-[#E5E9E7] bg-white p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#17201B]"><User className="h-4 w-4 text-[#087F3F]" aria-hidden="true" /> Driver</h2>
        {trip.rider ? (
          <dl className="space-y-1.5 text-sm">
            <Row label="Name" value={trip.rider.name ?? '—'} />
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[#6B7280]">Mobile number</dt>
              <dd>
                {trip.rider.contact_number
                  ? <a href={`tel:${trip.rider.contact_number}`} className="inline-flex items-center gap-1 font-semibold text-[#087F3F] hover:underline"><Phone className="h-3.5 w-3.5" aria-hidden="true" /> {trip.rider.contact_number}</a>
                  : <span className="text-[#6B7280]">Not on file</span>}
              </dd>
            </div>
            <Row label="Vehicle" value={[vehicleLabel(trip.rider.vehicle_type ?? trip.vehicle_type), vehicle].filter(Boolean).join(' · ')} />
            <Row label="Plate number" value={trip.rider.plate_number ?? '—'} />
            {trip.rider.rating != null && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-[#6B7280]">Rating</dt>
                <dd className="inline-flex items-center gap-1 font-semibold text-[#17201B]"><Star className="h-3.5 w-3.5 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" /> {Number(trip.rider.rating).toFixed(1)}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-[#6B7280]">No driver was assigned to this ride.</p>
        )}
      </section>

      {/* Trip information: date, each step's time, durations, distance, references. */}
      <section aria-label="Trip information" className="rounded-2xl border border-[#E5E9E7] bg-white p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#17201B]"><Clock className="h-4 w-4 text-[#087F3F]" aria-hidden="true" /> Trip information</h2>
        <dl className="space-y-1.5 text-sm">
          <Row label="Travel date" value={dateOnly(t.picked_up_at ?? t.booked_at ?? trip.created_at)} />
          <Row label="Booked" value={time(t.booked_at ?? trip.created_at)} />
          {t.accepted_at && <Row label="Driver accepted" value={time(t.accepted_at)} />}
          {t.arrived_pickup_at && <Row label="Driver arrived at pickup" value={time(t.arrived_pickup_at)} />}
          {t.picked_up_at && <Row label="Picked up" value={time(t.picked_up_at)} />}
          {t.arrived_destination_at && <Row label="Arrived at destination" value={time(t.arrived_destination_at)} />}
          {t.completed_at && !cancelled && <Row label="Completed" value={time(t.completed_at)} />}
          {trip.cancelled_at && <Row label="Cancelled" value={time(trip.cancelled_at)} />}
          {trip.cancellation_reason && <Row label="Cancellation reason" value={trip.cancellation_reason.replace(/_/g, ' ')} />}
        </dl>

        <dl className="mt-3 space-y-1.5 border-t border-[#EEF1EF] pt-3 text-sm">
          {travelTime && <Row label="Travel time (pickup to destination)" value={travelTime} />}
          {pickupWait && <Row label="Waiting at pickup" value={pickupWait} />}
          {totalTime && <Row label={cancelled ? 'Time until cancelled' : 'Total trip time (booking to completion)'} value={totalTime} />}
          <Row label="Route distance (booked)" value={`${Number(trip.distance_km).toFixed(1)} km`} />
          {trip.destination_change?.verified_km != null && <Row label="GPS-verified distance" value={`${Number(trip.destination_change.verified_km).toFixed(1)} km`} />}
          <Row label="Estimated travel time (booked)" value={`about ${trip.duration_min} min`} />
        </dl>

        <dl className="mt-3 space-y-1.5 border-t border-[#EEF1EF] pt-3 text-sm">
          <Row label="Trip number" value={trip.order_number} />
          {trip.payment_reference && <Row label="Payment reference" value={trip.payment_reference} />}
          <Row label="Vehicle type" value={vehicleLabel(trip.vehicle_type)} />
          <Row label="Passengers" value={String(trip.passenger_count)} />
          {trip.rating != null && <Row label="Your rating" value={`${trip.rating} / 5`} />}
          {trip.booking_notes && <Row label="Your note" value={trip.booking_notes} />}
        </dl>
      </section>
    </main>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-[#6B7280]">{label}</dt>
      <dd className="text-right font-medium text-[#17201B]">{value}</dd>
    </div>
  )
}
