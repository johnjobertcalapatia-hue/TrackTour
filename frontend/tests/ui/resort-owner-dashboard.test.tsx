import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Resort owner dashboard (redesign 2026-11-24): resorts no longer get the old
 * generic cards (orders, menu items); they see today's free units, reservations
 * to confirm, closures, offerings and deals, page views, reviews and setup.
 */
const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, apiErrorMessage: (_e: unknown, f: string) => f }))
vi.mock('@/features/business-owner/services/business-owner-store', () => ({
  useBusinessOwnerStore: (sel: (s: unknown) => unknown) => sel({
    selectedBusinessId: 7,
    getSelectedBusiness: () => ({ id: 7, name: 'RJM Beach Resort', category: 'Resort' }),
  }),
}))

import BusinessOwnerDashboard from '@/features/business-owner/pages/BusinessOwnerDashboard'

const GENERIC = {
  businesses: [{ id: 7, name: 'RJM Beach Resort', category: 'Resort', status: 'approved', logo: null }],
  selected_business_id: 7,
  business: { name: 'RJM Beach Resort', category: 'Resort' },
  stats: { total_orders: 0, total_revenue: 0, active_bookings: 0, pending_orders: 0, total_menu_items: 0, active_promotions: 0 },
  recent_orders: [],
  recent_bookings: [],
}

const RESORT = {
  business: { id: 7, name: 'RJM Beach Resort', address: 'Madri-Monte Road, Bansud', photo: null, open_status: { status: 'open', label: 'Open now' }, types: ['Beach Resort'], facilities: ['Beach access', 'Cottages'] },
  today: {
    date: '2026-12-01', closed: false,
    offerings: [
      { id: 1, name: 'Cottage', booking_mode: 'day_use', capacity: 10, available: 7, blocked: false, closed: false },
      { id: 2, name: 'Family room', booking_mode: 'overnight', capacity: 2, available: 0, blocked: false, closed: false },
      { id: 3, name: 'Hut', booking_mode: 'day_use', capacity: 2, available: 0, blocked: true, closed: false },
    ],
  },
  reservations: { pending: 2, upcoming: 3, this_month: 4, next: [{ id: 9, booking_number: 'BK-9', customer_name: 'Ana Cruz', status: 'pending', check_in_date: '2026-12-05', check_out_date: '2026-12-06', guests: 4, total_amount: 1300 }] },
  offerings: { total: 9, published: 8, from_price: 10, by_category: [{ category: 'cottage', label: 'Cottage', count: 1 }, { category: 'room', label: 'Room', count: 3 }] },
  closures: [{ id: 1, start_date: '2026-12-20', end_date: '2026-12-21', offering: null, reason: 'Private event' }],
  deals: { active: 1, posts: 2 },
  views: { last_30_days: 12, previous_30_days: 0, daily: Array.from({ length: 30 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, views: i % 3 })) },
  saves: { total: 5, last_30_days: 1 },
  reviews: { average: 4.3, count: 3, last_30_days: 1, latest: [{ id: 1, rating: 5, review: 'Clean cottages!', created_at: '2026-11-20', user_name: 'Ben Reyes' }] },
  checklist: [
    { key: 'cover', label: 'Cover photo', done: true },
    { key: 'offering_photos', label: 'Photos on every published offering', done: false, hint: 'Cottages and rooms with photos get chosen more' },
  ],
}

beforeEach(() => {
  api.get.mockReset()
  api.get.mockImplementation(async (url: string) => (url.includes('/dashboard/resort/7') ? RESORT : GENERIC))
})

const renderDashboard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><BusinessOwnerDashboard /></MemoryRouter>
  </QueryClientProvider>,
)

describe('Resort owner dashboard', () => {
  it('shows the resort, not the generic order cards', async () => {
    renderDashboard()
    expect(await screen.findByRole('heading', { level: 1, name: 'RJM Beach Resort' })).toBeInTheDocument()
    expect(screen.getByText('Beach Resort')).toBeInTheDocument()
    expect(screen.getByText('From ₱10.00')).toBeInTheDocument()
    expect(screen.queryByText(/Menu Items|Total Orders/)).toBeNull()
    expect(api.get).toHaveBeenCalledWith('/business-owner/dashboard/resort/7')
  })

  it('shows reservations to confirm and what is free today', async () => {
    renderDashboard()
    expect(await screen.findByTestId('kpi-reservations')).toHaveTextContent('2')
    expect(screen.getByTestId('kpi-reservations')).toHaveTextContent('3 upcoming')
    expect(screen.getByTestId('kpi-today')).toHaveTextContent('7/14')
    const today = screen.getByRole('list', { name: 'Free today' })
    expect(within(today).getByTestId('today-1')).toHaveTextContent('7 of 10 free')
    expect(within(today).getByTestId('today-2')).toHaveTextContent('Fully booked')
    expect(within(today).getByTestId('today-3')).toHaveTextContent('Blocked')
  })

  it('lists upcoming reservations, closures, deals, reviews and what is left to set up', async () => {
    renderDashboard()
    expect(await screen.findByText('Ana Cruz')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Ana Cruz/ })).toHaveAttribute('href', '/business-owner/bookings/9')
    expect(screen.getByText(/Whole resort · Private event/)).toBeInTheDocument()
    expect(screen.getByText(/1 active deal · 2 posts/)).toBeInTheDocument()
    expect(screen.getByText('Clean cottages!')).toBeInTheDocument()
    expect(screen.getByTestId('todo-offering_photos')).toHaveAttribute('href', '/business-owner/resort/offerings')
  })
})
