import { useEffect, useRef, useState } from 'react'
import { bearingBetween, normalizeHeading, shortestHeadingDelta } from '@/shared/utils/rider-heading'

type LatLng = { lat: number; lng: number }

/** Ignore jitter below this many degrees. */
const MIN_TURN_DEGREES = 2
/** Route point used by routeBearing() must be at least this far from the tourist. */
const ROUTE_LOOKAHEAD_METERS = 50
/**
 * How far along the route the navigation view looks to decide "up". Short,
 * so it is the direction of the road right under the tourist: the line out
 * of the centred marker then runs straight up the screen, like Google Maps.
 */
export const ALONG_ROUTE_LOOKAHEAD_METERS = 20

function metersBetween(a: LatLng, b: LatLng): number {
  const r = 6_371_000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Direction from the tourist to the first route point a little way ahead. */
export function routeBearing(location: LatLng | null, route: [number, number][] | null): number | null {
  if (!location || !route || route.length < 2) return null
  const ahead = route.find(([lat, lng]) => metersBetween(location, { lat, lng }) >= ROUTE_LOOKAHEAD_METERS) ?? route[route.length - 1]!
  return bearingBetween({ latitude: location.lat, longitude: location.lng }, { latitude: ahead[0], longitude: ahead[1] })
}

/**
 * Direction of the road at the start of `route` (the remaining route, which
 * begins at the tourist's snapped position): from route[0] to the point
 * `lookahead` metres further *along the line* (interpolated), so the first
 * stretch of the drawn line points exactly this way.
 */
export function bearingAlongRoute(route: [number, number][] | null, lookahead = ALONG_ROUTE_LOOKAHEAD_METERS): number | null {
  if (!route || route.length < 2) return null
  const start = route[0]!
  let walked = 0
  let target: [number, number] = route[route.length - 1]!
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!
    const b = route[i + 1]!
    const seg = metersBetween({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] })
    if (walked + seg >= lookahead && seg > 0) {
      const t = (lookahead - walked) / seg
      target = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      break
    }
    walked += seg
  }
  if (target[0] === start[0] && target[1] === start[1]) return null
  return bearingBetween({ latitude: start[0], longitude: start[1] }, { latitude: target[0], longitude: target[1] })
}

/** Compass heading (degrees clockwise from north) from a device-orientation event, if it has one. */
export function compassHeadingFrom(e: DeviceOrientationEvent & { webkitCompassHeading?: number }): number | null {
  if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
    return normalizeHeading(e.webkitCompassHeading) // iOS: already clockwise from north
  }
  if ((e.absolute || e.type === 'deviceorientationabsolute') && typeof e.alpha === 'number') {
    const screenAngle = typeof window !== 'undefined' ? window.screen?.orientation?.angle ?? 0 : 0
    return normalizeHeading(360 - e.alpha + screenAngle)
  }
  return null
}

/**
 * iOS only lets pages read the compass after a user gesture asks for it; call
 * this from the Directions click. A no-op elsewhere.
 */
export function requestCompassPermission(): void {
  const DOE = (typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined) as
    | (typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> })
    | undefined
  if (typeof DOE?.requestPermission === 'function') DOE.requestPermission().catch(() => {})
}

/**
 * Map bearing for the tourist navigation view, which the map turns to face
 * "up". Like Waze / Google Maps, the road ahead toward the destination is
 * always at the top. Priority:
 *   1. the road right under the tourist (20 m along the remaining route)
 *   2. GPS course while moving (`course`), when there is no route
 *   3. the device compass, when there is neither
 * Returns an *unwrapped* angle (e.g. 350 → 365 rather than 5) so a CSS
 * transition never spins the long way round. 0 (north up) when inactive.
 */
export function useNavigationBearing({ active, location, course, route }: {
  active: boolean
  location: LatLng | null
  course: number | null
  route: [number, number][] | null
}): number {
  const [compass, setCompass] = useState<number | null>(null)
  const [bearing, setBearing] = useState(0)
  const bearingRef = useRef(0)

  useEffect(() => {
    if (!active || typeof window === 'undefined') return
    const onOrientation = (e: Event) => {
      const heading = compassHeadingFrom(e as DeviceOrientationEvent)
      if (heading !== null) setCompass(heading)
    }
    const absoluteEvent = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(absoluteEvent, onOrientation)
    return () => {
      window.removeEventListener(absoluteEvent, onOrientation)
      setCompass(null)
    }
  }, [active])

  // `route` is the remaining route starting at the tourist's snapped position;
  // fall back to a point-ahead bearing from the raw position if it's too short.
  const fromRoute = bearingAlongRoute(route) ?? routeBearing(location, route)
  const target = active ? (fromRoute ?? course ?? compass ?? bearingRef.current) : 0

  useEffect(() => {
    const prev = bearingRef.current
    const delta = shortestHeadingDelta(prev, target)
    if (Math.abs(delta) < MIN_TURN_DEGREES && !(target === 0 && !active)) return
    bearingRef.current = prev + delta
    setBearing(bearingRef.current)
  }, [target, active])

  return active ? bearing : 0
}
