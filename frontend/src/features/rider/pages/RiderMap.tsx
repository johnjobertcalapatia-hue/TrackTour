import { Fragment, memo, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get, patch, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { Navigation, MapPin, Play, Truck, CheckCircle, Radio, Package, Car, LocateFixed } from 'lucide-react'
import { RiderMapFollow } from '@/features/rider/components/RiderMapFollow'
import { MapZoomOutLimit } from '@/features/rider/components/MapZoomOutLimit'
import { RiderMapStyleSwitcher } from '@/features/rider/components/RiderMapStyleSwitcher'
import { RiderMapViewToggle } from '@/features/rider/components/RiderMapViewToggle'
import { RiderMapCompass } from '@/features/rider/components/RiderMapCompass'
import { RiderNavPuck } from '@/features/rider/components/RiderNavPuck'
import { NavigationCamera } from '@/shared/components/map/NavigationCamera'
import { requestCompassPermission, useNavigationBearing } from '@/features/tourist/hooks/use-navigation-bearing'
import { routeProgress } from '@/features/tourist/utils/route-progress'
import {
  NAV_TILT_DEG,
  NAV_TILT_SIZE_FACTOR,
  navPerspectiveFor,
  navPuckScreenOffset,
  planeOffsetForScreenY,
  planePointForScreen,
  type RiderMapViewMode,
} from '@/features/rider/navigation-view'
import { MAP_STYLES, loadMapStyle, saveMapStyle, type MapStyleId } from '@/shared/utils/map-tiles'

const RIDER_MAP_STYLE_KEY = 'rider_map_style'
import { useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import { useOsrmRoute } from '@/features/rider/hooks/useOsrmRoute'
import { useAboveRiderStatus } from '@/features/rider/hooks/useAboveRiderStatus'
import { resolvePickupRoute } from '@/features/rider/pickup-route'
import { riderNavigationMarkerIcon, destinationMarkerIcon } from '@/shared/utils/map-markers'
import { businessLogoIcon, pinIcon } from '@/shared/utils/pin-icon'
import { toAssetUrl } from '@/shared/utils'
import { RiderHeadingController } from '@/shared/utils/rider-heading'
import {
  INVALID_GPS_MESSAGE, RIDER_LOCATION_INTERVAL_MS, isUsableGpsFix, locationSentRecently, locationSyncWarning, markLocationSent,
} from '@/features/rider/gps'
import { RunDiagnosticsLink } from '@/features/rider/components/RiderDiagnosticsSheet'

const deliveryDestIcon = destinationMarkerIcon

/**
 * Restaurant pins: the same business marker as the tourist map (round photo
 * pin with the name beside it; the plain green pin when there is no photo).
 * In the navigation view they lie on the tilted map and stay turned to the
 * screen like the tourist map's pins.
 */
function restaurantIcon(photo: string | null | undefined, label: string): L.DivIcon {
  return photo ? businessLogoIcon(toAssetUrl(photo), label) : pinIcon(label)
}
const WORLD_BOUNDS: L.LatLngBoundsExpression = [
  [-85.05112878, -180],
  [85.05112878, 180],
]

interface RiderLocation {
  latitude: number
  longitude: number
  heading?: number
  speed?: number
  accuracy?: number
}

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
  pickup_lat: number | string | null
  pickup_lng: number | string | null
  delivery_address: string
  delivery_lat: number | string | null
  delivery_lng: number | string | null
  business_name?: string | null
  business_logo?: string | null
  customer_name?: string | null
  created_at: string
}

interface LocationData {
  rider: RiderLocation
  deliveries: Delivery[]
}

function AnimatedRiderMarker({
  position,
  icon,
  eventHandlers,
  children,
}: {
  position: [number, number]
  icon: L.DivIcon
  eventHandlers: L.LeafletEventHandlerFnMap
  children: ReactNode
}) {
  const markerRef = useRef<L.Marker | null>(null)
  const initialPositionRef = useRef(position)

  useEffect(() => {
    const marker = markerRef.current
    if (!marker) return

    const from = marker.getLatLng()
    const startedAt = performance.now()
    const duration = 650
    let frameId = 0

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = progress * progress * (3 - 2 * progress)
      marker.setLatLng([
        from.lat + (position[0] - from.lat) * eased,
        from.lng + (position[1] - from.lng) * eased,
      ])
      if (progress < 1) frameId = requestAnimationFrame(animate)
    }

    frameId = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frameId)
  }, [position])

  return (
    <Marker
      ref={markerRef}
      position={initialPositionRef.current}
      icon={icon}
      eventHandlers={eventHandlers}
    >
      {children}
    </Marker>
  )
}

