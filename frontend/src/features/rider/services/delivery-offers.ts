import type { Delivery } from '@/shared/types'

/** Card fields added by GET /rider/deliveries/pending (RiderOfferPresenter::summary). */
export interface OfferSummary {
  order_id: number | null
  order_number: string | null
  delivery_speed: 'standard' | 'fast'
  delivery_type_label: string
  pickup_names: string[]
  items_count: number
  rider_tip: number
  delivery_fee: number | null
  distance_km: number | null
  payment_method: string | null
  is_cod: boolean
  /**
   * available = can be reviewed/accepted; reviewing = another rider has it open
   * (exclusive review hold); taken = another rider accepted it; mine = accepted by me.
   */
  availability?: 'available' | 'reviewing' | 'taken' | 'mine'
  /** Set on restricted offers, e.g. "Already accepted by another rider". */
  status_label?: string
  accepted_at?: string | null
  /** True when this rider currently holds the review of the offer. */
  reviewing_by_me?: boolean
  /** Board only: this rider's straight-line distance to the first pickup (km); null without GPS. */
  pickup_distance_km?: number | null
  /** Board only: number of restaurants to collect from. */
  pickup_stops?: number
}

/**
 * Board card line (dispatch Stage 3):
 * "0.8 km to first pickup · Restaurant C · 3 items · 2 pickup stops".
 */
export function boardSummaryLine(
  o: Pick<OfferSummary, 'pickup_distance_km' | 'pickup_names' | 'items_count' | 'pickup_stops'>,
): string {
  const stops = o.pickup_stops ?? o.pickup_names.length
  return [
    o.pickup_distance_km != null ? `${Number(o.pickup_distance_km).toFixed(1)} km to first pickup` : null,
    o.pickup_names[0] ?? null,
    `${o.items_count} ${o.items_count === 1 ? 'item' : 'items'}`,
    stops > 0 ? `${stops} pickup ${stops === 1 ? 'stop' : 'stops'}` : null,
  ].filter(Boolean).join(' · ')
}

export const isTaken = (o: Pick<OfferSummary, 'availability'>) => o.availability === 'taken'

/** Another rider has it (accepted or reviewing): not viewable or acceptable. */
export const isRestricted = (o: Pick<OfferSummary, 'availability'>) =>
  o.availability === 'taken' || o.availability === 'reviewing'

export type PendingDelivery = Omit<Delivery, 'order_id' | 'delivery_fee' | 'distance_km' | 'rider_tip'> & OfferSummary

export interface OfferPickup {
  id: number
  name: string
  address: string | null
  logo: string | null
  items_count: number
}

export interface OfferItem {
  id: number
  business_id: number
  product_name: string
  quantity: number
  unit_price: number
  subtotal: number
  notes: string | null
  image: string | null
}

/** GET /rider/deliveries/{id}/offer (RiderOfferPresenter::detail). */
export interface DeliveryOffer extends Omit<OfferSummary, 'availability'> {
  /** Full details are only ever served for offers this rider may act on. */
  availability?: 'available' | 'mine'
  id: number
  order_type?: string | null
  status: string
  is_mine: boolean
  offered_to_me: boolean
  estimated_duration_minutes: number | null
  created_at: string
  pickup: { address: string | null; latitude: number | null; longitude: number | null }
  dropoff: { address: string | null; latitude: number | null; longitude: number | null }
  pickups: OfferPickup[]
  items: OfferItem[]
  items_total: number
  /** End of this rider's exclusive review hold (POST /review). */
  review_expires_at?: string | null
  review_seconds?: number
  /** Assigned rider only (RiderOfferPresenter::assignedExtras). */
  assigned_at?: string | null
  rider_earnings?: number | null
  customer_name?: string | null
  customer_phone?: string | null
  order_status?: string | null
}

/** Offer another rider accepted or is reviewing: no route or items. */
export interface TakenOffer extends Omit<OfferSummary, 'availability'> {
  id: number
  availability: 'taken' | 'reviewing'
  status_label: string
  pickup_address: string | null
  order_type?: string | null
  created_at: string
}

export type OfferResponse = DeliveryOffer | TakenOffer

export const peso = (n: number | null | undefined) =>
  `₱${Number(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const km = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toFixed(1)} km`)

export const paymentLabel = (o: Pick<OfferSummary, 'is_cod' | 'payment_method'>) =>
  o.is_cod ? 'Cash on delivery' : o.payment_method ? 'Paid online' : '—'

export const orderLabel = (o: Pick<OfferSummary, 'order_number' | 'order_id'>) =>
  o.order_number ? `#${o.order_number}` : o.order_id ? `#${o.order_id}` : ''
