import { beforeEach, describe, expect, it } from 'vitest'
import { AxiosError } from 'axios'
import { apiErrorMessage } from '@/shared/services/api'
import {
  resolvePickupGate,
  COD_PICKUP_GATE_MESSAGE,
  isArrivalDismissed,
  markArrivalDismissed,
  type PickupGateInput,
} from '@/features/rider/gating'

describe('resolvePickupGate — full-collection gate for the pickup leg (COD + prepaid group orders)', () => {
  const gate = (input: PickupGateInput) => resolvePickupGate(input)

  it('blocks `picked_up` while a stops-bearing delivery in the pickup stage has uncollected restaurants', () => {
    expect(gate({ isPickupStage: true, hasStops: true, fullyCollected: false, stopsLoaded: true })).toEqual({
      blocked: true,
      message: COD_PICKUP_GATE_MESSAGE,
    })
  })

  it('blocks prepaid group orders too (the gate is stops-driven, not COD-only)', () => {
    expect(gate({ isPickupStage: true, hasStops: true, fullyCollected: false, stopsLoaded: true })).toEqual({
      blocked: true,
      message: COD_PICKUP_GATE_MESSAGE,
    })
  })

  it('never reveals the confirm while the stops payload is still loading', () => {
    expect(gate({ isPickupStage: true, hasStops: true, fullyCollected: false, stopsLoaded: false })).toEqual({
      blocked: true,
      message: null,
    })
  })

  it('opens the gate once every restaurant stop is collected', () => {
    expect(gate({ isPickupStage: true, hasStops: true, fullyCollected: true, stopsLoaded: true })).toEqual({
      blocked: false,
      message: null,
    })
  })

  it('never blocks a stops-less delivery (transport / single non-stop routes)', () => {
    expect(gate({ isPickupStage: true, hasStops: false, fullyCollected: false, stopsLoaded: true })).toEqual({
      blocked: false,
      message: null,
    })
  })

  it('never blocks outside the pickup stage (advanced legs are unaffected)', () => {
    expect(gate({ isPickupStage: false, hasStops: true, fullyCollected: false, stopsLoaded: false })).toEqual({
      blocked: false,
      message: null,
    })
  })
})

describe('arrival-alert dismissal persistence — must outlive a page refresh', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('nothing is dismissed by default', () => {
    expect(isArrivalDismissed(12, 'PICKUP')).toBe(false)
    expect(isArrivalDismissed(12, 'DROPOFF')).toBe(false)
  })

  it('records a dismissal and reads it back (survives a remount = refresh)', () => {
    markArrivalDismissed(12, 'PICKUP')
    expect(isArrivalDismissed(12, 'PICKUP')).toBe(true)
  })

  it('scopes dismissal to the delivery + leg', () => {
    markArrivalDismissed(12, 'PICKUP')
    expect(isArrivalDismissed(12, 'DROPOFF')).toBe(false)
    expect(isArrivalDismissed(13, 'PICKUP')).toBe(false)
  })
})

describe('apiErrorMessage — surfaces the server message so riders see why a status is rejected', () => {
  function failWith(message: string, status: number) {
    return new AxiosError(`Request failed with status code ${status}`, String(status), undefined, undefined, {
      status,
      statusText: 'error',
      headers: {},
      data: { success: false, message },
      config: {} as never,
    })
  }

  it('returns the Laravel JSON error body message verbatim', () => {
    expect(apiErrorMessage(failWith(COD_PICKUP_GATE_MESSAGE, 422))).toBe(COD_PICKUP_GATE_MESSAGE)
  })

  it('falls back to a generic message when the body has no readable message', () => {
    const err = new AxiosError('Network Error', AxiosError.ERR_NETWORK, undefined, {})
    expect(apiErrorMessage(err)).toBe('Request failed. Please try again.')
  })

  it('falls back for non-HTTP errors', () => {
    expect(apiErrorMessage(new Error('boom'))).toBe('Request failed. Please try again.')
  })

  it('honours a custom fallback', () => {
    expect(apiErrorMessage(new Error('boom'), 'Uh oh')).toBe('Uh oh')
  })
})