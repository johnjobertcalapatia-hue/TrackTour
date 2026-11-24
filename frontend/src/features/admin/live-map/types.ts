/** Admin live map data: GET /admin/map-data, /admin/live/riders, /admin/live/sos. */

export interface BusinessPin {
  id: number
  name: string
  lat: number
  lng: number
  address: string | null
  category: string | null
  status: string
  municipality: string | null
  cover_photo?: string | null
  logo?: string | null
  open_status?: { status: 'open' | 'closed' | 'temporarily_closed' | 'no_hours'; label: string }
}

/** A town marker: municipality coordinates and logo (zoomed-out view). */
export interface MunicipalityPin {
  id: number
  name: string
  lat: number | null
  lng: number | null
  logo: string | null
}

export interface LatLngPoint {
  lat: number | null
  lng: number | null
}

export interface TripStop extends LatLngPoint {
  name: string | null
  address: string | null
  collected: boolean
}

export interface LiveTrip {
  id: number
  order_number: string | null
  type: 'food' | 'ride'
  status: string
  stage: 'to_pickup' | 'to_dropoff'
  customer_name: string | null
  pickups: TripStop[]
  dropoff: LatLngPoint & { address: string | null }
  assigned_at: string | null
  picked_up_at: string | null
}

export type RiderActivity = 'available' | 'busy' | 'delivering' | 'transporting'

export interface LiveRider {
  id: number
  name: string
  phone: string | null
  photo: string | null
  municipality: string | null
  rider_status: string
  service: string | null
  vehicle_type: string | null
  plate_number: string | null
  activity: RiderActivity
  location: { lat: number; lng: number; accuracy_m: number | null; at: string | null } | null
  trip: LiveTrip | null
}

export interface SosPin {
  id: number
  reference: string
  status: string
  raised_by_role: string
  service: string | null
  /** The rider on the SOS trip. */
  rider_id?: number | null
  reporter: { name: string | null; phone: string | null }
  message: string | null
  raised_at: string | null
  order: { order_number: string | null; pickup: string | null; dropoff: string | null } | null
  location: { latitude: number; longitude: number } | null
  live_location: { latitude: number; longitude: number; at: string | null } | null
}

export type PanelTab = 'businesses' | 'riders' | 'tourists'

export type Selection =
  | { kind: 'business'; id: number }
  | { kind: 'rider'; id: number }
  | { kind: 'sos'; id: number }
  | { kind: 'tourist'; id: number }
  | null

/** A tourist who opted in to share their live location with the tourism office. */
export interface LiveTourist {
  id: number
  name: string | null
  phone: string | null
  photo: string | null
  location: { lat: number; lng: number; accuracy_m: number | null; at: string | null }
  /** Nearest town centre (worked out on the map page). */
  municipality?: string | null
}

export const TOURIST_COLOR = '#7C3AED'
export const TOURIST_BG = '#F3EEFF'

export const ACTIVITY_META: Record<RiderActivity, { label: string; color: string; bg: string }> = {
  available: { label: 'Available', color: '#16A34A', bg: '#DCFCE7' },
  busy: { label: 'Busy', color: '#B45309', bg: '#FEF3C7' },
  delivering: { label: 'Delivering food', color: '#EA580C', bg: '#FFEDD5' },
  transporting: { label: 'Transporting', color: '#2563EB', bg: '#DBEAFE' },
}

const TRIP_STATUS: Record<string, { food: string; ride: string }> = {
  assigned: { food: 'Assigned — heading to the restaurant', ride: 'Assigned — heading to the passenger' },
  en_route_pickup: { food: 'On the way to pick up the food', ride: 'On the way to the passenger' },
  arrived_pickup: { food: 'At the restaurant, picking up', ride: 'Arrived at the passenger pickup' },
  picked_up: { food: 'Food picked up', ride: 'Passenger on board' },
  in_transit: { food: 'Delivering to the customer', ride: 'Driving to the destination' },
  arrived_destination: { food: 'Arrived at the customer', ride: 'Arrived at the destination' },
}

export function tripStatusLabel(trip: LiveTrip): string {
  return TRIP_STATUS[trip.status]?.[trip.type] ?? trip.status.replace(/_/g, ' ')
}

export function hasPoint(p: LatLngPoint | null | undefined): p is { lat: number; lng: number } {
  return !!p && typeof p.lat === 'number' && typeof p.lng === 'number'
}

/**
 * Where an SOS is pinned: on whoever pressed the button. A rider's SOS sits on
 * the rider's live GPS (it moves with them); a tourist's SOS sits on the
 * tourist's own phone location, which the tourist app refreshes while the
 * alert is open. Each falls back to the other point when its own is missing.
 */
export function sosPoint(s: SosPin): [number, number] | null {
  const p = s.raised_by_role === 'tourist' ? (s.location ?? s.live_location) : (s.live_location ?? s.location)
  return p ? [p.latitude, p.longitude] : null
}

/** Ordered route for a rider on a trip: rider → remaining pickups → drop-off. */
export function routeWaypoints(rider: LiveRider): [number, number][] {
  const trip = rider.trip
  if (!trip) return []
  const pts: [number, number][] = []
  if (rider.location) pts.push([rider.location.lat, rider.location.lng])
  if (trip.stage === 'to_pickup') {
    for (const stop of trip.pickups) if (!stop.collected && hasPoint(stop)) pts.push([stop.lat, stop.lng])
  }
  if (hasPoint(trip.dropoff)) pts.push([trip.dropoff.lat, trip.dropoff.lng])
  return pts
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
