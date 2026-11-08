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
