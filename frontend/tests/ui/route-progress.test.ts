import { describe, expect, it } from 'vitest'
import { routeProgress, type RoutePoint } from '@/features/tourist/utils/route-progress'

// Straight road due north: ~111 m per 0.001 deg latitude.
const ROUTE: RoutePoint[] = [[12.84, 121.47], [12.841, 121.47], [12.842, 121.47], [12.843, 121.47]]

describe('routeProgress', () => {
  it('starts the remaining line at the tourist and drops the part already walked', () => {
    const p = routeProgress(ROUTE, { lat: 12.8415, lng: 121.47 })!
    expect(p.remaining[0]![0]).toBeCloseTo(12.8415, 6)
    expect(p.remaining.slice(1)).toEqual([[12.842, 121.47], [12.843, 121.47]])
    expect(p.remainingMeters).toBeGreaterThan(160)
    expect(p.remainingMeters).toBeLessThan(175)
    expect(p.offRouteMeters).toBeLessThan(1)
  })

  it('gets shorter as the tourist walks toward the destination', () => {
    const start = routeProgress(ROUTE, { lat: 12.84, lng: 121.47 })!.remainingMeters
    const later = routeProgress(ROUTE, { lat: 12.8425, lng: 121.47 })!.remainingMeters
    expect(later).toBeLessThan(start)
  })

  it('reports how far the tourist has strayed from the route', () => {
    // ~110 m east of the road.
    const p = routeProgress(ROUTE, { lat: 12.8415, lng: 121.471 })!
    expect(p.offRouteMeters).toBeGreaterThan(100)
    expect(p.offRouteMeters).toBeLessThan(120)
  })

  it('needs at least two points', () => {
    expect(routeProgress([[12.84, 121.47]], { lat: 12.84, lng: 121.47 })).toBeNull()
  })
})
