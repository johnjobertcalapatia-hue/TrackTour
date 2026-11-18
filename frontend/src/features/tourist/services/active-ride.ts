import { get } from '@/shared/services/api'

/** GET /tourist/transport/active: the tourist's unfinished ride (searching, on the way, in trip). */
export interface ActiveRide {
  id: number
  order_number: string
  /** Ride status: searching | arriving | driver_arrived | in_progress. */
  status: string
  delivery_address: string | null
  redirect: string
}

/**
 * One ride at a time (2026-11-17): a tourist cannot book another ride until
 * this one is completed or cancelled. The server refuses a second booking
 * (409 `active_ride`); the pages use this to say so before the tourist tries.
 */
export const ACTIVE_RIDE_KEY = ['tourist-transport-active'] as const
export const fetchActiveRide = () => get<ActiveRide | null>('/tourist/transport/active')
