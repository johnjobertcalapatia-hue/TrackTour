import { describe, expect, it } from 'vitest'
import {
  bearingBetween,
  RiderHeadingController,
  shortestHeadingDelta,
  type RiderHeadingFix,
} from '@/shared/utils/rider-heading'

class TestAnimationClock {
  now = 0
  private nextId = 1
  private callbacks = new Map<number, FrameRequestCallback>()

  requestFrame = (callback: FrameRequestCallback): number => {
    const id = this.nextId++
    this.callbacks.set(id, callback)
    return id
  }

  cancelFrame = (id: number): void => {
    this.callbacks.delete(id)
  }

  advance(milliseconds: number): void {
    this.now += milliseconds
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    callbacks.forEach((callback) => callback(this.now))
  }

  get pendingFrames(): number {
    return this.callbacks.size
  }
}

function fix(overrides: Partial<RiderHeadingFix> = {}): RiderHeadingFix {
  return {
    latitude: 0,
    longitude: 0,
    heading: 90,
    speed: 2,
    accuracy: 5,
    timestamp: 1000,
    ...overrides,
  }
}

describe('rider heading utilities', () => {
  it('uses the shortest rotation when heading crosses north', () => {
    expect(shortestHeadingDelta(359, 0)).toBe(1)
    expect(shortestHeadingDelta(1, 359)).toBe(-2)
  })

  it('calculates bearing from consecutive GPS positions', () => {
    expect(bearingBetween(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0.001 },
    )).toBeCloseTo(90, 4)
  })
})

describe('RiderHeadingController', () => {
  it('crosses from 359 degrees through north instead of rotating backwards', () => {
    const clock = new TestAnimationClock()
    const controller = new RiderHeadingController({
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      now: () => clock.now,
    })
    const arrow = document.createElement('span')
    controller.attach(arrow)
    controller.update(fix({ heading: 359 }))
    for (let frame = 0; frame < 30; frame += 1) clock.advance(16)

    controller.update(fix({ heading: 4, timestamp: 1400 }))
    const angles: number[] = []
    for (let frame = 0; frame < 30 && clock.pendingFrames > 0; frame += 1) {
      clock.advance(16)
      angles.push(Number.parseFloat(arrow.style.transform.match(/-?[\d.]+/)?.[0] ?? '0'))
    }

    expect(angles.some((angle) => angle > 0)).toBe(true)
    expect(angles.every((angle) => angle > -2 && angle < 2)).toBe(true)
    controller.destroy()
  })

  it('smoothly interpolates slow and sharp turns without long-way rotation', () => {
    const clock = new TestAnimationClock()
    const controller = new RiderHeadingController({
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      now: () => clock.now,
    })
    const arrow = document.createElement('span')
    controller.attach(arrow)

    controller.update(fix({ heading: 80 }))
    for (let frame = 0; frame < 8; frame += 1) clock.advance(16)
    const initialAngle = Number.parseFloat(arrow.style.transform.match(/-?[\d.]+/)?.[0] ?? '0')
    expect(initialAngle).toBeGreaterThan(0)
    expect(initialAngle).toBeLessThan(80)

    controller.update(fix({ heading: 100, timestamp: 1200 }))
    const beforeSlowTurnFrame = Number.parseFloat(arrow.style.transform.match(/-?[\d.]+/)?.[0] ?? '0')
    clock.advance(16)
    const afterSlowTurnFrame = Number.parseFloat(arrow.style.transform.match(/-?[\d.]+/)?.[0] ?? '0')
    expect(Math.abs(afterSlowTurnFrame - beforeSlowTurnFrame)).toBeLessThan(30)

    controller.update(fix({ heading: 250, timestamp: 1500 }))
    const beforeSharpTurn = Number.parseFloat(arrow.style.transform.match(/-?[\d.]+/)?.[0] ?? '0')
    clock.advance(16)
    const afterSharpTurn = Number.parseFloat(arrow.style.transform.match(/-?[\d.]+/)?.[0] ?? '0')
    expect(Math.abs(afterSharpTurn - beforeSharpTurn)).toBeLessThan(30)

    controller.destroy()
    expect(clock.pendingFrames).toBe(0)
  })

  it('filters small heading noise and retains heading while stationary', () => {
    const clock = new TestAnimationClock()
    const controller = new RiderHeadingController({
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      now: () => clock.now,
    })
    const arrow = document.createElement('span')
    controller.attach(arrow)
    controller.update(fix({ heading: 90 }))
    for (let frame = 0; frame < 30; frame += 1) clock.advance(16)
    const settledTransform = arrow.style.transform

    controller.update(fix({ heading: 91, timestamp: 1200 }))
    controller.update(fix({ heading: 90, timestamp: 1400 }))
    controller.update(fix({ heading: 91, timestamp: 1600 }))
    expect(arrow.style.transform).toBe(settledTransform)

    controller.update(fix({ heading: 180, speed: 0, timestamp: 1800 }))
    expect(arrow.style.transform).toBe(settledTransform)
    controller.destroy()
  })

  it('falls back to accurate position bearing when heading is unavailable', () => {
    const clock = new TestAnimationClock()
    const controller = new RiderHeadingController({
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      now: () => clock.now,
    })
    const arrow = document.createElement('span')
    controller.attach(arrow)
    controller.update(fix({ latitude: 0, longitude: 0, heading: null }))
    controller.update(fix({
      latitude: 0,
      longitude: 0.001,
      heading: null,
      timestamp: 1400,
    }))

    expect(clock.pendingFrames).toBe(1)
    for (let frame = 0; frame < 30; frame += 1) clock.advance(16)
    const angle = Number.parseFloat(arrow.style.transform.match(/-?[\d.]+/)?.[0] ?? '0')
    expect(angle).toBeGreaterThan(0)
    controller.destroy()
  })

  it('ignores inaccurate GPS positions and unreliable heading readings', () => {
    const clock = new TestAnimationClock()
    const controller = new RiderHeadingController({
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      now: () => clock.now,
    })
    const arrow = document.createElement('span')
    controller.attach(arrow)
    controller.update(fix({ heading: 90, accuracy: 80 }))

    expect(clock.pendingFrames).toBe(0)
    expect(arrow.style.transform).toBe('rotate(0deg)')
    controller.destroy()
  })

  it('preserves the last heading when slow GPS drift looks like movement', () => {
    const clock = new TestAnimationClock()
    const controller = new RiderHeadingController({
      requestFrame: clock.requestFrame,
      cancelFrame: clock.cancelFrame,
      now: () => clock.now,
    })
    const arrow = document.createElement('span')
    controller.attach(arrow)
    controller.update(fix({ heading: 90 }))
    for (let frame = 0; frame < 30; frame += 1) clock.advance(16)
    const settledTransform = arrow.style.transform

    controller.update(fix({
      longitude: 0.00011,
      heading: null,
      speed: null,
      timestamp: 21_000,
    }))

    expect(arrow.style.transform).toBe(settledTransform)
    expect(clock.pendingFrames).toBe(0)
    controller.destroy()
  })
})
