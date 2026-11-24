import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, apiErrorMessage: (_e: unknown, f: string) => f, default: { get: api.get } }))
vi.mock('recharts', async (orig) => {
  const mod = await orig<typeof import('recharts')>()
  return { ...mod, ResponsiveContainer: ({ children }: { children: React.ReactElement }) => <div style={{ width: 600, height: 300 }}>{children}</div> }
})

import BusinessOwnerReports from '@/features/business-owner/pages/BusinessOwnerReports'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'

/**
 * Reports & Analytics (redesign, 2026-11-23). The old Period select (weekly /
 * monthly / yearly) became a date-range preset (Last 30 Days by default, or a
 * custom Date From / Date To); every panel reads GET reports/overview.
 */
const overviewCalls = () => api.get.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('/reports/overview'))
const lastQuery = () => new URLSearchParams(overviewCalls().at(-1)!.split('?')[1])

const overview = {
  range: { from: '2026-10-25', to: '2026-11-23', days: 30, previous_from: '2026-09-25', previous_to: '2026-10-24' },
  kpis: {
    orders: { value: 247, previous: 220, change: 12.3 },
    revenue: { value: 48750, previous: 42391, change: 15 },
    earnings: { value: 38920, previous: 40000, change: -2.7, expenses: 9830 },
    rating: { value: 4.8, count: 124, new_in_range: 9 },
  },
  series: [
    { date: '2026-11-22', label_to: null, orders: 8, revenue: 1600, earnings: 1500, previous_orders: 6, previous_revenue: 1200, previous_earnings: 1100 },
    { date: '2026-11-23', label_to: null, orders: 10, revenue: 2100, earnings: 2000, previous_orders: 7, previous_revenue: 1400, previous_earnings: 1300 },
  ],
  breakdown: [{ label: 'Week 1', from: '2026-10-25', to: '2026-10-31', revenue: 9000, previous_revenue: 8000 }],
  top_items: [{ offering_id: 1, name: 'Chicken BBQ', quantity: 68, orders: 51, revenue: 6800, image: null }],
  orders_by_status: { total: 200, groups: [{ key: 'completed', count: 150 }, { key: 'in_progress', count: 20 }, { key: 'pending', count: 20 }, { key: 'cancelled', count: 10 }] },
  bookings: { total: 0, revenue: 0, by_status: [] },
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date('2026-11-23T04:00:00Z')) // noon in Manila
  api.get.mockReset()
  useBusinessOwnerStore.setState({ businesses: [], selectedBusinessId: null })
  api.get.mockImplementation((url: string) => Promise.resolve(
    // GET /businesses: get() returns the list itself (no `.data`).
    url.includes('/businesses') ? [
      { id: 7, name: 'Ekslusibo Grill', category: 'Restaurant' },
      { id: 9, name: 'Aplaya Resort', category: 'Resort' },
    ]
      : url.includes('/reports/overview') ? overview
        : url.includes('/notifications') ? { data: [{ id: 3, category: 'reviews', title: 'Juan rated Chicken BBQ', created_at: '2026-11-23T03:45:00Z' }], meta: {} }
          : {},
  ))
})

afterEach(() => vi.useRealTimers())

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><BusinessOwnerReports /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Reports & Analytics', () => {
  it('asks for the last 30 days (Manila) and sends the chosen business or type', async () => {
    renderPage()
    await waitFor(() => expect(overviewCalls().length).toBeGreaterThan(0))
    expect(lastQuery().get('from')).toBe('2026-10-25')
    expect(lastQuery().get('to')).toBe('2026-11-23')

    const business = screen.getByLabelText('Business')
    await waitFor(() => expect(within(business).getByRole('option', { name: 'Ekslusibo Grill' })).toBeInTheDocument())
    expect(within(screen.getByLabelText('Business Type')).getAllByRole('option').map((o) => o.textContent)).toEqual(['All types', 'Resort', 'Restaurant'])

    fireEvent.change(business, { target: { value: '7' } })
    await waitFor(() => expect(lastQuery().get('business_id')).toBe('7'))
    fireEvent.change(screen.getByLabelText('Business Type'), { target: { value: 'Resort' } })
    await waitFor(() => expect(lastQuery().get('business_type')).toBe('Resort'))
    expect(lastQuery().get('business_id')).toBeNull()

    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'this_month' } })
    await waitFor(() => expect(lastQuery().get('from')).toBe('2026-11-01'))
  })

  it('a custom range needs both dates, refuses an impossible range, and clears back to the default', async () => {
    renderPage()
    await waitFor(() => expect(overviewCalls().length).toBeGreaterThan(0))
    expect(screen.queryByLabelText('Date From')).toBeNull()

    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: 'custom' } })
    expect(screen.getByText('Pick both dates to see the report.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Date From'), { target: { value: '2026-11-10' } })
    fireEvent.change(screen.getByLabelText('Date To'), { target: { value: '2026-11-01' } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Date From cannot be after Date To.')
    expect(overviewCalls().some((u) => u.includes('from=2026-11-10'))).toBe(false)

    fireEvent.change(screen.getByLabelText('Date To'), { target: { value: '2026-11-20' } })
    await waitFor(() => expect(lastQuery().get('to')).toBe('2026-11-20'))
    expect(lastQuery().get('from')).toBe('2026-11-10')

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    await waitFor(() => expect(lastQuery().get('from')).toBe('2026-10-25'))
    expect(screen.getByLabelText('Date range')).toHaveValue('last_30')
  })

  it('shows the KPIs with their change, top items, orders by status and recent activity', async () => {
    renderPage()
    expect(await screen.findByText('₱48,750.00')).toBeInTheDocument()
    expect(screen.getByText('247')).toBeInTheDocument()
    expect(screen.getByText(/\+12\.3%/)).toBeInTheDocument()
    expect(screen.getByText(/-2\.7%/)).toBeInTheDocument()
    expect(screen.getByText(/after ₱9,830\.00 expenses/)).toBeInTheDocument()
    expect(screen.getByText('124 reviews · 9 new')).toBeInTheDocument()

    const top = screen.getByRole('heading', { name: 'Top Selling Items' }).closest('section')!
    expect(within(top).getByText('Chicken BBQ')).toBeInTheDocument()
    expect(within(top).getByText('68 sold')).toBeInTheDocument()

    const status = within(screen.getByRole('list', { name: 'Orders by status' }))
    expect(status.getByText('Completed').parentElement).toHaveTextContent('Completed15075%')
    expect(status.getByText('Cancelled').parentElement).toHaveTextContent('Cancelled105%')

    fireEvent.click(screen.getByRole('button', { name: 'revenue' }))
    expect(screen.getByRole('button', { name: 'revenue' })).toHaveAttribute('aria-pressed', 'true')

    expect(await screen.findByRole('link', { name: /Juan rated Chicken BBQ/ })).toHaveAttribute('href', '/business-owner/notifications/3')
  })
})
