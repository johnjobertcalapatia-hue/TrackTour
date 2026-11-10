import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * Orders list (business owner), cash-on-delivery orders: the restaurant must
 * confirm "Payment received" from the rider before its food can be marked
 * ready (rider trip flow, Stage B; the server answers 422 otherwise). The list
 * used to offer "Mark Ready for Pickup" with no payment step and swallowed the
 * 422, so pressing it silently did nothing (reported 2026-11-09, order 7).
 */

vi.mock('@/shared/hooks/useBusinessSocketNotifier', () => ({
  useBusinessSocketNotifier: () => ({ connection: 'disconnected' }),
}))

const api = vi.hoisted(() => ({
  orders: [] as Record<string, unknown>[],
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
}))
vi.mock('@/shared/services/api', () => ({
  get: api.get,
  patch: api.patch,
  post: api.post,
  apiErrorMessage: (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback),
}))

import BusinessOwnerOrders from '@/features/business-owner/pages/BusinessOwnerOrders'

const ITEM = { id: 12, product_name: 'Pork Sisig', quantity: 1, unit_price: 200, total_price: 200, status: 'preparing', preparation_time: 10 }

function codOrder(purchase: Record<string, unknown>, over: Record<string, unknown> = {}) {
  return {
    id: 7,
    business_id: 2,
    order_number: 'ORD-7',
    customer_name: 'Tourist',
    order_type: 'delivery',
    payment_method: 'cash',
    status: 'preparing',
    total: 240,
    subtotal: 200,
    delivery_fee: 40,
    discount: 0,
    rider_tip: 0,
    created_at: '2026-11-09T01:00:00Z',
    items: [{ ...ITEM }],
    restaurant_purchases: [{ business_id: 2, status: 'pending', purchase_amount: 200, payment_confirmed_at: null, ...purchase }],
    ...over,
  }
}

async function openOrder() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><BusinessOwnerOrders /></MemoryRouter>
    </QueryClientProvider>,
  )
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /ORD-7/ })) })
}

beforeEach(() => {
  api.get.mockReset()
  api.patch.mockReset()
  api.post.mockReset()
  api.get.mockImplementation(async () => ({ data: api.orders }))
  api.patch.mockResolvedValue({})
  api.post.mockResolvedValue({})
})

describe('Orders list: COD "Payment received" before Mark Ready', () => {
  it('rider here, not yet paid: shows "Payment received" and locks Mark Ready', async () => {
    api.orders = [codOrder({ can_confirm_payment: true, rider_arrived_at: '2026-11-09T01:10:00Z' })]
    await openOrder()

    expect(screen.getByText('Awaiting rider payment')).toBeInTheDocument()
    expect(screen.getByText(/The rider is at your restaurant\. Collect ₱200\.00, then confirm\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark Ready for Pickup' })).toBeDisabled()
    expect(screen.getByText('Confirm "Payment received" from the rider first.')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Payment received' })) })
    expect(api.post).toHaveBeenCalledWith('/business-owner/orders/7/cod-payment-received', { business_id: 2 })
  })

  it('rider not here yet: no confirm button, Mark Ready stays locked', async () => {
    api.orders = [codOrder({ can_confirm_payment: false })]
    await openOrder()

    expect(screen.getByText(/Waiting for the rider to arrive and pay/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Payment received' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark Ready for Pickup' })).toBeDisabled()
  })

  it('payment confirmed: Mark Ready works', async () => {
    api.orders = [codOrder({ status: 'paid', payment_confirmed_at: '2026-11-09T01:12:00Z' })]
    await openOrder()

    const ready = screen.getByRole('button', { name: 'Mark Ready for Pickup' })
    expect(ready).toBeEnabled()
    await act(async () => { fireEvent.click(ready) })
    expect(api.patch).toHaveBeenCalledWith('/business-owner/orders/7/items/12/status', { status: 'ready' })
  })

  it('shows the server message when Mark Ready is refused (no more silent 422)', async () => {
    api.orders = [codOrder({ status: 'paid', payment_confirmed_at: '2026-11-09T01:12:00Z' })]
    api.patch.mockRejectedValue(new Error('Waiting for the rider\'s payment. Confirm "Payment received" before marking this food ready.'))
    await openOrder()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark Ready for Pickup' })) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Waiting for the rider\'s payment')
  })

  it('a GCash order has no payment panel and Mark Ready is open', async () => {
    api.orders = [codOrder({}, { payment_method: 'gcash', restaurant_purchases: [] })]
    await openOrder()

    expect(screen.queryByText('Rider Payment (Cash on Delivery)')).not.toBeInTheDocument()
    const card = screen.getByRole('button', { name: 'Mark Ready for Pickup' }).closest('div') as HTMLElement
    expect(within(card).getByRole('button', { name: 'Mark Ready for Pickup' })).toBeEnabled()
  })
})
