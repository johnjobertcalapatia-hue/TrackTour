type LatLng = { lat: number; lng: number }
export type RoutePoint = [number, number] // [lat, lng]

export interface RouteProgress {
  /** The part still to travel: starts at the tourist's snapped position, ends at the destination. */
  remaining: RoutePoint[]
  /** Length of `remaining` in metres. */
  remainingMeters: number
  /** Length of the whole route in metres (to turn remainingMeters into a share of the road distance). */
  totalMeters: number
  /** Distance from the tourist to the nearest point on the route (how far they've strayed). */
  offRouteMeters: number
}

/** Beyond this the tourist has left the route and it should be re-planned. */
export const OFF_ROUTE_METERS = 40

const EARTH_RADIUS = 6_371_000

function distanceMeters(a: RoutePoint, b: RoutePoint): number {
  const dLat = ((b[0] - a[0]) * Math.PI) / 180
  const dLng = ((b[1] - a[1]) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Snaps the tourist onto the route and returns what's left of it, so the
 * drawn line is "consumed" as they move. Projection uses a local flat
 * approximation (fine at street scale).
 */
export function routeProgress(route: RoutePoint[], position: LatLng): RouteProgress | null {
  if (route.length < 2) return null
  const cosLat = Math.cos((position.lat * Math.PI) / 180)
  // Local metres relative to the tourist.
  const toXY = ([lat, lng]: RoutePoint): [number, number] => [
    ((lng - position.lng) * Math.PI / 180) * EARTH_RADIUS * cosLat,
    ((lat - position.lat) * Math.PI / 180) * EARTH_RADIUS,
  ]

  let best = { segment: 0, t: 0, dist: Infinity }
  for (let i = 0; i < route.length - 1; i++) {
    const [ax, ay] = toXY(route[i]!)
    const [bx, by] = toXY(route[i + 1]!)
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
    const px = ax + t * dx
    const py = ay + t * dy
    const dist = Math.hypot(px, py)
    if (dist < best.dist) best = { segment: i, t, dist }
  }

  const a = route[best.segment]!
  const b = route[best.segment + 1]!
  const snapped: RoutePoint = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t]
  const ahead = route.slice(best.segment + 1)
  // Standing on a route corner: don't repeat that corner after the snapped point.
  if (ahead.length > 1 && distanceMeters(snapped, ahead[0]!) < 0.5) ahead.shift()
  const remaining: RoutePoint[] = [snapped, ...ahead]

  let remainingMeters = 0
  for (let i = 0; i < remaining.length - 1; i++) remainingMeters += distanceMeters(remaining[i]!, remaining[i + 1]!)

  let totalMeters = 0
  for (let i = 0; i < route.length - 1; i++) totalMeters += distanceMeters(route[i]!, route[i + 1]!)

  return { remaining, remainingMeters, totalMeters, offRouteMeters: best.dist }
}
