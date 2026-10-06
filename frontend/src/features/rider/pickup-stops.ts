/**
 * Per-restaurant pickup sequence payload — the single source for the rider's
 * pickup stage. Mirrors the Laravel `RiderPickupStopController::index` shape
 * (GET /rider/deliveries/{delivery}/pickup-stops).
 *
 * Every stop carries its own gate state (computed server-side from the current
 * stop in route order, the rider's latest GPS fix vs. the configured pickup
 * radius, and the restaurant's item readiness):
 *
 *     CAN_CONFIRM_PICKUP =
 *         stop is current (next unconfirmed) in route order
 *         AND rider within radius
 *         AND restaurant items all READY
 */

export type PickupStopStatus = 'pending' | 'collected'
export type PickupStopReadyLabel = 'ready' | 'preparing' | 'accepted' | 'none'
export type PickupStopBlockReason = 'not_current' | 'waiting_ready' | 'too_far' | 'gps_unavailable' | null

export interface PickupStopItem {
  id: number
  product_name: string
  quantity: number
  unit_price: number
  subtotal: number
  notes: string | null
  status: string
}

export interface PickupStopCodPurchase {
  id: number
  purchase_number: string
  purchase_amount: number
  status: 'pending' | 'purchased' | 'collected'
  purchased_at?: string | null
  collected_at?: string | null
}

export interface PickupStop {
  id: number
  business_id: number
  business_name: string | null
  sequence: number
  preparation_time: number | null
  pickup_lat: number | null
  pickup_lng: number | null
  pickup_address: string | null
  status: PickupStopStatus
  pickup_confirmed_at: string | null
  is_ready: boolean
  ready_label: PickupStopReadyLabel
  ready_item_count: number
  active_item_count: number
  distance_meters: number | null
  can_confirm: boolean
  reason: PickupStopBlockReason
  items: PickupStopItem[]
  cod_purchase: PickupStopCodPurchase | null
}

export interface PickupStopsData {
  delivery_id: number
  is_cod: boolean
  purchasing_cash: number | null
  purchasing_cash_issued_at: string | null
  purchasing_cash_received_at: string | null
  fully_collected: boolean
  pickup_origin: {
    business_id: number
    business_name: string | null
    latitude: number | null
    longitude: number | null
    address: string | null
  } | null
  dropoff: {
    latitude: number | null
    longitude: number | null
    address: string | null
  } | null
  stops: PickupStop[]
}

/** Human label for the gate reason that keeps a stop from being confirmable. */
export function pickupStopReasonLabel(reason: PickupStopBlockReason): string | null {
  switch (reason) {
    case 'not_current':
      return 'Confirm the pickups in route order.'
    case 'waiting_ready':
      return 'The restaurant is still preparing your order.'
    case 'too_far':
      return 'Move into the pickup area first.'
    case 'gps_unavailable':
      return 'Share your location to confirm this pickup.'
    default:
      return null
  }
}

/** Human label for the restaurant readiness chip. */
export function pickupReadyLabel(readyLabel: PickupStopReadyLabel): string {
  switch (readyLabel) {
    case 'ready':
      return 'Ready for pickup'
    case 'preparing':
      return 'Preparing…'
    case 'accepted':
      return 'Accepted — not yet preparing'
    case 'none':
      return 'No items to wait for'
  }
}