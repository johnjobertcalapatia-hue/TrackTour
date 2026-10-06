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
import RatingSheet from '@/features/tourist/components/RatingSheet'
import {
  Navigation,
  Star,
  Phone,
  XCircle,
  Clock,
  CheckCircle2,
  Car,
  User,
  ArrowLeft,
  Smartphone,
  ShieldCheck,
  Loader2,
  Share2,
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
  ride_pin: string | null
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

const STATUS_STEPS = [
  { key: 'assigned', label: 'Assigned', icon: UserCheck },
  { key: 'arriving', label: 'Arriving', icon: Navigation },
  { key: 'in_progress', label: 'In Progress', icon: Car },
  { key: 'completed', label: 'Completed', icon: CheckCircle2 },
]

function UserCheck(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <polyline points="16 11 18 13 22 9" />
    </svg>
  )
}

const STATUS_INDEX: Record<string, number> = {
  searching: -1,
  assigned: 0,
  arriving: 1,
  driver_arrived: 1,
  in_progress: 2,
  completed: 3,
  cancelled: -1,
}

const STATUS_LABEL: Record<RideStatus, string> = {
  searching: 'Finding a Driver',
  arriving: 'Driver Arriving',
  driver_arrived: 'Driver Arrived',
  in_progress: 'Trip In Progress',
  completed: 'Trip Completed',
  cancelled: 'Trip Cancelled',
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
  const currentStep = STATUS_INDEX[displayStatus] ?? -1
  const progress = Math.max(0, (currentStep / (STATUS_STEPS.length - 1)) * 100)
  const isActiveNow = !['completed', 'cancelled'].includes(displayStatus)
  const showVerify = displayStatus === 'driver_arrived' && trip.rider

  const tripPoints: [number, number][] =
    routeQuery.data && routeQuery.data.polyline.length >= 2 && pickupCoords && destCoords
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
  const showRateButton = displayStatus === 'completed' && !trip.is_rated

  return (
    <div className="h-screen flex flex-col bg-white">
      {/* ───────────── Live map ───────────── */}
      <div className="flex-1 relative min-h-0">
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

        {/* Back */}
        <button
          onClick={() => navigate(-1)}
          aria-label="Back to transport"
          className="absolute top-4 left-4 z-[1000] p-3 bg-white/95 backdrop-blur border border-[#E5E9E7] rounded-xl text-[#17201B] hover:text-[#087F3F] hover:border-[#087F3F]/40 transition-all shadow-lg"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        {/* Status badge */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] flex flex-col items-center gap-2">
          <div
            className={cn(
              'px-4 py-2 bg-white/95 backdrop-blur border rounded-xl shadow-lg flex items-center gap-2',
              displayStatus === 'cancelled'
                ? 'border-red-200 text-red-600'
                : displayStatus === 'completed'
                  ? 'border-[#087F3F]/20 text-[#087F3F]'
                  : 'border-[#087F3F]/20 text-[#17201B]'
            )}
          >
            {isActiveNow && <span className="w-2 h-2 bg-[#087F3F] rounded-full animate-pulse" />}
            <span className="text-sm font-medium">{STATUS_LABEL[displayStatus]}</span>
          </div>
          {liveStatus && (
            <div className={cn('px-3 py-1 rounded-lg border shadow-md flex items-center gap-1.5 text-xs font-medium', liveStatus.className)}>
              {liveStatus.pulse && <span className={cn('w-1.5 h-1.5 rounded-full animate-pulse', liveStatus.dot)} />}
              {liveStatus.text}
            </div>
          )}
        </div>
      </div>

      {/* ───────────── Bottom sheet ───────────── */}
      <div className="bg-white border-t border-[#E5E9E7] max-h-[45vh] overflow-y-auto shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5">
          {/* Status stepper */}
          {displayStatus !== 'cancelled' && (
            <div className="flex items-center justify-between mb-5 relative">
              <div className="absolute top-4 left-0 right-0 h-0.5 bg-[#E5E9E7]" />
              <div
                className="absolute top-4 left-0 h-0.5 bg-[#087F3F] transition-all duration-500"
                style={{ width: `${progress}%` }}
              />
              {STATUS_STEPS.map((step, index) => {
                const Icon = step.icon
                const isCompleted = index <= currentStep
                return (
                  <div key={step.key} className="relative flex flex-col items-center z-10">
                    <div
                      className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center transition-all',
                        isCompleted ? 'bg-[#087F3F] text-white shadow-lg shadow-[#087F3F]/25' : 'bg-[#F3F4F6] text-[#9CA3AF]'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <span className={cn('text-[10px] mt-1', isCompleted ? 'text-[#087F3F] font-medium' : 'text-[#9CA3AF]')}>
                      {step.label}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Searching for a driver */}
          {displayStatus === 'searching' && (
            <div className="mb-5 flex items-start gap-3 bg-[#E9F7EF] border border-[#087F3F]/20 rounded-xl p-4">
              <Loader2 className="w-5 h-5 text-[#087F3F] shrink-0 animate-spin" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-[#087F3F]">Finding a nearby driver…</p>
                <p className="text-xs text-[#68736D] mt-1">
                  {trip.vehicle_type} • {formatCurrency(trip.fare)} • {trip.payment_method}
                </p>
              </div>
            </div>
          )}

          {/* Driver verification callout */}
          {showVerify && (
            <div className="mb-5 flex items-start gap-3 bg-[#E9F7EF] border border-[#087F3F]/30 rounded-xl p-4">
              <ShieldCheck className="w-5 h-5 text-[#087F3F] shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-[#087F3F]">Verify before boarding</p>
                <p className="text-xs text-[#68736D] mt-1">
                  Driver: {trip.rider?.name} • Plate: {trip.rider?.plate_number || '—'}
                </p>
                <p className="text-2xl font-bold tracking-[0.2em] text-[#17201B] mt-2">
                  {trip.ride_pin || '— — — —'}
                </p>
                <p className="text-[11px] text-[#9CA3AF] mt-1">
                  Share this PIN with your driver before boarding.
                </p>
              </div>
            </div>
          )}

          {/* Pickup & destination */}
          <div className="flex items-center gap-3 mb-5">
            <div className="flex flex-col items-center gap-1">
              <div className="w-3 h-3 bg-[#D97706] rounded-full" />
              <div className="w-0.5 h-6 bg-[#E5E9E7]" />
              <div className="w-3 h-3 bg-[#DC2626] rounded-full" />
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <p className="text-[10px] text-[#68736D] uppercase tracking-wider">Pickup</p>
                <p className="text-sm text-[#17201B]">{trip.pickup_address || 'Current location'}</p>
              </div>
              <div>
                <p className="text-[10px] text-[#68736D] uppercase tracking-wider">Destination</p>
                <p className="text-sm text-[#17201B]">{trip.destination_address}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
            {/* Driver card */}
            {trip.rider && (
              <div className="bg-white rounded-xl border border-[#E5E9E7] p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-[#E9F7EF] border border-[#087F3F]/20 shrink-0">
                    {trip.rider.photo ? (
                      <img src={trip.rider.photo} alt={trip.rider.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[#087F3F]">
                        <User className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#17201B] truncate">{trip.rider.name}</p>
                    <p className="text-xs text-[#68736D]">
                      {trip.rider.rating != null ? `★ ${trip.rider.rating.toFixed(1)}` : 'New driver'}
                    </p>
                    <p className="text-xs text-[#68736D] capitalize">
                      {trip.rider.vehicle_type} • {trip.rider.plate_number || '—'}
                    </p>
                  </div>
                  {trip.rider.contact_number && (
                    <a
                      href={`tel:${trip.rider.contact_number}`}
                      aria-label={`Call ${trip.rider.name}`}
                      className="p-2.5 bg-[#E9F7EF] border border-[#087F3F]/20 rounded-xl text-[#087F3F] hover:bg-[#087F3F] hover:text-white transition-all"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Fare / ETA */}
            <div className="bg-white rounded-xl border border-[#E5E9E7] p-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[#68736D]">Distance</span>
                  <span className="text-[#17201B]">{Number(trip.distance_km).toFixed(1)} km</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#68736D]">Duration</span>
                  <span className="text-[#17201B]">{trip.duration_min} min</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#68736D]">ETA</span>
                  <span className="text-[#17201B]">{trip.eta_minutes ?? trip.duration_min} min</span>
                </div>
                <div className="flex justify-between text-base font-semibold pt-2 border-t border-[#E5E9E7]">
                  <span className="text-[#17201B]">Fare</span>
                  <span className="text-[#087F3F]">{formatCurrency(trip.fare)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-[#68736D] mb-5">
            <div className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>Booked: {formatDateTime(trip.created_at)}</span>
            </div>
            {trip.started_at && (
              <div className="flex items-center gap-1">
                <Navigation className="w-3 h-3" />
                <span>Started: {formatDateTime(trip.started_at)}</span>
              </div>
            )}
            {trip.completed_at && (
              <div className="flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-[#087F3F]" />
                <span>Completed: {formatDateTime(trip.completed_at)}</span>
              </div>
            )}
            {trip.cancellation_reason && (
              <div className="flex items-center gap-1">
                <XCircle className="w-3 h-3 text-red-500" />
                <span>Reason: {trip.cancellation_reason}</span>
              </div>
            )}
          </div>

          {/* Cancelled state */}
          {displayStatus === 'cancelled' && (
            <div className="mb-5 flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-700">Trip Cancelled</p>
                <p className="text-xs text-red-600/80 mt-1">
                  {trip.cancellation_reason
                    ? `Reason: ${trip.cancellation_reason}`
                    : 'No driver could be assigned.'}
                  {trip.cancellation_fee > 0 && ` • Fee: ${formatCurrency(trip.cancellation_fee)}`}
                </p>
              </div>
            </div>
          )}

          {/* Completed receipt */}
          {displayStatus === 'completed' && (
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

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            {canCancel && (
              <button
                onClick={() => setShowCancelModal(true)}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-red-50 border border-red-200 text-red-600 rounded-xl hover:bg-red-500 hover:text-white transition-all text-sm font-medium"
              >
                <XCircle className="w-4 h-4" />
                Cancel Ride
              </button>
            )}
            <button
              onClick={shareTrip}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#E9F7EF] border border-[#087F3F]/20 text-[#087F3F] rounded-xl hover:bg-[#087F3F] hover:text-white transition-all text-sm font-medium"
            >
              <Share2 className="w-4 h-4" />
              Share trip
            </button>
            <button
              onClick={() => setShowSafety(true)}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-white border border-[#E5E9E7] text-[#17201B] rounded-xl hover:border-[#087F3F]/40 transition-all text-sm font-medium"
            >
              <ShieldCheck className="w-4 h-4 text-[#087F3F]" />
              Safety
            </button>
            {showPayButton && (
              <button
                onClick={handlePayNow}
                disabled={isRedirecting}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#17201B] text-white rounded-xl hover:bg-black transition-all text-sm font-medium disabled:opacity-50"
              >
                <Smartphone className="w-4 h-4" />
                {isRedirecting
                  ? onlinePayMethod === 'card'
                    ? 'Redirecting to Card Checkout...'
                    : 'Redirecting to GCash...'
                  : onlinePayMethod === 'card'
                    ? 'Pay with Card'
                    : 'Pay with GCash'}
              </button>
            )}
            {displayStatus === 'completed' && trip.payment_method === 'maya' && trip.payment_status !== 'paid' && (
              <p className="text-[10px] text-[#9CA3AF] px-1">
                Maya checkout is not available yet for ride settlement — contact support to complete payment.
              </p>
            )}
            {showPayButton && showRateButton && <span className="px-1 hidden sm:block" />}
            {showRateButton && (
              <button
                onClick={() => setShowRatingModal(true)}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#087F3F] text-white rounded-xl hover:bg-[#056B35] transition-all text-sm font-medium"
              >
                <Star className="w-4 h-4" />
                Rate Trip
              </button>
            )}
            {displayStatus === 'cancelled' && (
              <Link
                to="/tourist/transport"
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-[#087F3F] text-white rounded-xl hover:bg-[#056B35] transition-all text-sm font-medium"
              >
                <Car className="w-4 h-4" />
                Book another ride
              </Link>
            )}
            {displayStatus === 'in_progress' && trip.payment_method !== 'cash' && (
              <p className="text-[10px] text-[#9CA3AF] px-1">Payment will be settled after the trip.</p>
            )}
          </div>
        </div>
      </div>

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

      {/* Rating modal */}
      <RatingSheet
        open={showRatingModal}
        riderName={trip.rider?.name ?? null}
        allowedTags={trip.allowed_rating_tags ?? []}
        isSubmitting={rateMutation.isPending}
        onClose={() => setShowRatingModal(false)}
        onSubmit={(payload) => rateMutation.mutate(payload)}
      />

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