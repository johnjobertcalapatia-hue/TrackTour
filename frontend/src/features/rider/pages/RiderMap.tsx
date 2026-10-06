import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { Navigation, MapPin, Truck, CheckCircle, Radio, DollarSign } from 'lucide-react'
import { useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import { useOsrmRoute } from '@/features/rider/hooks/useOsrmRoute'
import { resolvePickupRoute } from '@/features/rider/pickup-route'
import { riderMarkerIcon as motorcycleIcon, pickupMarkerIcon, destinationMarkerIcon } from '@/shared/utils/map-markers'

const pickupIcon = pickupMarkerIcon
const deliveryDestIcon = destinationMarkerIcon

interface RiderLocation {
  latitude: number
  longitude: number
}

const stopNumberIcon = (n: number) =>
  L.divIcon({
    className: 'custom-pickup-marker',
    html: `
      <div style="
        width: 30px;
        height: 30px;
        background: #D97706;
        border: 2px solid #ffffff;
        border-radius: 50%;
        box-shadow: 0 3px 10px rgba(217, 119, 6, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 13px;
        font-weight: 800;
      ">${n}</div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  })

function formatEta(distanceKm: number | null, durationMin: number | null): string {
  if (distanceKm == null && durationMin == null) return ''
  const parts: string[] = []
  if (durationMin != null) parts.push(`~${Math.max(1, Math.round(durationMin))} min`)
  if (distanceKm != null) parts.push(`${distanceKm.toFixed(1)} km`)
  return parts.join(' · ')
}

interface Delivery {
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
  created_at: string
}

interface LocationData {
  rider: RiderLocation
  deliveries: Delivery[]
}

function RecenterMap({ center }: { center: [number, number] }) {
  const map = useMap()
  const lastRef = useRef<[number, number] | null>(null)

  useEffect(() => {
    const handler = () => {
      const [lat, lng] = center
      if (!lat || !lng || lat === 0 && lng === 0) return
      lastRef.current = [lat, lng]
      map.setView(center, 16, { animate: true })
    }
    window.addEventListener('rider-go-online', handler)
    return () => window.removeEventListener('rider-go-online', handler)
  }, [center, map])

  useEffect(() => {
    const [lat, lng] = center
    if (lat === 0 && lng === 0) return
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return

    const last = lastRef.current
    if (last) {
      const dLat = lat - last[0]
      const dLng = lng - last[1]
      const distMeters = Math.sqrt(dLat * dLat + dLng * dLng) * 111320
      if (distMeters < 150) return
    }

    lastRef.current = [lat, lng]
    map.setView(center, map.getZoom(), { animate: false })
  }, [center, map])

  return null
}

export default function RiderMap() {
  const navigate = useNavigate()
  const user = useAuthStore((state) => state.user)
  const [riderPosition, setRiderPosition] = useState<[number, number]>([12.8667, 121.4500])
  const watchIdRef = useRef<number | null>(null)
  const [earningsOpen, setEarningsOpen] = useState(false)

  const {
    setRiderPosition: setTripRiderPosition,
    activeDelivery,
    tripState,
    pickupStopsData,
  } = useRiderActiveTrip()

  const { data, isLoading } = useQuery({
    queryKey: ['rider-map-location'],
    queryFn: async () => {
      const result = await get<LocationData>('/rider/map/location')
      return result ?? ({} as LocationData)
    },
    refetchInterval: 10000,
    retry: false,
    staleTime: 5000,
    enabled: !!user?.id,
  })

  const { data: earningsData } = useQuery({
    queryKey: ['rider-earnings'],
    queryFn: async () => {
      const result = await get<{ summary: { total_earnings: number } }>('/rider/earnings')
      return result
    },
    enabled: !!user?.id && earningsOpen,
  })

  const locationMutation = useMutation({
    mutationFn: (location: RiderLocation) => post('/rider/map/location', location),
  })

  const lastLocationSent = useRef(0)
  const locationInFlight = useRef(false)

  const sendLocation = useCallback((lat: number, lng: number) => {
    // Read directly from the store so we catch the null user immediately,
    // even before React re-renders after logout clears user from the store.
    if (!useAuthStore.getState().user?.id) return
    // Update the local + shared position on every GPS tick for a smooth map,
    // but throttle the backend POST so the PHP proximity endpoint is never
    // hammered faster than it can respond (avoids ERR_INSUFFICIENT_RESOURCES)
    // and no two location requests are ever in flight at the same time.
    setRiderPosition([lat, lng])
    setTripRiderPosition(lat, lng)
    if (locationInFlight.current) return
    const now = Date.now()
    if (now - lastLocationSent.current < 3000) return
    lastLocationSent.current = now
    locationInFlight.current = true
    locationMutation.mutate(
      { latitude: lat, longitude: lng },
      {
        onSettled: () => {
          locationInFlight.current = false
        },
      }
    )
  }, [locationMutation, setTripRiderPosition])

  useEffect(() => {
    if (!user?.id) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      return
    }

    if (!navigator.geolocation) return

    navigator.geolocation.getCurrentPosition(
      (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
      undefined,
      { enableHighAccuracy: true }
    )

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => sendLocation(pos.coords.latitude, pos.coords.longitude),
      undefined,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [sendLocation, user?.id])

  const deliveries = data?.deliveries ?? []
  const isRideHailing = user?.current_service === 'transport'

  const isPickupLeg = tripState === 'EN_ROUTE_TO_PICKUP' || tripState === 'ARRIVED_AT_PICKUP'
  const isDropLeg = tripState === 'OUT_FOR_DELIVERY' || tripState === 'ARRIVED_AT_DROP'
  const hasRouteLeg = !!activeDelivery && (isPickupLeg || isDropLeg)

  const purchaseStops = pickupStopsData?.stops ?? []
  const fullyCollected = pickupStopsData?.fully_collected ?? false
  const allPurchasesCollected = fullyCollected
  const pickupOrigin = pickupStopsData?.pickup_origin ?? null
  const dropoff = pickupStopsData?.dropoff ?? null

  // Group-checkout routing (see resolvePickupRoute): the rider navigates to the
  // NEXT unconsumed restaurant in drive order, not all of them at once. Only
  // after every restaurant's food is collected does the route switch to the
  // drop-off leg (last restaurant → tourist destination). Drop-off leg: the
  // LAST restaurant picked up (longest prep) → destination.
  const routeWaypoints = resolvePickupRoute({
    rider: riderPosition,
    isPickupLeg,
    isDropLeg,
    hasPickupStops: purchaseStops.length > 0,
    allCollected: allPurchasesCollected,
    stops: purchaseStops.map((stop) => ({
      sequence: stop.sequence,
      status: stop.status,
      latitude: stop.pickup_lat,
      longitude: stop.pickup_lng,
    })),
    finalPickup:
      pickupOrigin?.latitude != null && pickupOrigin?.longitude != null
        ? { latitude: pickupOrigin.latitude, longitude: pickupOrigin.longitude }
        : null,
    destination:
      dropoff?.latitude != null && dropoff?.longitude != null
        ? { latitude: dropoff.latitude, longitude: dropoff.longitude }
        : null,
    fallbackPickup:
      activeDelivery?.pickup_lat != null && activeDelivery?.pickup_lng != null
        ? { latitude: activeDelivery.pickup_lat, longitude: activeDelivery.pickup_lng }
        : null,
    fallbackDestination:
      activeDelivery?.delivery_lat != null && activeDelivery?.delivery_lng != null
        ? { latitude: activeDelivery.delivery_lat, longitude: activeDelivery.delivery_lng }
        : null,
  })

  const osrmRoute = useOsrmRoute(hasRouteLeg ? routeWaypoints : null, hasRouteLeg)

  const routeEtaLabel = formatEta(osrmRoute.distanceKm, osrmRoute.durationMin)

  const polylinePoints: [number, number][] =
    osrmRoute.points.length >= 2
      ? osrmRoute.points
      : routeWaypoints.length >= 2
        ? routeWaypoints
        : []
      
  const tripStatus = (() => {
    if (!activeDelivery) {
      return {
        icon: Radio,
        title: isRideHailing ? 'Searching for Bookings' : 'Searching for Orders',
        meta: '',
        tone: 'text-[#17202A]',
        accent: 'text-emerald-600',
      }
    }
    if (tripState === 'EN_ROUTE_TO_PICKUP') {
      const nextStop = purchaseStops.find((p) => p.status !== 'collected') ?? null
      const parts: string[] = []
      if (purchaseStops.length && nextStop) {
        parts.push(`Stop ${nextStop.sequence}/${purchaseStops.length}`)
      } else if (activeDelivery.business_name) {
        parts.push(activeDelivery.business_name)
      }
      if (routeEtaLabel) parts.push(routeEtaLabel)
      return {
        icon: Navigation,
        title: 'Going to Pickup',
        meta: parts.length ? ` · ${parts.join(' · ')}` : '',
        tone: 'text-[#17202A]',
        accent: 'text-emerald-600',
      }
    }
    if (tripState === 'ARRIVED_AT_PICKUP') {
      return {
        icon: MapPin,
        title: 'Arrived at Pickup',
        meta: ' · Confirm Pickup',
        tone: 'text-emerald-700',
        accent: 'text-emerald-600',
      }
    }
    if (tripState === 'OUT_FOR_DELIVERY') {
      const rawLabel = dropoff?.address || activeDelivery.delivery_address || ''
      const dropLabel = rawLabel ? (rawLabel.length > 28 ? `${rawLabel.slice(0, 27)}…` : rawLabel) : ''
      const parts: string[] = []
      if (dropLabel) parts.push(`→ ${dropLabel}`)
      if (routeEtaLabel) parts.push(routeEtaLabel)
      return {
        icon: Truck,
        title: 'Delivering',
        meta: parts.length ? ` ${parts.join(' · ')}` : '',
        tone: 'text-[#17202A]',
        accent: 'text-emerald-600',
      }
    }
    if (tripState === 'ARRIVED_AT_DROP') {
      return {
        icon: MapPin,
        title: 'Arrived',
        meta: ' · Confirm Drop',
        tone: 'text-emerald-700',
        accent: 'text-emerald-600',
      }
    }
    return {
      icon: CheckCircle,
      title: 'Delivery Completed',
      meta: ' · Available',
      tone: 'text-emerald-700',
      accent: 'text-emerald-600',
    }
  })()

  if (isLoading) return <DashboardSkeleton />

  return (
    <div className="fixed inset-0 z-0">
      <MapContainer
        center={riderPosition}
        zoom={14}
        minZoom={2}
        className="h-full w-full"
        zoomControl={false}
      >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <RecenterMap center={riderPosition} />

          <Marker position={riderPosition} icon={motorcycleIcon}>
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">Your Location</p>
                <p className="text-gray-500">{Number(riderPosition[0]).toFixed(5)}, {Number(riderPosition[1]).toFixed(5)}</p>
              </div>
            </Popup>
          </Marker>

          {deliveries.map((d) => (
            <div key={d.id}>
              {d.pickup_lat && d.pickup_lng && (
                <Marker position={[d.pickup_lat, d.pickup_lng]} icon={pickupIcon}>
                  <Popup>
                    <div className="text-sm">
                      <p className="font-semibold text-emerald-600">{d.business_name || `Pickup - Order #${d.order_id}`}</p>
                      <p>{d.pickup_address}</p>
                    </div>
                  </Popup>
                </Marker>
              )}
              {d.delivery_lat && d.delivery_lng && (
                <Marker position={[d.delivery_lat, d.delivery_lng]} icon={deliveryDestIcon}>
                  <Popup>
                    <div className="text-sm">
                      <p className="font-semibold text-red-600">{d.customer_name || `Delivery - Order #${d.order_id}`}</p>
                      <p>{d.delivery_address}</p>
                    </div>
                  </Popup>
                </Marker>
              )}
            </div>
          ))}

          {purchaseStops.map((stop) =>
            stop.pickup_lat != null && stop.pickup_lng != null ? (
              <Marker
                key={`stop-${stop.id}`}
                position={[stop.pickup_lat, stop.pickup_lng]}
                icon={stopNumberIcon(stop.sequence)}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-semibold text-emerald-600">#{stop.sequence} {stop.business_name}</p>
                    <p className="text-gray-500">{stop.pickup_address}</p>
                    {stop.preparation_time != null && (
                      <p className="text-gray-500">~{stop.preparation_time} min prep</p>
                    )}
                  </div>
                </Popup>
              </Marker>
            ) : null
          )}

          {polylinePoints.length >= 2 && (
            <Polyline
              positions={polylinePoints}
              color="#DFFF00"
              weight={6}
              opacity={1}
            />
          )}
        </MapContainer>

        <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-[1000] max-w-[calc(100%-5rem)] rounded-full border border-[#E4E9E6] bg-white/95 pl-1 sm:pl-1.5 pr-3 sm:pr-4 py-1 sm:py-1.5 shadow-lg backdrop-blur">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className={`w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full bg-[#F5FBF7] border border-[#E4E9E6] flex items-center justify-center ${tripStatus.accent}`}>
              <tripStatus.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </span>
            <p className="text-[10px] sm:text-xs font-bold text-[#17202A] whitespace-nowrap">
              {tripStatus.title}
              {tripStatus.meta && <span className={`font-semibold ${tripStatus.accent}`}>{tripStatus.meta}</span>}
            </p>
          </div>
        </div>
        <div className="absolute top-[52px] left-3 sm:top-[60px] sm:left-4 z-[1000]">
          <button
            type="button"
            onClick={() => setEarningsOpen((o) => !o)}
            className="flex items-center gap-1.5 sm:gap-2 rounded-full border border-[#E4E9E6] bg-white/95 pl-1 sm:pl-1.5 pr-3 sm:pr-4 py-1 sm:py-1.5 shadow-lg backdrop-blur transition hover:bg-white"
          >
            <span className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full bg-[#E9F7EF] border border-[#D7E8DB] flex items-center justify-center">
              <DollarSign className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#087F3F]" />
            </span>
            <p className="text-[10px] sm:text-xs font-bold text-[#17202A] whitespace-nowrap">
              Earnings
            </p>
          </button>
          {earningsOpen && (
            <div className="mt-2 w-44 rounded-xl border border-white/40 bg-white/30 backdrop-blur-xl p-2 shadow-xl space-y-1.5">
              <button
                type="button"
                onClick={() => navigate('/rider/earnings')}
                className="w-full flex items-center gap-2 rounded-lg bg-[#087F3F]/15 border border-[#087F3F]/20 backdrop-blur-md p-2 transition hover:bg-[#087F3F]/25"
              >
                <span className="w-6 h-6 shrink-0 rounded-full bg-[#087F3F]/20 flex items-center justify-center">
                  <DollarSign className="w-3 h-3 text-[#087F3F]" />
                </span>
                <div>
                  <p className="text-[8px] font-medium text-[#087F3F]/80 uppercase tracking-wider">Earnings</p>
                  <p className="text-xs font-bold text-[#087F3F]">₱{(earningsData?.summary?.total_earnings ?? 0).toFixed(2)}</p>
                </div>
              </button>
              </div>
          )}
        </div>

    </div>
  )
}
