import { describe, expect, it } from 'vitest'
import { buildOsrmUrl } from '@/features/rider/hooks/useOsrmRoute'

describe('buildOsrmUrl — never send OSRM a garbage route', () => {
  it('builds the lng,lat polyline URL for valid waypoints', () => {
    expect(buildOsrmUrl([[12.86, 121.45], [12.87, 121.46]])).toBe(
      'https://router.project-osrm.org/route/v1/cycling/121.45,12.86;121.46,12.87?overview=full&geometries=geojson'
    )
  })

  it('rejects an unset 0,0 coordinate anywhere in the route', () => {
    expect(buildOsrmUrl([[0, 0], [12.87, 121.46]])).toBeNull()
    expect(buildOsrmUrl([[12.86, 121.45], [0, 0]])).toBeNull()
  })

  it('rejects out-of-range and non-finite coordinates', () => {
    expect(buildOsrmUrl([[NaN, 121.45], [12.87, 121.46]])).toBeNull()
    expect(buildOsrmUrl([[200, 121.45], [12.87, 121.46]])).toBeNull()
    expect(buildOsrmUrl([[12.86, 121.45], [99, 121.46]])).toBeNull()
  })

  it('requires at least two waypoints', () => {
    expect(buildOsrmUrl([[12.86, 121.45]])).toBeNull()
    expect(buildOsrmUrl([])).toBeNull()
  })
})