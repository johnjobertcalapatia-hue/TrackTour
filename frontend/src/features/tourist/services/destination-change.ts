import { post } from '@/shared/services/api'

/** A ride's one confirmed destination change (server: RideDestinationChange::present). */
export interface DestinationChange {
  id: number
  status: 'confirmed' | 'finalized'
  original: { address: string | null; latitude: number; longitude: number }
  new: { name: string | null; address: string | null; latitude: number; longitude: number }
  confirmed_at: string | null
  original_fare: number
  estimated_fare: number
  max_fare: number
  traveled_km_at_change: number
  remaining_km_estimate: number
  rider_notification_status: 'pending' | 'sent' | 'failed'
  rider_acknowledged_at: string | null
  verified_km: number | null
  unverified_km: number | null
  computed_fare: number | null
  final_fare: number | null
  cap_adjustment: number | null
  original_commission: number
  final_commission: number | null
  fare_review_status: 'ok' | 'needs_review' | null
  review_reasons: string[]
  finalized_at: string | null
}

export interface DestinationPreview {
  quote_token: string
  expires_at: string
  destination: { name: string | null; address: string | null; latitude: number; longitude: number }
  traveled_km: number
  remaining_km: number
  route_source: 'osrm' | 'straight_line'
  route: [number, number][]
  from: { latitude: number; longitude: number }
  original_fare: number
  estimated_fare: number
  max_fare: number
  base_fare: number
  per_km: number
  changes_left: number
}

export const previewDestinationChange = (tripId: number | string, point: { name: string; address: string; lat: number; lng: number }) =>
  post<DestinationPreview>(`/tourist/transport/trip/${tripId}/destination-change/preview`, {
    destination_name: point.name,
    destination_address: point.address,
    destination_lat: point.lat,
    destination_lng: point.lng,
  })

export const confirmDestinationChange = (tripId: number | string, quoteToken: string, idempotencyKey: string) =>
  post<{ destination_change: DestinationChange; replayed: boolean }>(`/tourist/transport/trip/${tripId}/destination-change`, {
    quote_token: quoteToken,
    idempotency_key: idempotencyKey,
  })

/** One key per reviewed estimate: a double tap or a retry confirms the same change once. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `dc-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}
