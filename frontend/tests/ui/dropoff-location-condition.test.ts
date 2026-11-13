import { describe, expect, it } from 'vitest'
import { allMet, deliveryConditions, withDropoffLocation, withSavedLocation } from '@/features/rider/trip-steps'

/**
 * Food drop-off location line (owner decision 2026-11-12): when the server
 * refused to SAVE a fix for precision, the phone's own fix still counts up
 * to ±200 m — the doorway case that kept Confirm Delivered locked at 29 m.
 */
describe('withDropoffLocation', () => {
  const ready = deliveryConditions(29, true, true) // within 50 m + photo submitted

  it('unlocks with the ±150 m DevTools default (no refusal sent)', () => {
    expect(allMet(withDropoffLocation(ready, null, 150))).toBe(true)
    expect(allMet(withDropoffLocation(ready, 'low_accuracy', 150))).toBe(true)
  })

  it('unlocks Confirm Delivered with a ±80 m phone fix', () => {
    const checks = withDropoffLocation(ready, 'low_accuracy', 80)
    expect(checks.at(-1)).toEqual({ label: 'Location checked from your phone (±80 m)', met: true })
    expect(allMet(checks)).toBe(true)
  })

  it('still blocks past ±200 m, saying what to do', () => {
    const checks = withDropoffLocation(ready, 'low_accuracy', 260)
    expect(checks.at(-1)?.met).toBe(false)
    expect(checks.at(-1)?.label).toContain('now ±260 m; needs ±200 m or better')
    expect(allMet(checks)).toBe(false)
  })

  it('blocks past ±200 m even when the server sent no refusal (rider standing still)', () => {
    const checks = withDropoffLocation(ready, null, 249)
    expect(checks.at(-1)).toMatchObject({ met: false })
    expect(checks.at(-1)?.label).toContain('now ±249 m')
    expect(allMet(checks)).toBe(false)
  })

  it('blocks when the precision is unknown', () => {
    expect(allMet(withDropoffLocation(ready, 'low_accuracy', null))).toBe(false)
  })

  it('keeps the teleport refusal and adds nothing when the fix was saved', () => {
    expect(withDropoffLocation(ready, 'implausible_movement', 10)).toEqual(withSavedLocation(ready, 'implausible_movement'))
    expect(withDropoffLocation(ready, null, 80)).toEqual(ready)
  })
})
