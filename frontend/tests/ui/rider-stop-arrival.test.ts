import { describe, expect, it } from 'vitest'
import {
  haversineMeters,
  formatStopDistance,
  resolveStopArrival,
  STOP_ARRIVAL_THRESHOLD_METERS,
  type ArrivalStop,
} from '@/features/rider/stop-arrival'

const stop1: ArrivalStop = { id: 1, sequence: 1, status: 'collected', latitude: 12.87, longitude: 121.46, business_name: 'A' }
const stop2: ArrivalStop = { id: 2, sequence: 2, status: 'pending', latitude: 12.88, longitude: 121.47, business_name: 'B' }
const stop3: ArrivalStop = { id: 3, sequence: 3, status: 'pending', latitude: 12.89, longitude: 121.48, business_name: 'C' }

describe('haversineMeters', () => {
  it('returns ~0 for identical coordinates', () => {
    expect(haversineMeters(12.87, 121.46, 12.87, 121.46)).toBeLessThan(1)
  })

  it('returns ~111 km per degree of latitude', () => {
    const d = haversineMeters(12, 121, 13, 121)
    expect(d).toBeGreaterThan(110_000)
    expect(d).toBeLessThan(112_000)
  })
})

describe('formatStopDistance', () => {
  it('formats meters', () => {
    expect(formatStopDistance(350)).toBe('~350 m')
    expect(formatStopDistance(999)).toBe('~999 m')
  })

  it('formats kilometers', () => {
    expect(formatStopDistance(1234)).toBe('~1.2 km')
    expect(formatStopDistance(12000)).toBe('~12.0 km')
  })

  it('returns empty for null', () => {
    expect(formatStopDistance(null)).toBe('')
  })
})

describe('resolveStopArrival — stop-level arrival detection', () => {
  it('targets the FIRST unconsumed stop in drive order', () => {
    const result = resolveStopArrival({
      riderLatitude: 12.86,
      riderLongitude: 121.45,
      stops: [stop1, stop2, stop3],
    })
    expect(result.activeStop?.id).toBe(stop2.id)
  })

  it('is not arrived when the rider is beyond the threshold', () => {
    const far = haversineMeters(12.86, 121.45, stop2.latitude!, stop2.longitude!)
    const result = resolveStopArrival({
      riderLatitude: 12.86,
      riderLongitude: 121.45,
      stops: [stop1, stop2],
    })
    expect(far).toBeGreaterThan(STOP_ARRIVAL_THRESHOLD_METERS)
    expect(result.distanceMeters).toBeCloseTo(far, 0)
    expect(result.arrived).toBe(false)
  })

  it('is arrived within the threshold, staying arrived while at the stop', () => {
    const at = resolveStopArrival({ riderLatitude: 12.88, riderLongitude: 121.47, stops: [stop1, stop2] })
    const still = resolveStopArrival({ riderLatitude: 12.88, riderLongitude: 121.47, stops: [stop1, stop2] })
    expect(at.arrived).toBe(true)
    expect(still.arrived).toBe(true)
  })

  it('does not re-trigger arrival for a collected stop (advances to the next)', () => {
    const result = resolveStopArrival({
      riderLatitude: 12.87,
      riderLongitude: 121.46,
      stops: [stop1, stop3],
    })
    expect(result.activeStop?.id).toBe(stop3.id)
    expect(result.activeStop?.id).not.toBe(stop1.id)
  })

  it('never blocks collection when the active stop has no coordinates', () => {
    const result = resolveStopArrival({
      riderLatitude: 12.86,
      riderLongitude: 121.45,
      stops: [{ ...stop2, latitude: null, longitude: null }],
    })
    expect(result.distanceMeters).toBe(null)
    expect(result.arrived).toBe(true)
  })

  it('returns no active stop when every stop is collected', () => {
    const result = resolveStopArrival({
      riderLatitude: 12.86,
      riderLongitude: 121.45,
      stops: [stop1, { ...stop2, status: 'collected' }, { ...stop3, status: 'collected' }],
    })
    expect(result).toEqual({ activeStop: null, distanceMeters: null, arrived: false })
  })

  it('returns no active stop when stops is empty', () => {
    const result = resolveStopArrival({ riderLatitude: 12.86, riderLongitude: 121.45, stops: [] })
    expect(result.activeStop).toBe(null)
    expect(result.arrived).toBe(false)
  })
})