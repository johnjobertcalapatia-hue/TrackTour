import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { buildOsrmUrl, useOsrmRoute } from '@/features/rider/hooks/useOsrmRoute'

afterEach(() => {
  vi.unstubAllGlobals()
})

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

  it('refetches immediately when the destination changes without rider movement', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        routes: [{
          geometry: { coordinates: [[121.45, 12.86], [121.46, 12.87]] },
          distance: 1000,
          duration: 600,
        }],
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const rider: [number, number] = [12.86, 121.45]
    const pickup: [number, number] = [12.87, 121.46]
    const destination: [number, number] = [12.9, 121.49]
    const { rerender } = renderHook(
      ({ waypoints }) => useOsrmRoute(waypoints, true),
      { initialProps: { waypoints: [rider, pickup] } }
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    await act(async () => {
      rerender({ waypoints: [rider, destination] })
    })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1]?.[0]).toContain('121.49,12.9')
  })
})