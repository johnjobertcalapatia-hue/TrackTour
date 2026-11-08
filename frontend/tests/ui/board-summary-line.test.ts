import { describe, expect, it } from 'vitest'
import { boardSummaryLine } from '@/features/rider/services/delivery-offers'

describe('manual board card line (dispatch Stage 3)', () => {
  it('reads like the spec for a multi-restaurant order', () => {
    expect(boardSummaryLine({ pickup_distance_km: 0.84, pickup_names: ['Restaurant C', 'Restaurant A'], items_count: 3, pickup_stops: 2 }))
      .toBe('0.8 km to first pickup · Restaurant C · 3 items · 2 pickup stops')
  })

  it('uses singular words for one item and one stop', () => {
    expect(boardSummaryLine({ pickup_distance_km: 2, pickup_names: ['Grill'], items_count: 1, pickup_stops: 1 }))
      .toBe('2.0 km to first pickup · Grill · 1 item · 1 pickup stop')
  })

  it('leaves the distance out when the rider has no GPS fix yet', () => {
    expect(boardSummaryLine({ pickup_distance_km: null, pickup_names: ['Grill', 'Cafe'], items_count: 4 }))
      .toBe('Grill · 4 items · 2 pickup stops')
  })
})
