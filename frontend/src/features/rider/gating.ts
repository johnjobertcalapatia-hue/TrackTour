/**
 * Pickup gate — mirrors the authoritative backend rule in
 * RiderDeliveryController::updateStatus: a food delivery (COD or prepaid) may
 * not leave the pickup area (status -> picked_up) until every restaurant pickup
 * stop has been confirmed. The backend enforces this with a 422; the UI mirrors
 * it here so the rider is guided to finish the per-restaurant "Confirm Item
 * Pickup" sequence instead of blind-firing a transition the server rejects.
 * Transport / item-less deliveries have no stops and are never blocked.
 */

export const COD_PICKUP_GATE_MESSAGE =
  'Collect food from every restaurant before leaving the pickup area.'

export interface PickupGateData {
  /** Server payload field names (Laravel snake_case). */
  has_stops: boolean
  fully_collected: boolean
}

export interface PickupGateInput {
  isPickupStage: boolean
  hasStops: boolean
  fullyCollected: boolean
  /** True once the /pickup-stops payload has loaded (successfully). */
  stopsLoaded: boolean
}

export interface PickupGateResult {
  blocked: boolean
  message: string | null
}

export function resolvePickupGate({
  isPickupStage,
  hasStops,
  fullyCollected,
  stopsLoaded,
}: PickupGateInput): PickupGateResult {
  if (isPickupStage && (!stopsLoaded || (hasStops && !fullyCollected))) {
    // While the stops payload is still loading we must NOT reveal the pickup
    // confirm button: the backend inevitably 422s a premature `picked_up`, and
    // flashing "I Picked Up the Food" that then flips to the gate is exactly
    // the double-message artifact riders reported. Stay neutral until resolved.
    return { blocked: true, message: stopsLoaded ? COD_PICKUP_GATE_MESSAGE : null }
  }
  return { blocked: false, message: null }
}

/**
 * Arrival-alert dismissal persistence. Dismissing the pickup arrival card
 * ("Collect Food at Restaurants") is a deliberate "I'll handle this in the
 * sheet" action — re-showing it after a page refresh is noise. The dismissal
 * is kept per (deliveryId, leg) so a DROPOFF alert on the same trip, or a
 * PICKUP alert on a later trip, is never wrongly suppressed.
 */
const ARRIVAL_DISMISS_KEY = 'tracktour:arrival-dismissed:v1'

const arrivalDismissKey = (deliveryId: number, kind: 'PICKUP' | 'DROPOFF') => `${deliveryId}:${kind}`

export function isArrivalDismissed(deliveryId: number, kind: 'PICKUP' | 'DROPOFF'): boolean {
  try {
    const raw = localStorage.getItem(ARRIVAL_DISMISS_KEY)
    if (!raw) return false
    const map = JSON.parse(raw) as Record<string, boolean>
    return map[arrivalDismissKey(deliveryId, kind)] === true
  } catch {
    return false
  }
}

export function markArrivalDismissed(deliveryId: number, kind: 'PICKUP' | 'DROPOFF') {
  try {
    const raw = localStorage.getItem(ARRIVAL_DISMISS_KEY)
    const map = (raw ? JSON.parse(raw) : {}) as Record<string, boolean>
    map[arrivalDismissKey(deliveryId, kind)] = true
    localStorage.setItem(ARRIVAL_DISMISS_KEY, JSON.stringify(map))
  } catch {
    // Storage unavailable (e.g. private mode) — dismissal only lasts this session.
  }
}