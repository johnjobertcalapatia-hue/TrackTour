import { useState, useEffect, useRef } from 'react'

type LatLng = [number, number]

export interface OsrmRouteResult {
  points: LatLng[]
  distanceKm: number | null
  durationMin: number | null
}

// `cycling` profile: allows riders to use paths, service roads, footways and other
// non-car ways that a motorcycle/peddicab rider can actually traverse. The default
// `driving` profile is too restrictive (roads only) for this rider use case.
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/cycling'
const MIN_REFETCH_MOVE_M = 200
const RETRY_DELAY_MS = 1600

const METERS_PER_DEG = 111320

function moveMeters(a: LatLng, b: LatLng): number {
  const dLat = a[0] - b[0]
  const dLng = a[1] - b[1]
  return Math.sqrt(dLat * dLat + dLng * dLng) * METERS_PER_DEG
}

function keyOf(v: LatLng): string {
  // Coordinate values can arrive as strings from the API; coerce to numbers so
  // toFixed() works and the dedup key is stable regardless of type.
  const a = Number(v[0])
  const b = Number(v[1])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ''
  return `${a.toFixed(6)},${b.toFixed(6)}`
}

function isValidCoordinate([lat, lng]: LatLng): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  // 0,0 is the API's "unset coordinate" fallback (nullable lat/lng coalesced to
  // 0). Routing from the Gulf of Guinea is never valid for Bansud, so treat any
  // near-zero coordinate as missing rather than sending OSRM a garbage request.
  if (Math.abs(lat) < 1e-8 || Math.abs(lng) < 1e-8) return false
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

/** Builds the OSRM URL for an ordered waypoint list, or null when unusable. */
export function buildOsrmUrl(coords: LatLng[]): string | null {
  if (coords.length < 2) return null
  if (!coords.every(isValidCoordinate)) return null
  const osrmCoords = coords.map(([lat, lng]) => `${lng},${lat}`).join(';')
  return `${OSRM_BASE}/${osrmCoords}?overview=full&geometries=geojson`
}

// Fetches a polyline through an ordered list of waypoints (origin, intermediate
// stops in visit order, destination). Returns the geometry plus the route total
// distance/duration so the UI can show ETA and kilometres for the whole leg.
//
// The effect is keyed off the *string* representation of the waypoints rather
// than the (newly allocated) array references. This is important: a re-render
// that produces a fresh `riderPosition` array with identical coordinates no
// longer re-runs (and thereby cancels) an in-flight OSRM request. Previously a
// new array reference on every GPS tick would cancel the request before it
// resolved, and the in-flight flag was left stuck true, permanently blocking the
// route and leaving only a straight-line fallback.
export function useOsrmRoute(waypoints: LatLng[] | null, enabled: boolean): OsrmRouteResult {
  const [points, setPoints] = useState<LatLng[]>([])
  const [distanceKm, setDistanceKm] = useState<number | null>(null)
  const [durationMin, setDurationMin] = useState<number | null>(null)
  const [retryTick, setRetryTick] = useState(0)
  const lastKey = useRef<string | null>(null)
  const inFlight = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const key = enabled && waypoints && waypoints.length >= 2
    ? waypoints.map(keyOf).filter(Boolean).join('|')
    : ''

  useEffect(() => {
    const coords: [number, number][] = key
      ? key.split('|').map((part) => part.split(',').map(Number) as [number, number])
      : []

    if (coords.length < 2) {
      lastKey.current = null
      inFlight.current = false
      if (retryTimer.current) clearTimeout(retryTimer.current)
      setPoints([])
      setDistanceKm(null)
      setDurationMin(null)
      return
    }

    const osrmUrl = buildOsrmUrl(coords)
    if (!osrmUrl) {
      // Unset/invalid coordinates (e.g. 0,0 from a null-coalesced API field).
      // Do NOT hit OSRM — and record the key so the retry loop doesn't hammer
      // the public router with a request that can only ever 400.
      lastKey.current = key
      inFlight.current = false
      if (retryTimer.current) clearTimeout(retryTimer.current)
      setPoints([])
      setDistanceKm(null)
      setDurationMin(null)
      return
    }

    // Already fetched (successfully or successfully-empty) for these exact coords.
    if (lastKey.current === key) return

    // Only refetch once per meaningful origin move (what makes the line follow
    // the rider). A failed fetch does NOT set lastKey, so it can be retried.
    if (lastKey.current) {
      const [prevLat, prevLng] = lastKey.current.split('|')[0]!.split(',').map(Number) as [number, number]
      const currentOrigin = coords[0]!
      if (moveMeters([prevLat, prevLng], currentOrigin) <= MIN_REFETCH_MOVE_M) return
    }

    if (inFlight.current) return

    let cancelled = false
    inFlight.current = true

    fetch(osrmUrl)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('OSRM request failed'))))
      .then((json) => {
        if (cancelled) return
        const leg = json?.routes?.[0]
        const coordsGeo: unknown = leg?.geometry?.coordinates
        const routePoints: LatLng[] = Array.isArray(coordsGeo)
          ? coordsGeo.map(([lng, lat]: [number, number]): LatLng => [lat, lng])
          : []
        setPoints(routePoints)
        setDistanceKm(typeof leg?.distance === 'number' ? leg.distance / 1000 : null)
        setDurationMin(typeof leg?.duration === 'number' ? leg.duration / 60 : null)
        lastKey.current = key
        inFlight.current = false
      })
      .catch(() => {
        if (cancelled) return
        // Don't mark lastKey on failure so we can retry; schedule a retry so a
        // transient OSRM rate-limit / network blip self-heals instead of leaving
        // a permanent straight line.
        inFlight.current = false
        retryTimer.current = setTimeout(() => setRetryTick((t) => t + 1), RETRY_DELAY_MS)
      })

    return () => {
      cancelled = true
      inFlight.current = false
      if (retryTimer.current) clearTimeout(retryTimer.current)
    }
  }, [key, retryTick])

  return { points, distanceKm, durationMin }
}