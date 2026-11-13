/**
 * A GPS reading the app may use and send. A fix with an exact 0 latitude or
 * longitude is a reading missing an axis (an emulated / overridden location
 * with an empty field), never a real rider position: on 2026-11-10 one such fix
 * (12.96, 0) put a rider "12,949 km" from the drop-off. The server refuses it
 * too (422).
 */
export function isUsableGpsFix(latitude: unknown, longitude: unknown): boolean {
  const lat = Number(latitude)
  const lng = Number(longitude)
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat !== 0 && lng !== 0
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

export const INVALID_GPS_MESSAGE = 'Your device reported an invalid location. Check the location settings on your phone.'

/** The server saves a moving fix only at this accuracy or better (RiderMapController). */
export const MAX_SAVED_ACCURACY_M = 50

/**
 * Why the server did not save a location the map is showing (2026-11-10).
 * The map follows the phone, but trip buttons follow the SAVED location, so a
 * silently refused fix left a rider "at the restaurant" on the map yet
 * "10.6 km away" on the checklist.
 */
export function locationSyncWarning(reason: unknown, accuracy?: number | null): string | null {
  if (reason === 'low_accuracy') {
    const acc = accuracy != null && Number.isFinite(accuracy) ? ` (±${Math.round(accuracy)} m)` : ''
    return `Your location is not being saved: GPS is not precise enough${acc}. It needs ${MAX_SAVED_ACCURACY_M} m or better. Move to an open area with location on.`
  }
  if (reason === 'implausible_movement') {
    return 'Your location is not being saved: it jumped too far from your last saved position. If TrackTour is open in another tab or phone, close it, then wait 2 minutes.'
  }
  return null
}

/**
 * The rider's location is sent every 5 s on every rider page (decision
 * 2026-11-11). The map's GPS stream, the background heartbeat and the fresh
 * fix before an action share one clock so the server never gets the same
 * position twice within the interval.
 */
export const RIDER_LOCATION_INTERVAL_MS = 5_000

let lastLocationSentAt = 0

export function markLocationSent(at: number = Date.now()): void {
  lastLocationSentAt = at
}

/** True when a fix was sent less than (almost) one interval ago. */
export function locationSentRecently(at: number = Date.now()): boolean {
  return at - lastLocationSentAt < RIDER_LOCATION_INTERVAL_MS - 250
}