const DeliveryEndpointMarker = memo(function DeliveryEndpointMarker({
  latitude,
  longitude,
  icon,
  title,
  address,
  tone,
}: {
  latitude: number | string
  longitude: number | string
  icon: L.DivIcon
  title: string
  address: string
  tone: 'pickup' | 'destination'
}) {
  const position = useMemo(
    () => L.latLng(Number(latitude), Number(longitude)),
    [latitude, longitude],
  )
  const titleClass = tone === 'pickup' ? 'text-emerald-600' : 'text-red-600'

  return (
    <Marker position={position} icon={icon}>
      <Popup>
        <div className="text-sm">
          <p className={`font-semibold ${titleClass}`}>{title}</p>
          <p>{address}</p>
        </div>
      </Popup>
    </Marker>
  )
})

const PickupStopMapMarker = memo(function PickupStopMapMarker({
  sequence,
  totalStops,
  latitude,
  longitude,
  businessName,
  businessLogo,
  address,
  preparationTime,
}: {
  sequence: number
  totalStops: number
  latitude: number
  longitude: number
  businessName: string | null
  businessLogo: string | null | undefined
  address: string | null
  preparationTime: number | null
}) {
  const position = useMemo<[number, number]>(() => [latitude, longitude], [latitude, longitude])
  // With several restaurants the label keeps the pickup order ("#1 …").
  const label = totalStops > 1 ? `#${sequence} ${businessName ?? 'Restaurant'}` : (businessName ?? 'Restaurant')
  const icon = useMemo(() => restaurantIcon(businessLogo, label), [businessLogo, label])

  return (
    <Marker position={position} icon={icon}>
      <Popup>
        <div className="text-sm">
          <p className="font-semibold text-emerald-600">#{sequence} {businessName}</p>
          <p className="text-gray-500">{address}</p>
          {preparationTime != null && (
            <p className="text-gray-500">~{preparationTime} min prep</p>
          )}
        </div>
      </Popup>
    </Marker>
  )
})

