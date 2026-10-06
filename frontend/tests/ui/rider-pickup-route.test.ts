import { describe, expect, it } from 'vitest'
import { resolvePickupRoute, type ResolvePickupRouteInput } from '@/features/rider/pickup-route'

const rider: [number, number] = [12.86, 121.45]
const stopA = { sequence: 1, status: 'collected' as const, latitude: 12.87, longitude: 121.46 }
const stopB = { sequence: 2, status: 'pending' as const, latitude: 12.88, longitude: 121.47 }
const stopC = { sequence: 3, status: 'pending' as const, latitude: 12.89, longitude: 121.48 }

const base = (input: Partial<ResolvePickupRouteInput> = {}): ResolvePickupRouteInput => ({
  rider,
  isPickupLeg: true,
  isDropLeg: false,
  hasPickupStops: true,
  allCollected: false,
  stops: [stopA, stopB, stopC],
  finalPickup: { latitude: stopC.latitude, longitude: stopC.longitude },
  destination: { latitude: 12.9, longitude: 121.49 },
  fallbackPickup: { latitude: stopA.latitude, longitude: stopA.longitude },
  fallbackDestination: { latitude: 12.9, longitude: 121.49 },
  ...input,
})

describe('resolvePickupRoute — staged group-checkout pickup routing', () => {
  it('routes to the next unconsumed restaurant only (first non-collected in drive order)', () => {
    expect(resolvePickupRoute(base())).toEqual([
      rider,
      [stopB.latitude, stopB.longitude],
    ])
  })

  it('collecting a stop advances the route to the following restaurant', () => {
    const input = base({
      stops: [{ ...stopA, status: 'collected' }, { ...stopB, status: 'purchased' }, stopC],
    })
    expect(resolvePickupRoute(input)).toEqual([
      rider,
      [stopB.latitude, stopB.longitude],
    ])
  })

  it('routes to the LAST restaurant once only it remains', () => {
    const input = base({
      stops: [
        { ...stopA, status: 'collected' },
        { ...stopB, status: 'collected' },
        stopC,
      ],
    })
    expect(resolvePickupRoute(input)).toEqual([
      rider,
      [stopC.latitude, stopC.longitude],
    ])
  })

  it('switches to the drop-off route (final pickup → destination) once all food is collected', () => {
    const input = base({
      allCollected: true,
      stops: [stopA, stopB, stopC].map((s) => ({ ...s, status: 'collected' as const })),
    })
    expect(resolvePickupRoute(input)).toEqual([
      [stopC.latitude, stopC.longitude],
      [12.9, 121.49],
    ])
  })

  it('uses the last collected stop as the drop-off origin when finalPickup is missing', () => {
    const input = base({
      allCollected: true,
      finalPickup: null,
      destination: { latitude: 12.9, longitude: 121.49 },
      stops: [
        { ...stopA, status: 'collected' },
        { ...stopB, status: 'collected' },
        { ...stopC, status: 'collected' },
      ],
    })
    expect(resolvePickupRoute(input)).toEqual([
      [stopC.latitude, stopC.longitude],
      [12.9, 121.49],
    ])
  })

  it('does not draw a drop-off route while collected when the destination is unknown', () => {
    const input = base({ allCollected: true, destination: null, fallbackDestination: null })
    expect(resolvePickupRoute(input)).toEqual([])
  })

  it('keeps the drop-leg route after pickup completes (last restaurant → destination)', () => {
    const input = base({ isPickupLeg: false, isDropLeg: true, allCollected: true })
    expect(resolvePickupRoute(input)).toEqual([
      [stopC.latitude, stopC.longitude],
      [12.9, 121.49],
    ])
  })

  it('falls back to the delivery pickup point for single-point (no-stop) pickups', () => {
    const input = base({
      hasPickupStops: false,
      stops: [],
      finalPickup: null,
      destination: null,
    })
    expect(resolvePickupRoute(input)).toEqual([
      rider,
      [stopA.latitude, stopA.longitude],
    ])
  })

  it('falls back to the delivery drop-off point for the drop leg when destination is absent', () => {
    const input = base({
      isPickupLeg: false,
      isDropLeg: true,
      destination: null,
      fallbackDestination: { latitude: 12.95, longitude: 121.55 },
      finalPickup: null,
    })
    expect(resolvePickupRoute(input)).toEqual([
      [stopA.latitude, stopA.longitude],
      [12.95, 121.55],
    ])
  })

  it('returns no route when no coordinates are available', () => {
    expect(
      resolvePickupRoute(
        base({
          isPickupLeg: false,
          isDropLeg: true,
          finalPickup: null,
          destination: null,
          fallbackPickup: null,
          fallbackDestination: null,
        })
      )
    ).toEqual([])
  })

  it('returns no route outside pickup and drop legs', () => {
    expect(resolvePickupRoute(base({ isPickupLeg: false, isDropLeg: false }))).toEqual([])
  })

  it('returns no route when the next stop has no coordinates', () => {
    const input = base({ stops: [{ ...stopB, latitude: null, longitude: null }, stopC] })
    expect(resolvePickupRoute(input)).toEqual([])
  })

  it('treats zero coordinates as missing (backend null-coalesced to 0)', () => {
    const input = base({ stops: [{ ...stopB, latitude: 0, longitude: 0 }, stopC] })
    expect(resolvePickupRoute(input)).toEqual([])
  })

  it('never routes a drop leg from a zero-coordinate pickup origin', () => {
    const input = base({
      isPickupLeg: false,
      isDropLeg: true,
      allCollected: true,
      stops: [stopA, stopB, stopC].map((s) => ({ ...s, status: 'collected' as const })),
      finalPickup: { latitude: 0, longitude: 0 },
      destination: { latitude: 12.9, longitude: 121.49 },
    })
    expect(resolvePickupRoute(input)).toEqual([
      [stopC.latitude, stopC.longitude],
      [12.9, 121.49],
    ])
  })
})