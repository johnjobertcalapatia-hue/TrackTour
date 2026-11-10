import { pickupStopReasonLabel, type PickupStop, type PickupStopsData } from '@/features/rider/pickup-stops'

/**
 * Rider trip status page (2026-11-08): the delivery as four stages.
 *
 *   1 Order Accepted → 2 Pickup at Restaurants → 3 In Transit → 4 Confirm Delivery
 *
 * Derived only from authoritative server state (delivery status + the
 * /pickup-stops payload). The server still enforces every gate (route order,
 * pickup radius, restaurant ready, COD "Payment received", 50 m photo proof).
 */
export type TripStepState = 'done' | 'current' | 'upcoming'
export type TripStage = 1 | 2 | 3 | 4 | 'done' | 'cancelled'

const PICKUP = ['assigned', 'en_route_pickup', 'arrived_pickup']
const TRANSIT = ['picked_up', 'in_transit']

export function tripStage(status: string | null | undefined, nearDropoff = false): TripStage {
  const s = status ?? ''
  if (s === 'cancelled') return 'cancelled'
  if (s === 'delivered' || s === 'completed') return 'done'
  if (s === 'arrived_destination') return 4
  if (TRANSIT.includes(s)) return nearDropoff ? 4 : 3
  if (PICKUP.includes(s)) return 2
  return 1
}

export function stepState(step: 1 | 2 | 3 | 4, stage: TripStage): TripStepState {
  if (stage === 'done') return 'done'
  if (stage === 'cancelled') return step === 1 ? 'done' : 'upcoming'
  if (step < stage) return 'done'
  return step === stage ? 'current' : 'upcoming'
}

export type StopAction =
  | { kind: 'collected' }
  | { kind: 'arrive'; enabled: boolean; hint: string | null }
  | { kind: 'pickup'; enabled: boolean; hint: string | null }

const ARRIVAL_HINTS: Record<NonNullable<PickupStop['arrival_reason']>, string> = {
  not_current: 'Pick up the restaurants in route order.',
  too_far: 'Move closer to the restaurant to confirm arrival.',
  gps_unavailable: 'Share your location to confirm arrival.',
}

/**
 * The one button a restaurant row shows: "Confirm Arrival" until the rider
 * checked in at the restaurant, then "Confirm Pick Up", then a collected chip.
 * Only the current stop (first uncollected in route order) is ever enabled.
 * No stop waits for a per-delivery cash issue: the rider already holds the
 * Tourism Office's daily cash advance (decision 2026-11-08).
 */
export function stopAction(stop: PickupStop, data: Pick<PickupStopsData, 'stops'>): StopAction {
  if (stop.status === 'collected') return { kind: 'collected' }

  const current = [...data.stops].sort((a, b) => a.sequence - b.sequence).find((s) => s.status !== 'collected')
  const isCurrent = current?.id === stop.id

  if (!stop.arrived_at) {
    if (!isCurrent) return { kind: 'arrive', enabled: false, hint: ARRIVAL_HINTS.not_current }
    return {
      kind: 'arrive',
      enabled: stop.arrival_can_confirm,
      hint: stop.arrival_can_confirm ? null : (stop.arrival_reason ? ARRIVAL_HINTS[stop.arrival_reason] : null),
    }
  }

  return {
    kind: 'pickup',
    enabled: isCurrent && stop.can_confirm,
    hint: isCurrent && stop.can_confirm ? null : pickupStopReasonLabel(isCurrent ? stop.reason : 'not_current'),
  }
}

/** "Nov 4, 2026 • 12:15 PM" (Philippine time). */
export function stepTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })
  return `${date} • ${time}`
}

/** One requirement an action waits for, shown as a tick / cross under its button. */
export interface Condition {
  label: string
  met: boolean
}

/** Server defaults (config/tracking.php): restaurant 50 m, drop-off arrival 50 m, delivery proof 50 m. */
export const PICKUP_RADIUS_M = 50
export const DROPOFF_ARRIVAL_RADIUS_M = 50
export const DROPOFF_PROOF_RADIUS_M = 50

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  const km = meters / 1000
  return km < 100 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString('en-US')} km`
}

function withinLabel(radius: number, place: string, distance: number | null, locationKnown: boolean): string {
  if (!locationKnown || distance == null) return `Within ${radius} m of ${place} (turn on your location)`
  return `Within ${radius} m of ${place} (you are ${formatDistance(distance)} away)`
}

/**
 * What a restaurant row's button waits for (2026-11-10): Confirm Arrival needs
 * the rider's turn in route order and the restaurant within the pickup radius;
 * Confirm Pick Up needs the check-in, the restaurant's "Payment received" (COD
 * only), the food ready and the rider still in the pickup area. Mirrors the
 * server gates, which stay authoritative.
 */
export function stopConditions(stop: PickupStop, data: Pick<PickupStopsData, 'stops' | 'pickup_radius_meters'>): Condition[] {
  if (stop.status === 'collected') return []
  const radius = data.pickup_radius_meters ?? PICKUP_RADIUS_M
  const ordered = [...data.stops].sort((a, b) => a.sequence - b.sequence)
  const current = ordered.find((s) => s.status !== 'collected')
  const isCurrent = current?.id === stop.id
  const locationKnown = stop.arrival_reason !== 'gps_unavailable' && stop.reason !== 'gps_unavailable'
  const conditions: Condition[] = []
  if (ordered.length > 1) conditions.push({ label: 'Your turn in the pickup order', met: isCurrent })

  if (!stop.arrived_at) {
    conditions.push({
      label: withinLabel(radius, 'the restaurant', stop.distance_meters, locationKnown),
      met: stop.arrival_can_confirm || (locationKnown && stop.distance_meters != null && stop.distance_meters <= radius),
    })
    return conditions
  }

  conditions.push({ label: 'Arrived at the restaurant', met: true })
  if (stop.payment_confirmed != null) {
    conditions.push({ label: 'Restaurant confirmed your payment', met: stop.payment_confirmed === true })
  }
  conditions.push({ label: 'Food is ready', met: stop.is_ready || stop.ready_label === 'ready' || stop.ready_label === 'none' })
  conditions.push({
    label: withinLabel(radius, 'the restaurant', stop.distance_meters, locationKnown),
    met: stop.reason !== 'too_far' && stop.reason !== 'gps_unavailable',
  })
  return conditions
}

/** "I've Arrived" at the tourist: all food picked up and within 50 m of the delivery address. */
export function dropoffArrivalConditions(distance: number | null, locationKnown: boolean): Condition[] {
  return [
    { label: 'All food picked up', met: true },
    {
      label: withinLabel(DROPOFF_ARRIVAL_RADIUS_M, 'the delivery address', distance, locationKnown),
      met: locationKnown && distance != null && distance <= DROPOFF_ARRIVAL_RADIUS_M,
    },
  ]
}

/** "Confirm Delivered": within 50 m of the delivery address and a submitted photo. */
export function deliveryConditions(distance: number | null, locationKnown: boolean, photoSubmitted: boolean): Condition[] {
  return [
    {
      label: withinLabel(DROPOFF_PROOF_RADIUS_M, 'the delivery address', distance, locationKnown),
      met: locationKnown && distance != null && distance <= DROPOFF_PROOF_RADIUS_M,
    },
    { label: 'Photo of the tourist receiving the food submitted', met: photoSubmitted },
  ]
}

export const allMet = (conditions: Condition[]): boolean => conditions.every((c) => c.met)

/** Straight-line distance in metres. */
export function distanceMeters(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180
  const dLat = (b[0] - a[0]) * rad
  const dLng = (b[1] - a[1]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}