export default function RiderMap() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  // Placeholder until a real location exists; never focused on (see hasFix).
  const [riderPosition, setRiderPosition] = useState<[number, number]>([12.8667, 121.4500])
  // Where the position came from: none (placeholder), server (last saved fix),
  // gps (this device). The map only focuses once it is server or gps.
  const [locationSource, setLocationSource] = useState<'none' | 'server' | 'gps'>('none')
  const [following, setFollowing] = useState(true)
  const [focusSignal, setFocusSignal] = useState(0)
  const [gpsError, setGpsError] = useState<string | null>(null)
  // Overview (flat bird's-eye of the route) vs Navigation (tilted, heading-up
  // driving view). Stage C of the rider trip flow.
  const [viewMode, setViewMode] = useState<RiderMapViewMode>('overview')
  const [overviewSignal, setOverviewSignal] = useState(0)
  // GPS course over ground (only trusted while moving).
  const [course, setCourse] = useState<number | null>(null)
  const mapAreaRef = useRef<HTMLDivElement | null>(null)
  // Map buttons sit 8 px above the Rider Status panel (same as their own gap).
  const [mapControlsRef, controlsBottom] = useAboveRiderStatus()
  const controlsStyle = controlsBottom != null ? { bottom: controlsBottom } : undefined
  // Map type (Standard / Dark / Satellite), remembered on this device.
  const [mapStyle, setMapStyleState] = useState<MapStyleId>(() => loadMapStyle(RIDER_MAP_STYLE_KEY))
  const setMapStyle = useCallback((style: MapStyleId) => {
    setMapStyleState(style)
    saveMapStyle(RIDER_MAP_STYLE_KEY, style)
  }, [])
  const tiles = MAP_STYLES[mapStyle]
  const watchIdRef = useRef<number | null>(null)
  const headingControllerRef = useRef<RiderHeadingController | null>(null)
  if (!headingControllerRef.current) {
    headingControllerRef.current = new RiderHeadingController()
  }
  const headingController = headingControllerRef.current
  const [earningsOpen, setEarningsOpen] = useState(false)

  const {
    setRiderPosition: setTripRiderPosition,
    activeDelivery,
    tripState,
    pickupStopsData,
    reportLocationResult,
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

  // Shown when the server refuses a fix the map is displaying (the trip
  // buttons judge the SAVED location, not the map's).
  const [locationSyncError, setLocationSyncError] = useState<string | null>(null)
  const locationMutation = useMutation({
    mutationFn: (location: RiderLocation) => post<{ reason?: string } | null>('/rider/map/location', location),
    onSuccess: (result, location) => {
      setLocationSyncError(locationSyncWarning(result?.reason, location.accuracy))
      reportLocationResult(result?.reason)
    },
  })
  // useMutation returns a new object every render; reading `mutate` through a
  // ref keeps sendLocation stable, so the GPS watch below is set up once
  // instead of being torn down and re-requested on every render.
  const sendLocationMutateRef = useRef(locationMutation.mutate)
  sendLocationMutateRef.current = locationMutation.mutate

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      patch(`/rider/deliveries/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rider-map-location'] }),
  })

  const getStatusActions = (delivery: Delivery) => {
    switch (delivery.status) {
      case 'assigned':
        return (
          <button
            type="button"
            onClick={() => statusMutation.mutate({ id: delivery.id, status: 'arrived_pickup' })}
            disabled={statusMutation.isPending}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
          >
            <Play className="w-4 h-4" /> Start Delivery
          </button>
        )
      case 'picked_up':
        return (
          <button
            type="button"
            onClick={() => statusMutation.mutate({ id: delivery.id, status: 'arrived_destination' })}
            disabled={statusMutation.isPending}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
          >
            <Truck className="w-4 h-4" /> Arrived at Destination
          </button>
        )
      case 'arrived_destination':
        return (
          <button
            type="button"
            onClick={() => statusMutation.mutate({ id: delivery.id, status: 'delivered' })}
            disabled={statusMutation.isPending}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
          >
            <CheckCircle className="w-4 h-4" /> Mark Delivered
          </button>
        )
      default:
        return null
    }
  }


  const lastLocationSent = useRef(0)
  const locationInFlight = useRef(false)
  // Last position put on screen: readings that moved less than a metre
  // (GPS jitter, or the same Wi-Fi / simulated point repeated) don't
  // re-render the whole map (navigation lag on a PC, 2026-11-12).
  const shownPositionRef = useRef<[number, number] | null>(null)

  const riderMarkerEvents = useMemo<L.LeafletEventHandlerFnMap>(() => ({
    add: (event) => {
      const marker = event.target as L.Marker
      headingController.attach(
        marker.getElement()?.querySelector<HTMLElement>('.rider-navigation-arrow') ?? null,
      )
    },
    remove: () => headingController.attach(null),
  }), [headingController])

  const sendLocation = useCallback((position: GeolocationPosition) => {
    // Read directly from the store so we catch the null user immediately,
    // even before React re-renders after logout clears user from the store.
    if (!useAuthStore.getState().user?.id) return
    // Update the local + shared position on every GPS tick for a smooth map,
    // but throttle the backend POST so the PHP proximity endpoint is never
    // hammered faster than it can respond (avoids ERR_INSUFFICIENT_RESOURCES)
    // and no two location requests are ever in flight at the same time.
    const { latitude, longitude, heading, speed, accuracy } = position.coords
    if (!isUsableGpsFix(latitude, longitude)) {
      setGpsError(INVALID_GPS_MESSAGE)
      return
    }
    headingController.update({
      latitude,
      longitude,
      heading,
      speed,
      accuracy,
      timestamp: position.timestamp,
    })
    const shown = shownPositionRef.current
    const movedM = shown
      ? Math.hypot((latitude - shown[0]) * 111_320, (longitude - shown[1]) * 111_320 * Math.cos((latitude * Math.PI) / 180))
      : Infinity
    if (movedM >= 1) {
      shownPositionRef.current = [latitude, longitude]
      setRiderPosition([latitude, longitude])
    }
    if (heading !== null && Number.isFinite(heading) && (speed ?? 0) > 0.5) setCourse(heading)
    setLocationSource('gps')
    setGpsError(null)
    setTripRiderPosition(latitude, longitude, accuracy, position.timestamp)
    if (locationInFlight.current) return
    const now = Date.now()
    // Every 5 s (decision 2026-11-11), on the clock shared with the heartbeat.
    if (now - lastLocationSent.current < RIDER_LOCATION_INTERVAL_MS - 250 || locationSentRecently(now)) return
    lastLocationSent.current = now
    markLocationSent(now)
    locationInFlight.current = true
    const location: RiderLocation = { latitude, longitude }
    if (heading !== null && Number.isFinite(heading)) location.heading = heading
    if (speed !== null && Number.isFinite(speed)) location.speed = speed
    if (accuracy !== null && Number.isFinite(accuracy)) location.accuracy = accuracy
    sendLocationMutateRef.current(
      location,
      {
        onSettled: () => {
          locationInFlight.current = false
        },
      }
    )
  }, [headingController, setTripRiderPosition])

  useEffect(() => {
    if (!user?.id) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      return
    }

    if (!navigator.geolocation) return

    const onGpsError = (err: GeolocationPositionError) => {
      setGpsError(
        err.code === err.PERMISSION_DENIED
          ? 'Location access is blocked. Allow location for this site so the map can follow you.'
          : 'Waiting for your GPS location…',
      )
    }

    navigator.geolocation.getCurrentPosition(
      sendLocation,
      onGpsError,
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    )

    watchIdRef.current = navigator.geolocation.watchPosition(
      sendLocation,
      onGpsError,
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [sendLocation, user?.id])

  useEffect(() => () => headingController.destroy(), [headingController])

  // Until this device reports GPS, start from the rider's last saved location
  // (server) instead of the placeholder town centre.
  const serverLat = data?.rider?.latitude != null ? Number(data.rider.latitude) : null
  const serverLng = data?.rider?.longitude != null ? Number(data.rider.longitude) : null
  useEffect(() => {
    if (locationSource !== 'none' || serverLat === null || serverLng === null) return
    if (!Number.isFinite(serverLat) || !Number.isFinite(serverLng) || (serverLat === 0 && serverLng === 0)) return
    setRiderPosition([serverLat, serverLng])
    setLocationSource('server')
  }, [locationSource, serverLat, serverLng])

  // Going online re-centres on the rider (DashboardLayout dispatches this).
  useEffect(() => {
    const onGoOnline = () => setFocusSignal((n) => n + 1)
    window.addEventListener('rider-go-online', onGoOnline)
    return () => window.removeEventListener('rider-go-online', onGoOnline)
  }, [])

  const deliveries = data?.deliveries ?? []
  const isRideHailing = user?.current_service === 'transport'

  const isPickupLeg = tripState === 'EN_ROUTE_TO_PICKUP' || tripState === 'ARRIVED_AT_PICKUP'
  const isDropLeg = tripState === 'OUT_FOR_DELIVERY' || tripState === 'ARRIVED_AT_DROP'
  // Route only from a real position (device GPS or last saved location),
  // never from the placeholder town centre.
  const hasRouteLeg = !!activeDelivery && (isPickupLeg || isDropLeg) && locationSource !== 'none'

  const purchaseStops = pickupStopsData?.stops ?? []
  const fullyCollected = pickupStopsData?.fully_collected ?? false
  const allRouteStopsCollected = fullyCollected
  const dropoff = pickupStopsData?.dropoff ?? null

  // Group-checkout routing (see resolvePickupRoute): the rider navigates to the
  // NEXT unconsumed restaurant in drive order, not all of them at once. Only
  // after every restaurant's food is collected does the route switch to the
  // drop-off leg (live rider position → tourist destination).
  const routeWaypoints = resolvePickupRoute({
    rider: riderPosition,
    isPickupLeg,
    isDropLeg,
    hasPickupStops: purchaseStops.length > 0,
    allCollected: allRouteStopsCollected,
    stops: purchaseStops.map((stop) => ({
      sequence: stop.sequence,
      status: stop.status,
      latitude: stop.pickup_lat,
      longitude: stop.pickup_lng,
    })),
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

  // After accepting an offer (and again when the drop-off leg starts), frame
  // the rider and the next target (restaurant, then tourist) once.
  const tripOverview = useMemo(
    () => (activeDelivery && hasRouteLeg && routeWaypoints.length >= 2
      ? { key: `${activeDelivery.id}:${isDropLeg ? 'drop' : 'pickup'}:${overviewSignal}`, points: routeWaypoints }
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeDelivery?.id, hasRouteLeg, isDropLeg, overviewSignal, routeWaypoints.length >= 2 ? routeWaypoints[routeWaypoints.length - 1]?.join(',') : ''],
  )

  const osrmRoute = useOsrmRoute(hasRouteLeg ? routeWaypoints : null, hasRouteLeg)

  const routeEtaLabel = formatEta(osrmRoute.distanceKm, osrmRoute.durationMin)

  const polylinePoints: [number, number][] =
    osrmRoute.points.length >= 2
      ? osrmRoute.points
      : routeWaypoints.length >= 2
        ? routeWaypoints
        : []

  // The route is "consumed" as the rider moves: draw only what's left, from
  // his snapped position on the road to the current target.
  const hasRealPosition = locationSource !== 'none'
  const progress = useMemo(
    () => (hasRealPosition && polylinePoints.length >= 2
      ? routeProgress(polylinePoints, { lat: riderPosition[0], lng: riderPosition[1] })
      : null),
    [hasRealPosition, polylinePoints, riderPosition],
  )
  const drawnRoute: [number, number][] = progress && progress.remaining.length >= 2 ? progress.remaining : polylinePoints

  const navActive = viewMode === 'navigation' && hasRealPosition
  const liveBearing = useNavigationBearing({
    active: navActive,
    location: hasRealPosition ? { lat: riderPosition[0], lng: riderPosition[1] } : null,
    course,
    route: drawnRoute.length >= 2 ? drawnRoute : null,
  })

  // Exploring the map while navigating (Google-Maps-like, 2026-11-09): drag
  // pans, pinch / wheel zoom, twist / right-drag rotates. The first pan or
  // twist enters free look: the camera stops following and the map keeps the
  // bearing the rider gave it (the compass shows where north is) until
  // "My location" brings it back to the rider.
  const [navFree, setNavFree] = useState(false)
  const [freeBearing, setFreeBearing] = useState(0)
  // Following, the map turns with the travel direction, or stays north-up
  // after a tap on the compass (tap again: back to heading-up).
  const [northUp, setNorthUp] = useState(false)
  // A gesture is running: the map turns with the fingers, without easing.
  const [navGesturing, setNavGesturing] = useState(false)
  useEffect(() => {
    if (!navActive) {
      setNavFree(false)
      setNavGesturing(false)
    }
  }, [navActive])
  const bearing = navActive && navFree ? freeBearing : navActive && northUp ? 0 : liveBearing
  const shownBearingRef = useRef(bearing)
  shownBearingRef.current = bearing
  const handleFreeLookChange = useCallback((free: boolean) => {
    // Exploring starts from the view the rider is looking at.
    if (free) setFreeBearing(shownBearingRef.current)
    setNavFree(free)
  }, [])
  const handleCompass = () => {
    if (navFree) setFreeBearing(0) // exploring: face north
    else setNorthUp((n) => !n) // following: north-up ↔ heading-up
  }
  // The perspective in use (deepened on large viewports, see navPerspectiveFor).
  const navPerspectiveRef = useRef(navPerspectiveFor(0))
  /** A point on the tilted map (client px) → its offset on the map plane. */
  const navScreenToPlanePoint = useCallback((p: { x: number; y: number }) => {
    const rect = mapAreaRef.current?.getBoundingClientRect()
    const cx = rect ? rect.left + rect.width / 2 : 0
    const cy = rect ? rect.top + rect.height / 2 : 0
    return planePointForScreen(p.x - cx, p.y - cy, NAV_TILT_DEG, navPerspectiveRef.current)
  }, [])

  // Tilted, rotated map plane: a square much larger than the screen so no
  // blank corner shows while it turns and tips back toward the horizon.
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 })
  const [puckScreenY, setPuckScreenY] = useState(0)
  useEffect(() => {
    const el = mapAreaRef.current
    if (!el) return
    const measure = () => {
      setAreaSize({ w: el.clientWidth, h: el.clientHeight })
      setPuckScreenY(navPuckScreenOffset(el).y)
    }
    measure()
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => {
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [navActive])
  const planeSize = Math.ceil(Math.hypot(areaSize.w, areaSize.h) * NAV_TILT_SIZE_FACTOR)
  const navPerspective = navPerspectiveFor(planeSize)
  navPerspectiveRef.current = navPerspective
  const navPlaneOffset = useMemo(
    () => ({ x: 0, y: Math.round(planeOffsetForScreenY(puckScreenY, NAV_TILT_DEG, navPerspective)) }),
    [puckScreenY, navPerspective],
  )

  const changeView = (mode: RiderMapViewMode) => {
    if (mode === 'navigation') {
      requestCompassPermission()
    } else {
      setOverviewSignal((n) => n + 1) // re-frame the whole route
    }
    setViewMode(mode)
  }

  // Collected restaurants disappear from the map (their route leg is done).
  const visibleStops = purchaseStops.filter((stop) => stop.status !== 'collected')
      
  // A ride booking speaks of a passenger, not food.
  const rideTrip = activeDelivery?.order_type === 'transport'

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
      if (rideTrip) {
        parts.push(activeDelivery.customer_name || 'Passenger')
      } else if (purchaseStops.length && nextStop) {
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
        meta: rideTrip ? ' · Passenger on board?' : ' · Confirm Pickup',
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
        icon: rideTrip ? Car : Truck,
        title: rideTrip ? 'On the Way' : 'Delivering',
        meta: parts.length ? ` ${parts.join(' · ')}` : '',
        tone: 'text-[#17202A]',
        accent: 'text-emerald-600',
      }
    }
    if (tripState === 'ARRIVED_AT_DROP') {
      return {
        icon: MapPin,
        title: 'Arrived',
        meta: rideTrip ? ' · Complete Ride' : ' · Confirm Drop',
        tone: 'text-emerald-700',
        accent: 'text-emerald-600',
      }
    }
    return {
      icon: CheckCircle,
      title: rideTrip ? 'Ride Completed' : 'Delivery Completed',
      meta: ' · Available',
      tone: 'text-emerald-700',
      accent: 'text-emerald-600',
    }
  })()


  if (isLoading) return <DashboardSkeleton />

  return (
    // Sized to the DYNAMIC viewport (100dvh): on phones `inset-0` alone spans
    // the area behind the browser bars, which put the map's centre (and so the
    // rider marker) below the middle of what the rider actually sees.
    // The map-type class lives on this wrapper: react-leaflet applies the
    // MapContainer className only once, at creation.
    <div
      ref={mapAreaRef}
      data-view-mode={navActive ? 'navigation' : 'overview'}
      className={`rider-map-area fixed top-0 left-0 w-full h-[100dvh] z-0 ${tiles.containerClass ?? ''}`}
      style={navActive ? { perspective: `${navPerspective}px` } : undefined}
    >
      {/* Rotator/tilter: in the navigation view the map becomes a large square,
          turned so the road ahead points up and tipped back like the ground. */}
      <div
        data-testid="rider-map-rotator"
        data-bearing={Math.round(navActive ? bearing : 0)}
        className={navActive && planeSize > 0
          ? `map-rotator map-rotator--nav${navGesturing ? ' map-rotator--gesture' : ''}`
          : 'map-rotator'}
        style={navActive && planeSize > 0
          ? ({
              width: planeSize,
              height: planeSize,
              transform: `translate(-50%, -50%) rotateX(${NAV_TILT_DEG}deg) rotate(${-bearing}deg)`,
              '--map-bearing': `${bearing}deg`,
            } as React.CSSProperties)
          : undefined}
      >
      <MapContainer
        center={riderPosition}
        zoom={12}
        // Zoom-out / pan limits: the whole Philippines (see MapZoomOutLimit).
        minZoom={5}
        className="h-full w-full"
        zoomControl={false}
      >
          <TileLayer
            // Navigation draws a much larger, tilted plane: load tiles when a
            // pan settles (not on every animation frame) and keep fewer
            // off-screen tiles. Leaflet reads these at creation, hence the key.
            key={`${tiles.id}-${navActive ? 'nav' : 'overview'}`}
            attribution={tiles.attribution}
            url={tiles.url}
            {...(tiles.subdomains ? { subdomains: tiles.subdomains } : {})}
            maxNativeZoom={tiles.maxNativeZoom}
            maxZoom={20}
            noWrap
            bounds={WORLD_BOUNDS}
            {...(navActive ? { updateWhenIdle: true, updateWhenZooming: false, keepBuffer: 1 } : {})}
          />
          <MapZoomOutLimit />
          {navActive ? (
            <NavigationCamera
              active
              location={{ lat: riderPosition[0], lng: riderPosition[1] }}
              bearing={bearing}
              screenOffset={navPlaneOffset}
              recenterSignal={focusSignal}
              freeLook={navFree}
              onFreeLookChange={handleFreeLookChange}
              onBearingChange={setFreeBearing}
              onGestureChange={setNavGesturing}
              screenToPlanePoint={navScreenToPlanePoint}
            />
          ) : (
            <RiderMapFollow
              center={riderPosition}
              hasFix={locationSource !== 'none'}
              following={following}
              focusSignal={focusSignal}
              onFollowChange={setFollowing}
              overview={tripOverview}
            />
          )}

          {/* Navigation draws the rider as a fixed screen puck; while exploring
              (free look) the rider is a marker on the map again. */}
          {(!navActive || navFree) && <AnimatedRiderMarker
            position={riderPosition}
            icon={riderNavigationMarkerIcon}
            eventHandlers={riderMarkerEvents}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">Your Location</p>
                <p className="text-gray-500">{Number(riderPosition[0]).toFixed(5)}, {Number(riderPosition[1]).toFixed(5)}</p>
              </div>
            </Popup>
          </AnimatedRiderMarker>}

          {deliveries.map((d) => (
            <Fragment key={d.id}>
              {d.pickup_lat != null && d.pickup_lng != null && purchaseStops.length === 0 && !isDropLeg && (
                <DeliveryEndpointMarker
                  key={`delivery-${d.id}-pickup`}
                  latitude={d.pickup_lat}
                  longitude={d.pickup_lng}
                  icon={restaurantIcon(d.business_logo, d.business_name || 'Restaurant')}
                  title={d.business_name || `Pickup - Order #${d.order_id}`}
                  address={d.pickup_address}
                  tone="pickup"
                />
              )}
              {d.delivery_lat != null && d.delivery_lng != null && (
                <DeliveryEndpointMarker
                  key={`delivery-${d.id}-dropoff`}
                  latitude={d.delivery_lat}
                  longitude={d.delivery_lng}
                  icon={deliveryDestIcon}
                  title={d.customer_name || `Delivery - Order #${d.order_id}`}
                  address={d.delivery_address}
                  tone="destination"
                />
              )}
            </Fragment>
          ))}

          {visibleStops.map((stop) =>
            stop.pickup_lat != null && stop.pickup_lng != null ? (
              <PickupStopMapMarker
                key={`stop-${stop.id}`}
                sequence={stop.sequence}
                totalStops={purchaseStops.length}
                latitude={stop.pickup_lat}
                longitude={stop.pickup_lng}
                businessName={stop.business_name}
                businessLogo={stop.business_logo}
                address={stop.pickup_address}
                preparationTime={stop.preparation_time}
              />
            ) : null
          )}

          {drawnRoute.length >= 2 && (
            <Polyline
              positions={drawnRoute}
              color="#DFFF00"
              weight={6}
              opacity={1}
            />
          )}
        </MapContainer>
      </div>

        {navActive && (
          <>
            {/* Soft horizon where the tilted map fades into the distance. */}
            <div aria-hidden="true" className="nav-horizon pointer-events-none absolute inset-x-0 top-0 z-[400] h-[22%]" />
            {!navFree && <RiderNavPuck offsetY={puckScreenY} perspective={navPerspective} />}
          </>
        )}

        {/* Map controls, stacked: view buttons, then map type, then "My location". */}
        <div ref={mapControlsRef} style={controlsStyle} className="rider-map-controls-bottom absolute right-3 sm:right-4 z-[1000] flex flex-col items-center gap-2">
          {/* Overview / Navigation view. */}
          {/* Navigation: where north is; tap to face north (again: travel direction). */}
          {navActive && (
            <RiderMapCompass bearing={bearing} northUp={navFree ? Math.round(bearing) % 360 === 0 : northUp} onClick={handleCompass} />
          )}
          <RiderMapViewToggle value={viewMode} onChange={changeView} />
          {/* Map type: Standard / Dark / Satellite. */}
          <RiderMapStyleSwitcher value={mapStyle} onChange={setMapStyle} />

          {/* My location: re-centre on the rider and resume following. */}
          <button
            type="button"
            onClick={() => {
              setNavFree(false) // back from exploring the map
              setFocusSignal((n) => n + 1)
            }}
            aria-label="Center map on my location"
            // Pressed while the map follows the rider (navigation: unless exploring).
            aria-pressed={navActive ? !navFree : following}
            className={`w-11 h-11 rounded-full border shadow-md flex items-center justify-center backdrop-blur transition ${
              (navActive ? !navFree : following) ? 'bg-[#16803C] border-[#16803C] text-white' : 'bg-white/95 border-[#E4E9E6] text-[#16803C] hover:bg-white'
            }`}
          >
            <LocateFixed className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {locationSyncError && !(gpsError && locationSource !== 'gps') && (
          <div role="alert" data-testid="location-sync-warning" className="absolute left-1/2 -translate-x-1/2 top-16 z-[1000] max-w-[90%] rounded-xl bg-[#FEF3C7] border border-[#FCD34D] px-3 py-2 text-xs font-semibold text-[#92400E] shadow">
            {locationSyncError}
            <br />
            <RunDiagnosticsLink />
          </div>
        )}
        {gpsError && locationSource !== 'gps' && (
          <div role="status" className="absolute left-1/2 -translate-x-1/2 top-16 z-[1000] max-w-[90%] rounded-xl bg-[#FEF3C7] border border-[#FCD34D] px-3 py-2 text-xs font-semibold text-[#92400E] shadow">
            {gpsError}
          </div>
        )}

        <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-[1000] flex flex-col items-start gap-2 max-w-[calc(100%-5rem)]">
          {/* Trip status. During a trip it is also the quickest way back to the
              whole route: tapping it frames the rider and the next stop. */}
          {(() => {
            const pill = (
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className={`w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full bg-[#F5FBF7] border border-[#E4E9E6] flex items-center justify-center ${tripStatus.accent}`}>
                  <tripStatus.icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </span>
                <p className="text-[10px] sm:text-xs font-bold text-[#17202A] whitespace-nowrap">
                  {tripStatus.title}
                  {tripStatus.meta && <span className={`font-semibold ${tripStatus.accent}`}>{tripStatus.meta}</span>}
                </p>
              </div>
            )
            const shell = 'clay-menu-item rounded-full border bg-[#F8FAF6]/95 pl-1 sm:pl-1.5 pr-3 sm:pr-4 py-1 sm:py-1.5 backdrop-blur'
            return activeDelivery && hasRouteLeg ? (
              <button
                type="button"
                onClick={() => changeView('overview')}
                aria-label={`${tripStatus.title}${tripStatus.meta}. Show the whole route`}
                className={`${shell} text-left transition hover:bg-white`}
              >
                {pill}
              </button>
            ) : (
              <div className={shell}>{pill}</div>
            )
          })()}
          <button
            type="button"
            onClick={() => setEarningsOpen((o) => !o)}
            className="clay-menu-item flex items-center gap-1.5 sm:gap-2 rounded-full border bg-[#F8FAF6]/95 pl-1 sm:pl-1.5 pr-3 sm:pr-4 py-1 sm:py-1.5 backdrop-blur transition hover:bg-white"
          >
            <span className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full bg-[#E9F7EF] border border-[#D7E8DB] flex items-center justify-center">
              <span className="text-[13px] sm:text-sm font-extrabold leading-none text-[#087F3F]">₱</span>
            </span>
            <p className="text-[10px] sm:text-xs font-bold text-[#17202A] whitespace-nowrap">
              Earnings
            </p>
          </button>
          {earningsOpen && (
            <div className="clay-card w-44 border backdrop-blur-xl p-2 space-y-1.5">
              <button
                type="button"
                onClick={() => navigate('/rider/earnings')}
                className="w-full flex items-center gap-2 rounded-lg bg-[#087F3F]/15 border border-[#087F3F]/20 backdrop-blur-md p-2 transition hover:bg-[#087F3F]/25"
              >
                <span className="w-6 h-6 shrink-0 rounded-full bg-[#087F3F]/20 flex items-center justify-center">
                  <span className="text-[11px] font-extrabold leading-none text-[#087F3F]">₱</span>
                </span>
                <div>
                  <p className="text-[8px] font-medium text-[#087F3F]/80 uppercase tracking-wider">Earnings</p>
                  <p className="text-xs font-bold text-[#087F3F]">₱{(earningsData?.summary?.total_earnings ?? 0).toFixed(2)}</p>
                </div>
              </button>
            </div>
          )}
          <button
            type="button"
            // With a trip in progress, "Orders" opens its stage-by-stage status page.
            onClick={() => navigate(activeDelivery ? `/rider/deliveries/${activeDelivery.id}/status` : '/rider/deliveries/pending')}
            className="clay-menu-item flex items-center gap-1.5 sm:gap-2 rounded-full border bg-[#F8FAF6]/95 pl-1 sm:pl-1.5 pr-3 sm:pr-4 py-1 sm:py-1.5 backdrop-blur transition hover:bg-white"
          >
            <span className="w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full border bg-[#E9F7EF] border-[#D7E8DB] flex items-center justify-center">
              {isRideHailing
                ? <Car className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#087F3F]" />
                : <Package className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#087F3F]" />}
            </span>
            <p className="text-[10px] sm:text-xs font-bold text-[#17202A] whitespace-nowrap">
              {isRideHailing ? 'Bookings' : 'Orders'}
            </p>
            {deliveries.length > 0 && (
              <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold bg-[#E9F7EF] text-[#087F3F]">
                {deliveries.length}
              </span>
            )}
          </button>
        </div>

      {/* Daily cash advance (2026-11-08): the rider already holds the Tourism
          Office cash for the day, so there is no per-delivery purchasing-cash
          panel; pickups are confirmed per restaurant on the trip status page. */}
      {!activeDelivery && deliveries.length > 0 && (
          <div className="clay-card fixed bottom-[calc(80px+env(safe-area-inset-bottom))] left-0 right-0 z-[1200] max-h-[35vh] sm:max-h-[40vh] overflow-y-auto rounded-t-2xl border-t p-3 sm:p-4 backdrop-blur lg:p-5">
            <div className="space-y-3">
              {deliveries.map((d) => (
                <div
                  key={d.id}
                  className="clay-menu-item bg-[#F5FBF7] border rounded-xl p-4 transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-[#17202A]">Order #{d.order_id}</span>
                        <StatusBadge status={d.status} />
                      </div>
                      <div className="flex items-start gap-2 text-sm">
                        <MapPin className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500">Pickup</p>
                          <p className="text-[#68727C]">{d.pickup_address}</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 text-sm">
                        <MapPin className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs text-gray-500">Delivery</p>
                          <p className="text-[#68727C]">{d.delivery_address}</p>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {getStatusActions(d)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
      )}
    </div>
  )
}
