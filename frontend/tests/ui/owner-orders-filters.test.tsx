import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f, default: { get: api.get } }))
vi.mock('@/shared/hooks/useBusinessSocketNotifier', () => ({ useBusinessSocketNotifier: () => ({ connection: 'idle' }) }))

import BusinessOwnerOrders from '@/features/business-owner/pages/BusinessOwnerOrders'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'

const order = (id: number, status: string) => ({
  id, order_number: `TT-${10000 + id}`, customer_name: `Customer ${id}`, status, order_type: 'delivery', payment_method: 'gcash',
  total: 100, subtotal: 100, delivery_fee: 0, created_at: '2026-11-23T10:00:00+08:00', items: [], delivery: null,
})
const counts = { all: 23, pending: 3, preparing: 2, ready: 1, picked_up: 0, on_the_way: 4, delivered: 0, completed: 10, cancelled: 3 }
const lastQuery = () => new URLSearchParams(String(api.get.mock.calls.at(-1)![0]).split('?')[1])

beforeEach(() => {
  api.get.mockReset()
  useBusinessOwnerStore.setState({ businesses: [], selectedBusinessId: 7 })
  api.get.mockImplementation((url: string) => {
    const q = new URLSearchParams(url.split('?')[1])
    const page = Number(q.get('page') ?? 1)
    return Promise.resolve({ data: [order(page * 10 + 1, q.get('status') === 'on_the_way' ? 'in_transit' : 'completed')], meta: { current_page: page, last_page: 3, total: 23, status_counts: counts } })
  })
})

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><BusinessOwnerOrders /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Orders filters', () => {
  it('shows a count on every chip and asks the server for the chosen status group', async () => {
    renderPage()
    const onTheWay = await screen.findByRole('button', { name: /On the Way\s*4/ })
    expect(screen.getByRole('button', { name: /^All\s*23$/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: /Out For Delivery/ })).toBeNull()

    fireEvent.click(onTheWay)
    await waitFor(() => expect(lastQuery().get('status')).toBe('on_the_way'))
    expect(lastQuery().get('business_id')).toBe('7')
    expect(lastQuery().get('page')).toBe('1')
  })

  it('searches after typing stops and pages through every order on the server', async () => {
    renderPage()
    await screen.findByText('Showing 1–8 of 23')

    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(lastQuery().get('page')).toBe('2'))
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument()

    vi.useFakeTimers({ shouldAdvanceTime: true })
    fireEvent.change(screen.getByLabelText('Search orders'), { target: { value: 'Maria' } })
    await act(async () => { vi.advanceTimersByTime(350) })
    vi.useRealTimers()
    await waitFor(() => expect(lastQuery().get('search')).toBe('Maria'))
    expect(lastQuery().get('page')).toBe('1')
  })

  it('offers to clear filters when nothing matches', async () => {
    renderPage()
    await screen.findByText('Showing 1–8 of 23')
    api.get.mockImplementation(() => Promise.resolve({ data: [], meta: { current_page: 1, last_page: 1, total: 0, status_counts: { ...counts, ready: 0 } } }))

    fireEvent.click(screen.getByRole('button', { name: /^Ready/ }))
    expect(await screen.findByText('No orders match these filters.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(lastQuery().get('status')).toBeNull())
  })
})
