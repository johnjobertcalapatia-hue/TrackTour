import { useState, useEffect, useRef } from 'react'

type LatLng = [number, number]

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

function keyOf(v: LatLng | null): string {
  if (!v) return ''
  // Coordinate values can arrive as strings from the API; coerce to numbers so
  // toFixed() works and the dedup key is stable regardless of type.
  const a = Number(v[0])
  const b = Number(v[1])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ''
  return `${a.toFixed(6)},${b.toFixed(6)}`
}

function partsOf(key: string): LatLng {
  const p = key.split(',').map(Number)
  return [p[0], p[1]]
}

// The effect is keyed off *string* representations of origin/destination rather
// than the (newly allocated) array references. This is important: a re-render
// that produces a fresh `riderPosition` array with identical coordinates no
// longer re-runs (and thereby cancels) an in-flight OSRM request. Previously a
// new array reference on every GPS tick would cancel the request before it
// resolved, and the in-flight flag was left stuck true, permanently blocking the
// route and leaving only a straight-line fallback.
export function useOsrmRoute(origin: LatLng | null, destination: LatLng | null, enabled: boolean): LatLng[] {
  const [route, setRoute] = useState<LatLng[]>([])
  const [retryTick, setRetryTick] = useState(0)
  const lastKey = useRef<string | null>(null)
  const inFlight = useRef(false)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const originKey = enabled ? keyOf(origin) : ''
  const destKey = enabled ? keyOf(destination) : ''

  useEffect(() => {
    if (!enabled || !originKey || !destKey) {
      lastKey.current = null
      inFlight.current = false
      if (retryTimer.current) clearTimeout(retryTimer.current)
      setRoute([])
      return
    }

    const key = `${originKey}|${destKey}`

    // Already fetched (successfully or successfully-empty) for these exact coords.
    if (lastKey.current === key) return

    // Only refetch once per meaningful origin move (what makes the line follow
    // the rider). A failed fetch does NOT set lastKey, so it can be retried.
    if (lastKey.current) {
      const [lastOrigin] = lastKey.current.split('|')
      const prev: LatLng = partsOf(lastOrigin)
      const currentOrigin: LatLng = partsOf(originKey)
      if (moveMeters(prev, currentOrigin) <= MIN_REFETCH_MOVE_M) return
    }

    if (inFlight.current) return

    const o: LatLng = partsOf(originKey)
    const d: LatLng = partsOf(destKey)
    const [oLng, oLat] = [o[1], o[0]]
    const [dLng, dLat] = [d[1], d[0]]
    const url = `${OSRM_BASE}/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson`

    let cancelled = false
    inFlight.current = true

    fetch(url)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('OSRM request failed'))))
      .then((json) => {
        if (cancelled) return
        const coords: [number, number][] | undefined = json?.routes?.[0]?.geometry?.coordinates
        const points: LatLng[] = Array.isArray(coords)
          ? coords.map(([lng, lat]): LatLng => [lat, lng])
          : []
        setRoute(points)
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
  }, [enabled, originKey, destKey, retryTick])

  return route
}
