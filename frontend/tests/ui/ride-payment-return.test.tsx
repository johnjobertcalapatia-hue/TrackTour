import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * GCash for rides (2026-11-18): PayMongo's success page and its "Return to
 * merchant" link come back to the RIDE (not a food order), with ride wording;
 * the tourist's ride shows "You've arrived" until the driver confirms the
 * payment and completes the ride.
 */

const pay = vi.hoisted(() => ({ check: vi.fn() }))
vi.mock('@/shared/services/payment', () => ({ checkAndConfirmPayment: pay.check, createCheckoutSession: vi.fn() }))

import PaymentCallbackPage from '@/features/tourist/pages/PaymentCallbackPage'
import { CompletedScreen } from '@/features/tourist/components/ride/RidePhases'

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>
}

function renderReturn(query: string) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/payment/callback?${query}`]}>
        <Routes>
          <Route path="/payment/callback" element={<PaymentCallbackPage />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => pay.check.mockReset())
afterEach(() => vi.useRealTimers())

describe('Ride GCash return page', () => {
  it('success: ride wording, then back to the ride tracking page (not a food order)', async () => {
    pay.check.mockResolvedValue({ payment_number: 'PAY-1', status: 'paid', amount: 83.36, method: 'gcash', paid_at: null, payable_type: 'order', order_id: 18, order_type: 'transport' })
    renderReturn('payment_number=PAY-1&status=success&payable_type=order&payable_id=18&kind=ride')

    expect(await screen.findByText('Payment Successful!')).toBeInTheDocument()
    expect(screen.getByText('Your GCash payment for the ride has been received. Your driver will confirm it and complete the ride.')).toBeInTheDocument()
    expect(screen.queryByText(/rider to accept your order/)).toBeNull()
    expect(screen.getByText(/Returning to your ride in/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Back to your ride/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/tourist/transport/tracking/18')
  })

  it('success redirects to the ride by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    pay.check.mockResolvedValue({ payment_number: 'PAY-1', status: 'paid', amount: 83.36, method: 'gcash', paid_at: null, payable_type: 'order', order_id: 18, order_type: 'transport' })
    renderReturn('payment_number=PAY-1&status=success&payable_type=order&payable_id=18')
    await screen.findByText('Payment Successful!')
    for (let i = 0; i < 7; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    }
    expect(screen.getByTestId('location')).toHaveTextContent('/tourist/transport/tracking/18')
  })

  it('"Return to merchant" (cancelled): not charged, back to the ride to pay or pay cash', async () => {
    pay.check.mockResolvedValue({ payment_number: 'PAY-2', status: 'pending', amount: 83.36, method: 'gcash', paid_at: null, payable_type: 'order', order_id: 18, order_type: 'transport' })
    renderReturn('payment_number=PAY-2&status=cancelled&payable_type=order&payable_id=18&kind=ride')

    expect(await screen.findByText('Payment Cancelled')).toBeInTheDocument()
    expect(screen.getByText(/Your ride has not been paid yet, and you were not charged/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Browse Food/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Back to your ride/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/tourist/transport/tracking/18')
  })

  it('a food order still returns to the food order page', async () => {
    pay.check.mockResolvedValue({ payment_number: 'PAY-3', status: 'paid', amount: 300, method: 'gcash', paid_at: null, payable_type: 'order', order_id: 40, order_type: 'delivery' })
    renderReturn('payment_number=PAY-3&status=success&payable_type=order&payable_id=40')
    fireEvent.click(await screen.findByRole('button', { name: /View Order Status/ }))
    expect(screen.getByTestId('location')).toHaveTextContent('/tourist/orders/40/track')
  })
})

describe('Ride at the drop-off (tourist)', () => {
  const base = {
    fare: 83.36, driverName: 'Aldrin Robledo', alreadyRated: false, rating: null, allowedTags: [],
    onSubmitReview: vi.fn(), submitting: false,
  }

  it("unpaid GCash: \"You've arrived\", Pay now, no rating yet", () => {
    const onPay = vi.fn()
    render(<CompletedScreen {...base} atDropOff paymentLabel="Payment due via GCash" paid={false} onPay={onPay} />)
    expect(screen.getByRole('heading', { name: "You've arrived!" })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Pay now so your driver can confirm your payment and complete the ride.')
    expect(screen.getByText(/You can rate Aldrin once the ride is completed/)).toBeInTheDocument()
    expect(screen.queryByRole('radiogroup', { name: 'Rating' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pay now' }))
    expect(onPay).toHaveBeenCalled()
  })

  it('paid: waiting for the driver to confirm; switched to cash: pay the driver', () => {
    const { rerender } = render(<CompletedScreen {...base} atDropOff paymentLabel="Paid via GCash" paid />)
    expect(screen.getByRole('status')).toHaveTextContent('Payment received. Your driver will confirm it and complete the ride.')

    rerender(<CompletedScreen {...base} atDropOff switchedToCash paymentLabel="Pay your driver in cash" paid />)
    expect(screen.getByRole('status')).toHaveTextContent('Your driver switched this ride to cash. Pay ₱83.36 in cash')
  })

  it('completed: "Ride Completed!" and the rating opens', () => {
    render(<CompletedScreen {...base} paymentLabel="Paid via GCash" paid />)
    expect(screen.getByRole('heading', { name: 'Ride Completed!' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Rating' })).toBeInTheDocument()
  })
})
