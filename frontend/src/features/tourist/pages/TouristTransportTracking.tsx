import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { createCheckoutSession } from '@/shared/services/payment'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime, cn } from '@/shared/utils'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useCustomerMapSocket } from '@/shared/hooks/useCustomerMapSocket'
import { useUserSocketNotifier } from '@/shared/hooks/useUserSocketNotifier'
import { useOsrmRoute } from '@/features/rider/hooks/useOsrmRoute'
import { riderMarkerIcon, pickupMarkerIcon, destinationMarkerIcon } from '@/shared/utils/map-markers'
import TripReceipt from '@/features/tourist/components/TripReceipt'
import {
  CompletedScreen, DriverCard, EtaBanner, InTripStats, RideProgress, SafetyActions, SearchingScreen, vehicleLabel,
} from '@/features/tourist/components/ride/RidePhases'
import {
  Navigation,
  Phone,
  Car,
  ArrowLeft,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react'

type RideStatus = 'searching' | 'arriving' | 'driver_arrived' | 'in_progress' | 'completed' | 'cancelled'

interface RiderInfo {
  id: number
  name: string
  rating: number | null
  contact_number: string | null
  photo: string | null
  vehicle_type: string
  vehicle_make: string | null
  vehicle_model: string | null
  plate_number: string | null
}

interface TrackingBlock {
  delivery_id: number
  room: string
  token: string
  role: string
}

interface RiderLocationBlock {
  latitude: number
  longitude: number
  recorded_at: string
}

interface RouteResult {
  polyline: [number, number][]
  distance_km: number
  duration_min: number
  source: 'osrm' | 'straight_line'
}

interface TripData {
  id: number
  order_number: string
  status: RideStatus
  pickup_address: string
  pickup_latitude?: number | null
  pickup_longitude?: number | null
  destination_address: string
  destination_latitude?: number | null
  destination_longitude?: number | null
  vehicle_type: string
  vehicle_color: string
  passenger_count: number
  payment_method: string
  payment_status: string
  paid_amount: number
  fare: number
  base_fare: number
  distance_fare: number
  service_fee: number
  estimate_fare: number
  distance_km: number
  duration_min: number
  eta_minutes: number | null
  booking_notes?: string | null
  rider: RiderInfo | null
  rider_location?: RiderLocationBlock | null
  tracking?: TrackingBlock | null
  is_rated: boolean
  rating: number | null
  review: string | null
  rating_tags: string[]
  allowed_rating_tags?: string[]
  created_at: string
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  cancellation_reason: string | null
  cancellation_fee: number
}

function num(v: number | string | null | undefined): number | null {
  const n = Number(v)
  return Number.isFinite(n) && n !== 0 ? n : null
}

const FALLBACK_CENTER: [number, number] = [12.8667, 121.45]

function CenterMap({ anchor }: { anchor: [number, number] }) {
  const map = useMap()
  const first = useRef(true)
  if (first.current) {
    first.current = false
    map.setView(anchor, 14)
  }
  return null
}

export default function TouristTransportTracking() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [showRatingModal, setShowRatingModal] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [showSafety, setShowSafety] = useState(false)
  const lastRiderId = useRef<number | null>(null)

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 3500)
  }, [])

  const { data: trip, isLoading, isError } = useQuery<TripData>({
    queryKey: ['tourist', 'trip-tracking', id],
    queryFn: () => get(`/tourist/transport/trip/${id}/status`),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      if (status && !['completed', 'cancelled'].includes(status)) {
        return 5000
      }
      return false
    },
  })

  // Driver/vehicle change: the rider block is authoritative; surface a
  // non-blocking notice when a different rider takes over the trip.
  const riderId = trip?.rider?.id ?? null
  useEffect(() => {
    if (riderId == null) return
    if (lastRiderId.current !== null && lastRiderId.current !== riderId) {
      showToast('Your driver was updated')
    }
    lastRiderId.current = riderId
  }, [riderId, showToast])

  // P11.5 — realtime order/delivery status events (rider acceptance flips the
  // screen without waiting for the poll). HTTP remains the source of truth.
  useUserSocketNotifier({
    onStatusEvent: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['tourist', 'trip-tracking', id] })
    }, [queryClient, id]),
  })

  const status = trip?.status ?? 'searching'
  const isActive = trip != null && !['completed', 'cancelled'].includes(trip.status)
  const canCancel = trip != null && ['searching', 'arriving', 'driver_arrived'].includes(trip.status)

  const pickupCoords: [number, number] | null =
    trip != null && num(trip.pickup_latitude) != null && num(trip.pickup_longitude) != null
      ? [num(trip.pickup_latitude)!, num(trip.pickup_longitude)!]
      : null

  const destCoords: [number, number] | null =
    trip != null && num(trip.destination_latitude) != null && num(trip.destination_longitude) != null
      ? [num(trip.destination_latitude)!, num(trip.destination_longitude)!]
      : null

  // Authorized live tracking (socket-primary, HTTP-poll `rider_location` fallback).
  const trackingDeliveryId =
    isActive && trip?.rider && trip.tracking?.delivery_id != null ? String(trip.tracking.delivery_id) : null
  const { connection, telemetry, tripCompleted, tripCancelled, isStale } = useCustomerMapSocket({
    deliveryId: trackingDeliveryId,
    token: trip?.tracking?.token ?? null,
    enabled: !!trackingDeliveryId,
  })

  const isLiveStopped = tripCompleted || tripCancelled

  const riderFromPoll =
    trip?.rider_location && num(trip.rider_location.latitude) != null && num(trip.rider_location.longitude) != null
      ? [num(trip.rider_location.latitude)!, num(trip.rider_location.longitude)!] as [number, number]
      : null
  const riderFromSocket =
    telemetry && Number.isFinite(telemetry.lat) && Number.isFinite(telemetry.lng)
      ? [telemetry.lat, telemetry.lng] as [number, number]
      : null
  const riderPos = isLiveStopped ? null : riderFromSocket ?? riderFromPoll

  // Road-following OSRM route for the full trip (pickup → destination). Falls
  // back to a straight dashed line server-side when OSRM is unavailable.
  const routeQuery = useQuery<RouteResult>({
    queryKey: ['transport-route', pickupCoords, destCoords],
    queryFn: () =>
      post('/tourist/transport/route', {
        pickup_lat: pickupCoords![0],
        pickup_lng: pickupCoords![1],
        destination_lat: destCoords![0],
        destination_lng: destCoords![1],
      }),
    enabled: Boolean(pickupCoords && destCoords),
  })

  // Live rider→target segment, road-following and debounced (200 m moves only),
  // mirroring the rider's own map. Target = pickup while arriving/arrived,
  // destination once the trip is in progress.
  const liveTarget = riderPos && status === 'in_progress' ? destCoords : pickupCoords
  const liveWaypoints: [number, number][] | null =
    riderPos && liveTarget && (status === 'arriving' || status === 'driver_arrived' || status === 'in_progress')
      ? [riderPos, liveTarget]
      : null
  const liveRouteResult = useOsrmRoute(liveWaypoints, Boolean(liveWaypoints))
  const liveRoute = liveRouteResult.points

  const cancelMutation = useMutation({
    mutationFn: () => post(`/tourist/transport/trip/${id}/cancel`, { reason: cancelReason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tourist', 'trip-tracking', id] })
      setShowCancelModal(false)
      setCancelReason('')
    },
    onError: () => {
      setShowCancelModal(false)
      showToast('Ride already started — contact support')
    },
  })

  const rateMutation = useMutation({
    mutationFn: (payload: { rating: number; review?: string; tags: string[] }) =>
      post(`/tourist/transport/trip/${id}/rate`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tourist', 'trip-tracking', id] })
      setShowRatingModal(false)
    },
    onError: () => {
      showToast('Could not submit rating — please try again.')
    },
  })

  // Accessibility: Escape closes whichever trip modal is open.
  useEffect(() => {
    if (!showCancelModal && !showSafety && !showRatingModal) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (showCancelModal) setShowCancelModal(false)
      if (showSafety) setShowSafety(false)
      if (showRatingModal) setShowRatingModal(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showCancelModal, showSafety, showRatingModal])

  const handlePayNow = async () => {
    try {
      setIsRedirecting(true)
      const data = await createCheckoutSession('order', Number(id), trip?.payment_method === 'card' ? 'card' : 'gcash')
      if (data?.checkout_url) {
        window.location.href = data.checkout_url
      }
    } catch {
      showToast('Payment initialization failed. Please try again.')
      setIsRedirecting(false)
    }
  }

  const shareTrip = async () => {
    const url = window.location.href
    const text = `Track my TrackTour ride ${trip?.order_number ?? ''}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'TrackTour Ride', text, url })
      } else {
        await navigator.clipboard.writeText(url)
        showToast('Trip link copied')
      }
    } catch {
      // share dismissed by the user
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen">
        <DashboardSkeleton />
      </div>
    )
  }

  if (isError || !trip) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Car className="w-16 h-16 text-[#9CA3AF] mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-[#17201B] mb-2">Trip not found</h2>
          <p className="text-[#68736D] mb-6">Unable to load trip details.</p>
          <button
            onClick={() => navigate('/tourist/transport')}
            className="px-6 py-3 bg-[#087F3F] text-white rounded-xl hover:bg-[#056B35] transition-colors font-medium"
          >
            Back to Transport
          </button>
        </div>
      </div>
    )
  }

  const displayStatus: RideStatus = tripCancelled ? 'cancelled' : tripCompleted ? 'completed' : trip.status

  const tripPoints: [number, number][] =
    Array.isArray(routeQuery.data?.polyline) && routeQuery.data.polyline.length >= 2 && pickupCoords && destCoords
      ? routeQuery.data.polyline
      : pickupCoords && destCoords
        ? [pickupCoords, destCoords]
        : []

  const tripRouteSolid = routeQuery.data?.source === 'osrm'

  const liveStatus = (() => {
    if (trackingDeliveryId == null) return null
    if (tripCancelled) return { text: 'Tracking ended', className: 'bg-red-50 text-red-600 border-red-200', dot: 'bg-red-500', pulse: false }
    if (tripCompleted) return { text: 'Trip completed', className: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]', dot: 'bg-[#9CA3AF]', pulse: false }
    if (connection === 'closed') return { text: 'Tracking unavailable', className: 'bg-red-50 text-red-600 border-red-200', dot: 'bg-red-500', pulse: false }
    if (connection === 'connected' && !isStale) return { text: 'Live', className: 'bg-[#E9F7EF] text-[#087F3F] border-[#087F3F]/20', dot: 'bg-[#087F3F]', pulse: true }
    if (connection === 'connected') return { text: 'Waiting for signal…', className: 'bg-amber-50 text-[#D97706] border-amber-200', dot: 'bg-[#D97706]', pulse: true }
    if (connection === 'reconnecting') return { text: 'Reconnecting…', className: 'bg-amber-50 text-[#D97706] border-amber-200', dot: 'bg-[#D97706]', pulse: true }
    return { text: 'Connecting…', className: 'bg-[#F3F4F6] text-[#6B7280] border-[#E5E7EB]', dot: 'bg-[#9CA3AF]', pulse: true }
  })()

  const mapAnchor: [number, number] = riderPos ?? pickupCoords ?? destCoords ?? FALLBACK_CENTER

  const onlinePayMethod = trip?.payment_method === 'card' ? 'card' : trip?.payment_method === 'gcash' ? 'gcash' : null
  const showPayButton =
    displayStatus === 'completed' && onlinePayMethod != null && trip.payment_status !== 'paid'

  // Live ETA / distance from the road route to the current target (pickup
  // while arriving, destination on the trip); the booked figures otherwise.
  const etaMinutes = liveRouteResult.durationMin != null
    ? Math.max(1, Math.round(liveRouteResult.durationMin))
    : (trip.eta_minutes ?? null)
  const remainingKm = liveRouteResult.distanceKm ?? (displayStatus === 'in_progress' ? trip.distance_km : null)
  const isPaid = trip.payment_status === 'paid'
  const payMethodName = trip.payment_method === 'gcash' ? 'GCash' : trip.payment_method === 'card' ? 'card' : 'cash'
  const paymentLabel = isPaid
    ? `Paid via ${payMethodName}`
    : trip.payment_method === 'cash' ? 'Pay your driver in cash' : `Payment due via ${payMethodName}`
  const onTheMove = displayStatus === 'arriving' || displayStatus === 'driver_arrived' || displayStatus === 'in_progress'

  return (
    <div className="min-h-[100dvh] bg-[#fff]">
      {displayStatus === 'searching' ? (
        /* ───────────── Phase 2: finding your driver ───────────── */
        <SearchingScreen
          since={trip.created_at}
          vehicleType={trip.vehicle_type}
          onCancel={() => setShowCancelModal(true)}
          cancelling={cancelMutation.isPending}
          onBack={() => navigate('/tourist/transport')}
        />
      ) : displayStatus === 'completed' ? (
        /* ───────────── Phase 5: completed, payment & review ───────────── */
        <div className="relative">
          <button
            type="button"
            onClick={() => navigate('/tourist/transport')}
            aria-label="Back to transport"
            className="absolute left-4 top-4 z-10 rounded-full bg-[#F3F4F6] p-2.5 text-[#17201B] hover:bg-[#E5E7EB]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <CompletedScreen
            fare={trip.fare}
            paymentLabel={paymentLabel}
            paid={isPaid || trip.payment_method === 'cash'}
            onPay={showPayButton ? handlePayNow : undefined}
            paying={isRedirecting}
            driverName={trip.rider?.name ?? null}
            alreadyRated={trip.is_rated}
            rating={trip.rating}
            allowedTags={trip.allowed_rating_tags ?? []}
            onSubmitReview={(payload) => rateMutation.mutate(payload)}
            submitting={rateMutation.isPending}
            receipt={(
              <TripReceipt
                orderNumber={trip.order_number}
                completedLabel={trip.completed_at ? formatDateTime(trip.completed_at) : ''}
                distanceKm={trip.distance_km}
                baseFare={trip.base_fare}
                distanceFare={trip.distance_fare}
                serviceFee={trip.service_fee}
                total={trip.fare}
                estimateFare={trip.estimate_fare}
                paymentMethod={trip.payment_method}
                paymentStatus={trip.payment_status}
                paidAmount={trip.paid_amount}
              />
            )}
          />
        </div>
      ) : (
        /* ───────────── Phases 3–4: driver on the way / in trip ───────────── */
        <div className="tourist-map-page -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 flex flex-col">
          <div className="relative min-h-0 flex-1">
        <MapContainer
          center={mapAnchor}
          zoom={14}
          minZoom={2}
          className="w-full h-full"
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <CenterMap anchor={mapAnchor} />
          {pickupCoords && (
            <Marker position={pickupCoords} icon={pickupMarkerIcon}>
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-[#17201B]">Pickup</p>
                  <p className="text-[#68736D]">{trip.pickup_address || 'Pickup point'}</p>
                </div>
              </Popup>
            </Marker>
          )}
          {destCoords && (
            <Marker position={destCoords} icon={destinationMarkerIcon}>
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-[#17201B]">Destination</p>
                  <p className="text-[#68736D]">{trip.destination_address}</p>
                </div>
              </Popup>
            </Marker>
          )}
          {tripPoints.length >= 2 && (
            <Polyline
              positions={tripPoints}
              pathOptions={{
                color: tripRouteSolid ? '#087F3F' : '#9CA3AF',
                weight: 5,
                opacity: 0.9,
                dashArray: tripRouteSolid ? undefined : '6 8',
              }}
            />
          )}
          {liveRoute.length >= 2 && riderPos && (
            <Polyline
              positions={liveRoute}
              pathOptions={{ color: '#087F3F', weight: 5, opacity: 0.9, dashArray: '1 8' }}
            />
          )}
          {riderPos && (
            <Marker position={riderPos} icon={riderMarkerIcon}>
              <Popup>
                <div className="text-sm">
                  <p className="font-semibold text-[#17201B]">Your rider</p>
                  <p className="text-[#68736D]">{trip.rider?.name ?? 'Rider on the way'}</p>
                </div>
              </Popup>
            </Marker>
          )}
        </MapContainer>

            <div className="pointer-events-none absolute inset-x-0 top-0 z-[1000] flex items-start gap-3 p-4">
              <button
                type="button"
                onClick={() => navigate('/tourist/transport')}
                aria-label="Back to transport"
                className="pointer-events-auto shrink-0 rounded-full bg-[#fff] p-3 text-[#17201B] shadow-lg hover:text-[#087F3F]"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              {onTheMove && (
                <div className="min-w-0 flex-1">
                  <EtaBanner status={displayStatus as 'arriving' | 'driver_arrived' | 'in_progress'} minutes={etaMinutes} />
                  {liveStatus && (
                    <span className={cn('pointer-events-auto mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium shadow', liveStatus.className)}>
                      {liveStatus.pulse && <span className={cn('h-1.5 w-1.5 animate-pulse rounded-full', liveStatus.dot)} />}
                      {liveStatus.text}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="relative z-[1001] -mt-5 max-h-[52dvh] overflow-y-auto rounded-t-[28px] bg-[#fff] px-5 pb-6 pt-3 shadow-[0_-10px_30px_rgba(23,32,27,0.12)]">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[#D7DED9]" aria-hidden="true" />
            <div className="mx-auto max-w-xl space-y-4">
              {displayStatus === 'cancelled' ? (
                <div className="space-y-4 text-center">
                  <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-left">
                    <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
                    <div>
                      <p className="text-sm font-semibold text-red-700">Ride cancelled</p>
                      <p className="mt-1 text-xs text-red-600/80">
                        {trip.cancellation_reason ? `Reason: ${trip.cancellation_reason}` : 'No driver could be assigned.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/tourist/transport')}
                    className="h-12 w-full rounded-full bg-[#087F3F] text-base font-bold text-white hover:bg-[#056B35]"
                  >
                    Book another ride
                  </button>
                </div>
              ) : (
                <>
                  {displayStatus === 'in_progress' && <InTripStats minutes={etaMinutes} km={remainingKm} />}

                  {trip.rider && (
                    <DriverCard driver={trip.rider} />
                  )}

                  {displayStatus !== 'in_progress' && <RideProgress status={displayStatus} />}

                  <div className="space-y-2 rounded-2xl border border-[#E5E9E7] p-3 text-sm">
                    <p className="flex items-start gap-2">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#087F3F]" aria-hidden="true" />
                      <span className="min-w-0"><span className="block text-xs text-[#56615B]">Pickup</span><span className="block truncate font-medium text-[#17201B]">{trip.pickup_address || 'Pickup point'}</span></span>
                    </p>
                    <p className="flex items-start gap-2">
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#DC2626]" aria-hidden="true" />
                      <span className="min-w-0"><span className="block text-xs text-[#56615B]">Drop-off</span><span className="block truncate font-medium text-[#17201B]">{trip.destination_address}</span></span>
                    </p>
                    <p className="flex items-center justify-between border-t border-[#EEF1EF] pt-2">
                      <span className="text-xs text-[#56615B]">{vehicleLabel(trip.vehicle_type)} · {payMethodName === 'cash' ? 'Cash' : payMethodName === 'GCash' ? 'GCash' : 'Card'}</span>
                      <span className="font-bold text-[#17201B]">{formatCurrency(trip.fare)}</span>
                    </p>
                  </div>

                  <SafetyActions showSos={displayStatus === 'in_progress'} onSos={() => setShowSafety(true)} onShare={shareTrip} />

                  {canCancel && (
                    <button
                      type="button"
                      onClick={() => setShowCancelModal(true)}
                      className="w-full text-center text-sm font-semibold text-[#B91C1C] hover:underline"
                    >
                      Cancel ride
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Cancel modal */}
      {showCancelModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-ride-title"
        >
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <h3 id="cancel-ride-title" className="text-lg font-semibold text-[#17201B] mb-2">Cancel Ride</h3>
            <p className="text-sm text-[#68736D] mb-4">Are you sure you want to cancel this ride? A cancellation fee may apply.</p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation (optional)"
              className="w-full px-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-[#17201B] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-red-500/30 text-sm resize-none mb-4"
              rows={3}
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-2.5 bg-[#F3F4F6] border border-[#E5E9E7] text-[#17201B] rounded-xl hover:text-[#087F3F] transition-all font-medium"
              >
                Keep Ride
              </button>
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="flex-1 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-all font-medium disabled:opacity-50"
              >
                {cancelMutation.isPending ? 'Cancelling...' : 'Confirm Cancel'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safety modal */}
      {showSafety && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="safety-title"
        >
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-5 h-5 text-[#087F3F]" />
              <h3 id="safety-title" className="text-lg font-semibold text-[#17201B]">Safety</h3>
            </div>
            <p className="text-sm text-[#68736D] mb-5">Emergency contacts and ride resources.</p>

            <div className="space-y-2">
              <a
                href="tel:911"
                className="w-full flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-red-600 text-sm font-medium hover:bg-red-100 transition"
              >
                <AlertTriangle className="w-4 h-4" /> Emergency — call 911
              </a>
              {trip.rider?.contact_number && (
                <a
                  href={`tel:${trip.rider.contact_number}`}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-[#17201B] text-sm font-medium hover:border-[#087F3F]/40 transition"
                >
                  <Phone className="w-4 h-4 text-[#087F3F]" /> Call your driver
                </a>
              )}
              <Link
                to="/tourist/messages"
                onClick={() => setShowSafety(false)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-[#17201B] text-sm font-medium hover:border-[#087F3F]/40 transition"
              >
                <Navigation className="w-4 h-4 text-[#087F3F]" /> Report a problem
              </Link>
            </div>

            <button
              onClick={() => setShowSafety(false)}
              className="mt-5 w-full py-2.5 bg-[#F3F4F6] border border-[#E5E9E7] text-[#17201B] rounded-xl hover:text-[#087F3F] transition-all font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[2000] px-4 py-2 bg-[#17201B] text-white text-sm rounded-xl shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  )
}