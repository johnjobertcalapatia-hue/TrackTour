import { describe, expect, it } from 'vitest'
import { isUsableGpsFix } from '@/features/rider/gps'
import { formatDistance } from '@/features/rider/trip-steps'

describe('rider GPS fixes', () => {
  it('refuses a reading missing an axis (exact 0) or out of range', () => {
    expect(isUsableGpsFix(12.9604387, 0)).toBe(false) // production 2026-11-10
    expect(isUsableGpsFix(0, 121.4676283)).toBe(false)
    expect(isUsableGpsFix(Number.NaN, 121.4)).toBe(false)
    expect(isUsableGpsFix(95, 121.4)).toBe(false)
    expect(isUsableGpsFix(12.9604387, 121.4676283)).toBe(true)
  })

  it('reads distances in m, km, then whole km with separators', () => {
    expect(formatDistance(42.4)).toBe('42 m')
    expect(formatDistance(1500)).toBe('1.5 km')
    expect(formatDistance(12948945)).toBe('12,949 km')
  })
})
