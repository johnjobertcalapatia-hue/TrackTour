import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RideWaitingStep, { waitingFee } from '@/features/rider/components/RideWaitingStep'
import PickupWaitingCard from '@/features/tourist/components/ride/PickupWaitingCard'
import TripReceipt from '@/features/tourist/components/TripReceipt'
import type { PickupWaiting } from '@/features/rider/context/RiderActiveTripContext'

/**
 * Pickup waiting (owner decisions 2026-11-18): the rider confirms arrival,
 * the waiting time runs from that SERVER time — first 3 minutes free, then
 * ₱2 per full 3 minutes — and the fee is itemised.
 */

const rule = { free_seconds: 180, unit_seconds: 180, rate: 2 }
const waitingFor = (seconds: number, extra: Partial<PickupWaiting> = {}): PickupWaiting => ({
  ...rule,
  server_now: '2026-11-18T01:10:00Z',
  arrived_at: new Date(Date.parse('2026-11-18T01:10:00Z') - seconds * 1000).toISOString(),
  ended_at: null,
  charged_seconds: null,
  amount: null,
  ...extra,
})

afterEach(() => vi.useRealTimers())

describe('waiting fee rule (same as the server)', () => {
  it('free for 180 s, then ₱2 per completed 180 s', () => {
    expect([179, 180, 359, 360, 539, 540].map((s) => waitingFee(s, rule))).toEqual([0, 0, 0, 2, 2, 4])
  })
})

describe('Rider pickup step', () => {
  it('before arrival: explains that confirming starts the waiting time', () => {
    render(<RideWaitingStep awaitingArrival passenger="Jayvie De Torres" waiting={null} />)
    expect(screen.getByTestId('ride-arrival-step')).toHaveTextContent("You're at Jayvie De Torres's pickup point. Tap I've Arrived")
    expect(screen.getByTestId('ride-arrival-step')).toHaveTextContent('First 3 minutes free, then ₱2 per full 3 minutes.')
  })

  it('after arrival: a timer from the server arrival time, free first, then the fee so far', () => {
    const { rerender } = render(<RideWaitingStep awaitingArrival={false} passenger={null} waiting={waitingFor(100)} />)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting 01:40')
    expect(screen.getByRole('status')).toHaveTextContent('Free')

    rerender(<RideWaitingStep awaitingArrival={false} passenger={null} waiting={waitingFor(400)} />)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting 06:40')
    expect(screen.getByRole('status')).toHaveTextContent('₱2.00 so far')
  })

  it("a wrong phone clock does not change the waiting time", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2031-01-01T00:00:00Z')) // device clock years off
    render(<RideWaitingStep awaitingArrival={false} passenger={null} waiting={waitingFor(100)} />)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting 01:40')
  })
})

describe('Tourist pickup waiting', () => {
  it('"has arrived and is waiting", the rule, and the free time left', () => {
    render(<PickupWaitingCard waiting={waitingFor(100)} driverName="Aldrin Robledo" />)
    const card = screen.getByRole('status', { name: 'Pickup waiting' })
    expect(card).toHaveTextContent('Aldrin has arrived and is waiting')
    expect(card).toHaveTextContent('First 3 minutes free, then ₱2.00 for every full 3 minutes')
    expect(card).toHaveTextContent('01:40')
    expect(card).toHaveTextContent('Free for 01:20')
  })

  it('once on board: the waiting time and fee that were charged', () => {
    render(<PickupWaitingCard waiting={waitingFor(0, { ended_at: '2026-11-18T01:19:00Z', charged_seconds: 540, amount: 4 })} driverName="Aldrin Robledo" />)
    const card = screen.getByRole('status', { name: 'Pickup waiting' })
    expect(card).toHaveTextContent('09:00')
    expect(card).toHaveTextContent('₱4.00')
    expect(card).not.toHaveTextContent('so far')
  })

  it('the receipt itemises the waiting fee', () => {
    render(
      <TripReceipt orderNumber="TRP-1" completedLabel="" distanceKm={3.2} baseFare={40} distanceFare={44.41} serviceFee={0} total={88.41}
        estimateFare={84.41} paymentMethod="cash" paymentStatus="paid" paidAmount={88.41}
        additionalCharges={[{ id: 1, label: 'Pickup waiting', amount: 4, duration_seconds: 540 }]} />,
    )
    expect(screen.getByText('Pickup waiting (9 min 0 s)').nextSibling).toHaveTextContent('₱4.00')
  })
})
