/** Arrival threshold (meters) for reaching an individual pickup stop. */
export const STOP_ARRIVAL_THRESHOLD_METERS = 100

export interface ArrivalStop {
  id: number
  sequence: number
  status: 'pending' | 'collected'
  latitude: number | null
  longitude: number | null
  business_name?: string | null
}

export interface ResolveStopArrivalInput {
  riderLatitude: number
  riderLongitude: number
  stops: ArrivalStop[]
  thresholdMeters?: number
}

export interface StopArrivalResult {
  /** The next unconsumed pickup stop in drive order (or null). */
  activeStop: ArrivalStop | null
  /** Straight-line distance from the rider to the active stop, if measurable. */
  distanceMeters: number | null
  /**
   * Whether the rider has reached the active stop.
   *
   * Idempotent by construction: derived purely from the rider position + stop
   * status each render, so `not arrived → arrived → arrived` is stable and a
   * stop that is `collected` is never active again (no re-trigger). It only
   * UNLOCKS the Collect action — it never marks anything collected.
   */
  arrived: boolean
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function formatStopDistance(distanceMeters: number | null): string {
  if (distanceMeters == null) return ''
  if (distanceMeters < 1000) return `~${Math.max(1, Math.round(distanceMeters))} m`
  return `~${(distanceMeters / 1000).toFixed(1)} km`
}

/**
 * Stop-level arrival detection for group-checkout pickups.
 *
 * The active stop is the FIRST unconsumed stop in drive order. The rider is
 * "arrived" when within the arrival threshold. A stop without coordinates is
 * treated as arrived (unmeasurable — never block collection on missing data).
 */
export function resolveStopArrival(input: ResolveStopArrivalInput): StopArrivalResult {
  const { riderLatitude, riderLongitude, stops, thresholdMeters = STOP_ARRIVAL_THRESHOLD_METERS } = input

  const activeStop = stops.find((s) => s.status !== 'collected') ?? null
  if (!activeStop) {
    return { activeStop: null, distanceMeters: null, arrived: false }
  }

  const distanceMeters =
    activeStop.latitude != null && activeStop.longitude != null
      ? haversineMeters(riderLatitude, riderLongitude, activeStop.latitude, activeStop.longitude)
      : null

  const arrived =
    activeStop.latitude == null ||
    activeStop.longitude == null ||
    (distanceMeters != null && distanceMeters <= thresholdMeters)

  return { activeStop, distanceMeters, arrived }
}