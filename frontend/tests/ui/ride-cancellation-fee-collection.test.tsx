import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: api.post, apiErrorMessage: (_e: unknown, f: string) => f }))
const pay = vi.hoisted(() => ({ checkout: vi.fn(), open: vi.fn() }))
vi.mock('@/shared/services/payment', async (orig) => ({ ...(await orig<typeof import('@/shared/services/payment')>()), createCheckoutSession: pay.checkout }))
vi.mock('@/shared/utils/external-redirect', () => ({ openExternalPage: pay.open }))

import CancellationFeeBanner, { CancellationFeeDueCard, OwedFeeLines, useOwedCancellationFees } from '@/features/tourist/components/ride/CancellationFeeBanner'
import CancellationPenaltyCard, { type CancellationPenalty } from '@/features/tourist/components/ride/CancellationPenaltyCard'
import RiderCancellationFeeCollect from '@/features/rider/components/RiderCancellationFeeCollect'

/** Stage C (2026-11-18): an owed ₱50 fee is paid on its own — online, or in cash to the next driver. */

const wrap = (ui: React.ReactNode) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>,
)

const OWED: CancellationPenalty = {
  id: 7, amount: 50, status: 'owed', rider_name: 'Aldrin Robledo', seconds_after_acceptance: 1018, review_reasons: [],
  disputed_at: null, dispute_reason: null, can_dispute: true, can_pay: true, order_number: 'TRP-6AFD5987F17B8', cancelled_order_id: 27,
}

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  api.post.mockResolvedValue({})
  pay.checkout.mockReset()
  pay.checkout.mockResolvedValue({ payment_number: 'PAY-1', checkout_url: 'https://checkout.paymongo.com/cs_fee' })
  pay.open.mockReset()
})

describe('Book a ride: cancellation fee banner', () => {
  it('an owed fee is added to this payment, or can be paid now (GCash or QR Ph)', async () => {
    api.get.mockResolvedValue({ penalties: [OWED], outstanding_total: 50 })
    wrap(<CancellationFeeBanner />)
    const banner = await screen.findByRole('alert', { name: 'Cancellation fee' })
    expect(banner).toHaveTextContent('You owe a ₱50.00 cancellation fee')
    expect(banner).toHaveTextContent('You cancelled ride TRP-6AFD5987F17B8 17 min after your driver accepted.')
    expect(banner).toHaveTextContent("It is added to this ride's payment (cash to your driver, or online)")

    await act(async () => { fireEvent.click(within(banner).getByRole('button', { name: 'Pay ₱50.00 now (GCash or QR Ph)' })) })
    await waitFor(() => expect(pay.checkout).toHaveBeenCalledWith('ride_penalty', 7, 'gcash'))
    expect(pay.open).toHaveBeenCalledWith('https://checkout.paymongo.com/cs_fee')
  })

  it('only owed fees are shown: paid or waived fees are not', async () => {
    api.get.mockResolvedValue({ penalties: [OWED, { ...OWED, id: 8, status: 'collected', can_pay: false }, { ...OWED, id: 9, status: 'waived', can_pay: false }], outstanding_total: 50 })
    wrap(<CancellationFeeBanner />)
    const banners = await screen.findAllByRole('alert', { name: 'Cancellation fee' })
    expect(banners).toHaveLength(1)
    expect(screen.queryByText(/under review|Tourism Office decides/)).toBeNull()
  })
})

describe('Cancelled ride: fee card', () => {
  it('owed: Pay now; paid: says how', async () => {
    const { rerender } = wrap(<CancellationPenaltyCard tripId={27} penalty={OWED} />)
    expect(screen.getByRole('button', { name: 'Pay ₱50.00 now (GCash or QR Ph)' })).toBeInTheDocument()

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><CancellationPenaltyCard tripId={27} penalty={{ ...OWED, status: 'collected', can_pay: false, can_dispute: false, collection_method: 'cash' }} /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('penalty-status')).toHaveTextContent('Paid')
    expect(screen.getByText('Paid in cash to your driver. Thank you.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pay/ })).toBeNull()
  })
})

describe('Next ride', () => {
  it('the tourist sees the unpaid fee and can pay it online', async () => {
    wrap(<CancellationFeeDueCard due={{ penalty_id: 7, amount: 50, from_ride: 'TRP-6AFD5987F17B8' }} />)
    const card = screen.getByRole('region', { name: 'Unpaid cancellation fee' })
    expect(card).toHaveTextContent('Unpaid cancellation fee: ₱50.00')
    expect(card).toHaveTextContent('give it to your driver in cash with the fare, or it is included when you pay online')
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: /Pay ₱50.00 now/ })) })
    expect(pay.checkout).toHaveBeenCalledWith('ride_penalty', 7, 'gcash')
  })

  it('the driver or rider collects it with the payment; it is not their earning', async () => {
    wrap(<RiderCancellationFeeCollect deliveryId={55} due={{ penalty_id: 7, amount: 50, from_ride: 'TRP-6AFD5987F17B8' }} />)
    const box = screen.getByTestId('ride-cancellation-fee')
    expect(box).toHaveTextContent('Also collect a ₱50.00 cancellation fee')
    expect(box).toHaveTextContent('It is not your earning: it goes to the driver who accepted that ride, so hand it in with your cash remittance.')
    await act(async () => { fireEvent.click(within(box).getByRole('button', { name: 'I collected ₱50.00 in cash' })) })
    expect(api.post).toHaveBeenCalledWith('/rider/deliveries/55/cancellation-fee/collect', { penalty_id: 7 })
  })
})

describe('Next payment breakdown (2026-11-23)', () => {
  function Breakdown({ fare }: { fare: number }) {
    const owed = useOwedCancellationFees()
    return (
      <div>
        <OwedFeeLines fees={owed.fees} />
        <p data-testid="total">{fare + owed.total}</p>
      </div>
    )
  }

  it('adds each owed fee as its own line and to the total; paid fees are left out', async () => {
    api.get.mockResolvedValue({ penalties: [OWED, { ...OWED, id: 8, status: 'collected', can_pay: false }], outstanding_total: 50 })
    wrap(<Breakdown fare={208.96} />)
    const line = await screen.findByTestId('owed-cancellation-fee')
    expect(line).toHaveTextContent('Cancellation fee (ride TRP-6AFD5987F17B8)')
    expect(line).toHaveTextContent('₱50.00')
    expect(screen.getAllByTestId('owed-cancellation-fee')).toHaveLength(1)
    expect(screen.getByTestId('total')).toHaveTextContent('258.96')
  })
})
