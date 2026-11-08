import { describe, expect, it } from 'vitest'
import { pickupStopReasonLabel } from '@/features/rider/pickup-stops'

describe('rider pickup reasons (Stage B: COD paid before ready)', () => {
  it('tells the rider to pay the restaurant and wait for its confirmation', () => {
    expect(pickupStopReasonLabel('waiting_payment')).toBe('Pay the restaurant, then wait for it to confirm "Payment received".')
  })

  it('keeps the existing reasons', () => {
    expect(pickupStopReasonLabel('waiting_arrival')).toBe('Confirm arrival before pickup.')
    expect(pickupStopReasonLabel('waiting_ready')).toBe('The restaurant is still preparing your order.')
  })
})
