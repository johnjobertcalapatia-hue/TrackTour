export interface StagedRouteStop {
  sequence: number
  status: 'pending' | 'collected'
  latitude: number | null
  longitude: number | null
}

export interface StagedRoutePoint {
  latitude: number | null
  longitude: number | null
}

export interface ResolvePickupRouteInput {
  /** Live rider GPS position ([lat, lng]). */
  rider: [number, number]
  isPickupLeg: boolean
  isDropLeg: boolean
  /** Whether this delivery has per-restaurant pickup stops (food orders). */
  hasPickupStops: boolean
  /** True once every restaurant pickup stop has been confirmed. */
  allCollected: boolean
  /** Per-restaurant stops in drive order (ascending preparation time). */
  stops: StagedRouteStop[]
  /** The LAST restaurant (pickupOrigin) — drop-off route origin. */
  finalPickup: StagedRoutePoint | null
  /** The tourist drop-off destination. */
  destination: StagedRoutePoint | null
  /** Delivery-level pickup coordinate fallback. */
  fallbackPickup: StagedRoutePoint | null
  /** Delivery-level drop-off coordinate fallback. */
  fallbackDestination: StagedRoutePoint | null
}

/**
 * Group-checkout pickup routing.
 *
 * The driver navigates to ONE restaurant at a time: the next unconsumed stop
 * in drive order. Only after every restaurant's food is collected does the
 * route switch to the drop-off leg (final pickup → tourist destination).
 *
 *   Start → Stop 1 → Stop 2 → … → Last Stop → Drop-off
 *                    (one leg at a time)
 *
 * Returns a 2+ point waypoint list for OSRM (or [] when no route is drawable).
 */
export function resolvePickupRoute(input: ResolvePickupRouteInput): [number, number][] {
  const toPoint = (p: StagedRoutePoint | null | undefined): [number, number] | null => {
    if (!p) return null
    const lat = Number(p.latitude)
    const lng = Number(p.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    // The backend coalesces nullable coordinates to 0 — never draw a route to
    // or from an unset point (it would end up asking OSRM for "0,0").
    if (Math.abs(lat) < 1e-8 || Math.abs(lng) < 1e-8) return null
    return [lat, lng]
  }

  const lastCollected =
    input.stops.filter((s) => s.status === 'collected').slice(-1)[0] ?? null
  const origin =
    toPoint(input.finalPickup) ??
    (lastCollected ? toPoint(lastCollected) : null) ??
    toPoint(input.fallbackPickup)
  const destination = toPoint(input.destination) ?? toPoint(input.fallbackDestination)

  // Drop leg: last restaurant → tourist destination.
  if (input.isDropLeg) {
    return origin && destination ? [origin, destination] : []
  }

  if (!input.isPickupLeg) return []

  const rider = input.rider

  // Every restaurant collected: leave toward the destination immediately.
  if (input.hasPickupStops && input.allCollected) {
    return origin && destination ? [origin, destination] : []
  }

  // Multi-restaurant pickup: route only to the NEXT unconsumed restaurant.
  if (input.hasPickupStops) {
    const nextPoint =
      input.stops.find((s) => s.status !== 'collected') ?? null
    const target = nextPoint ? toPoint(nextPoint) : null
    return target ? [rider, target] : []
  }

  // Single-point pickup (no per-restaurant stops): rider → delivery pickup.
  const fallback = toPoint(input.fallbackPickup)
  return fallback ? [rider, fallback] : []
}