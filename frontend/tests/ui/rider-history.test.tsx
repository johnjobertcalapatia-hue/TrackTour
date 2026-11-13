import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import RiderHistory from '@/features/rider/pages/RiderHistory'

const food = [
  { id: 9, order_id: 9, order_number: 'TT-23255', type: 'food', customer_name: 'Jayvie De Torres', business_name: 'Ekslusibo Grill and Restaurant',
    pickup_address: 'Pag-asa', delivery_address: 'Kawit, Gloria', status: 'completed', payment_method: 'gcash', is_cod: false,
    total_amount: 1956.1, earning: 40, completed_at: '2026-11-11T02:51:00Z' },
  { id: 7, order_id: 7, order_number: 'TT-99006', type: 'food', customer_name: 'Jayvie De Torres', business_name: 'Ekslusibo Grill and Restaurant',
    pickup_address: 'Pag-asa', delivery_address: 'Bansud', status: 'completed', payment_method: 'cash', is_cod: true,
    total_amount: 602, earning: 40, completed_at: '2026-11-09T13:33:43Z' },
]
const rides = [
  { id: 13, order_id: 13, order_number: 'TRP-6AF362EB5E076', type: 'ride', customer_name: 'Jayvie De Torres', business_name: null,
    pickup_address: 'Gloria, Oriental Mindoro', delivery_address: 'Pag-asa, Bansud', status: 'completed', payment_method: 'cash', is_cod: true,
    total_amount: 211.36, earning: 84.54, completed_at: '2026-11-11T02:43:06Z' },
]

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RiderHistory />
    </QueryClientProvider>,
  )
}

describe('Rider History', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.get.mockImplementation((_url: string, config: { params: { type: string; page: number } }) =>
      Promise.resolve({
        data: config.params.type === 'ride' ? rides : food,
        meta: { current_page: 1, last_page: 1, total: config.params.type === 'ride' ? 1 : 2 },
      }),
    )
  })

  it('Deliveries lists food orders with number, customer, restaurant, payment, total and earning', async () => {
    renderPage()
    const table = await screen.findByRole('table', { name: 'Completed deliveries' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    const first = within(rows[0]!)
    expect(first.getByText('TT-23255')).toBeInTheDocument()
    expect(first.getByText('Jayvie De Torres')).toBeInTheDocument()
    expect(first.getByText('Ekslusibo Grill and Restaurant')).toBeInTheDocument()
    expect(first.getByText('Online')).toBeInTheDocument()
    expect(first.getByText('₱1,956.10')).toBeInTheDocument()
    expect(first.getByText('₱40.00')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('COD')).toBeInTheDocument()
    expect(screen.queryByText('TRP-6AF362EB5E076')).toBeNull()
    expect(api.get).toHaveBeenCalledWith('/rider/deliveries/completed', { params: { type: 'food', page: 1 } })
  })

  it('Ride Hailing (spelled right) lists bookings with passenger, route, cash fare and earning', async () => {
    renderPage()
    await screen.findByRole('table', { name: 'Completed deliveries' })
    expect(screen.queryByText('Rider Hailing')).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: /Ride Hailing/ }))

    const table = await screen.findByRole('table', { name: 'Completed rides' })
    const row = within(within(table).getAllByRole('row')[1]!)
    expect(row.getByText('TRP-6AF362EB5E076')).toBeInTheDocument()
    expect(row.getByText('Gloria, Oriental Mindoro → Pag-asa, Bansud')).toBeInTheDocument()
    expect(row.getByText('Cash')).toBeInTheDocument()
    expect(row.getByText('₱211.36')).toBeInTheDocument()
    expect(row.getByText('₱84.54')).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Fare' })).toBeInTheDocument()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/rider/deliveries/completed', { params: { type: 'ride', page: 1 } }))
  })

  it('pages come from the server', async () => {
    api.get.mockImplementation((_url: string, config: { params: { type: string; page: number } }) =>
      Promise.resolve({ data: food, meta: { current_page: config.params.page, last_page: 3, total: 32 } }),
    )
    renderPage()
    expect(await screen.findByText('Page 1 of 3 · 32 deliveries')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/rider/deliveries/completed', { params: { type: 'food', page: 2 } }))
  })
})
