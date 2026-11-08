import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import { Navigation, MapPin, LocateFixed, X, Loader2, Route as RouteIcon, Clock } from 'lucide-react'
import { pinIcon, userPinIcon } from '@/shared/utils/pin-icon'
import { useOsrmRoute } from '@/features/rider/hooks/useOsrmRoute'
import { cn } from '@/shared/utils'

type LatLng = [number, number]

type LocateState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'ready'; position: LatLng }
  | { status: 'error'; message: string }

interface Props {
  restaurantName: string
  destination: LatLng
  locationLabel: string
}

function geolocationMessage(error: GeolocationPositionError | null): string {
  if (error?.code === 1) return 'Location access is blocked. Allow location for this site to see the route from where you are.'
  if (error?.code === 3) return 'Finding your location took too long. Please try again.'
  return 'We could not find your current location. Check that location services are on and try again.'
}

function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`
}

function formatDuration(min: number): string {
  if (min < 1) return '< 1 min'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h} hr ${m} min` : `${h} hr`
}

/** Keeps the tourist, the restaurant and the route in view. */
function FitToRoute({ points }: { points: LatLng[] }) {
  const map = useMap()
  const key = points.map((p) => p.join(',')).join('|')
  useEffect(() => {
    if (points.length >= 2) map.fitBounds?.(points, { padding: [40, 40], maxZoom: 17 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key])
  return null
}

/**
 * Location tab of the restaurant page: shows the restaurant on the map and,
 * on request, the road route from the tourist's current GPS position.
 *
 * Routing reuses the canonical OSRM hook (`useOsrmRoute`, also used by the
 * rider map), so retry/invalid-coordinate handling is shared. While the road
 * route loads, or if the router is unreachable, a dashed straight line is
 * drawn so the tourist still sees the direction.
 */
export default function RestaurantRouteMap({ restaurantName, destination, locationLabel }: Props) {
  const [locate, setLocate] = useState<LocateState>({ status: 'idle' })
  const origin = locate.status === 'ready' ? locate.position : null

  const waypoints = useMemo<LatLng[] | null>(() => (origin ? [origin, destination] : null), [origin, destination])
  const route = useOsrmRoute(waypoints, origin !== null)
  const hasRoadRoute = route.points.length >= 2
  const linePoints: LatLng[] = hasRoadRoute ? route.points : origin ? [origin, destination] : []
  const routeLoading = origin !== null && !hasRoadRoute

  const findRoute = () => {
    if (!('geolocation' in navigator)) {
      setLocate({ status: 'error', message: 'This browser cannot share your location.' })
      return
    }
    setLocate({ status: 'locating' })
    navigator.geolocation.getCurrentPosition(
      (pos) => setLocate({ status: 'ready', position: [pos.coords.latitude, pos.coords.longitude] }),
      (err) => setLocate({ status: 'error', message: geolocationMessage(err) }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    )
  }

  const clearRoute = () => setLocate({ status: 'idle' })

  return (
    <section className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden" aria-label={`Location of ${restaurantName}`}>
      <div className="h-[clamp(260px,45vh,420px)] relative">
        <MapContainer center={destination} zoom={16} className="w-full h-full z-0">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>"
          />
          {linePoints.length >= 2 && (
            <Polyline
              positions={linePoints}
              pathOptions={{
                color: hasRoadRoute ? '#087F3F' : '#56615B',
                weight: hasRoadRoute ? 6 : 4,
                opacity: hasRoadRoute ? 0.9 : 0.7,
                dashArray: hasRoadRoute ? undefined : '8 10',
              }}
            />
          )}
          {origin && <Marker position={origin} icon={userPinIcon} />}
          <Marker position={destination} icon={pinIcon(restaurantName, true)} />
          {origin && <FitToRoute points={linePoints} />}
        </MapContainer>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <MapPin className="w-5 h-5 text-[#087F3F] mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[15px] font-semibold text-[#17201B]">{locationLabel}</p>
        </div>

        {origin && (
          <div className="rounded-xl bg-[#F3F8F4] border border-[#D3E6D8] p-4 flex flex-wrap items-center justify-between gap-3" role="status" aria-live="polite">
            {routeLoading ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-[#17201B]">
                <Loader2 className="w-4 h-4 animate-spin text-[#087F3F]" aria-hidden="true" /> Finding the best road route…
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                <span className="flex items-center gap-1.5 text-sm text-[#56615B]">
                  <RouteIcon className="w-4 h-4 text-[#087F3F]" aria-hidden="true" />
                  <span className="text-lg font-extrabold text-[#17201B]">{route.distanceKm != null ? formatDistance(route.distanceKm) : '—'}</span>
                </span>
                <span className="flex items-center gap-1.5 text-sm text-[#56615B]">
                  <Clock className="w-4 h-4 text-[#087F3F]" aria-hidden="true" />
                  <span className="text-lg font-extrabold text-[#17201B]">{route.durationMin != null ? formatDuration(route.durationMin) : '—'}</span>
                  <span>approx. travel time</span>
                </span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={findRoute}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full border border-[#087F3F] text-[#087F3F] text-sm font-semibold hover:bg-[#087F3F] hover:text-white transition"
              >
                <LocateFixed className="w-4 h-4" aria-hidden="true" /> Update my location
              </button>
              <button
                type="button"
                onClick={clearRoute}
                className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-[#56615B] text-sm font-semibold hover:bg-[#E5E9E7] transition"
              >
                <X className="w-4 h-4" aria-hidden="true" /> Clear route
              </button>
            </div>
          </div>
        )}

        {locate.status === 'error' && (
          <p className="rounded-xl bg-[#FEF2F2] border border-[#B91C1C]/20 px-4 py-3 text-sm text-[#991B1B]" role="alert">{locate.message}</p>
        )}

        {!origin && (
          <button
            type="button"
            onClick={findRoute}
            disabled={locate.status === 'locating'}
            className={cn(
              'w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 px-5 rounded-xl bg-[#087F3F] text-white text-sm font-bold hover:bg-[#056B35] transition',
              'disabled:opacity-70 disabled:cursor-wait',
            )}
          >
            {locate.status === 'locating' ? (
              <><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Finding your location…</>
            ) : (
              <><Navigation className="w-4 h-4" aria-hidden="true" /> Get directions from my location</>
            )}
          </button>
        )}
      </div>
    </section>
  )
}
