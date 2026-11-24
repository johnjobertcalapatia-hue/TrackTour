import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tourist attraction owner dashboard (2026-11-24). Production names the
 * category "Attractions", which fell through to the restaurant dashboard
 * (orders, revenue, menu items, promos). Attractions now get their own:
 * page views, saves, rating, gallery, a visitor-info checklist and reviews.
 */
const api = vi.hoisted(() => ({ get: vi.fn() }))
const store = vi.hoisted(() => ({ selectedBusinessId: 5 as number | null, category: 'Attractions' }))

vi.mock('@/shared/services/api', () => ({ get: api.get, apiErrorMessage: (_e: unknown, f: string) => f }))
vi.mock('@/features/business-owner/services/business-owner-store', () => ({
  useBusinessOwnerStore: (sel: (s: unknown) => unknown) => sel({
    selectedBusinessId: store.selectedBusinessId,
    getSelectedBusiness: () => ({ id: 5, name: 'Batong Buwaya River', category: store.category }),
  }),
}))

import BusinessOwnerDashboard from '@/features/business-owner/pages/BusinessOwnerDashboard'

const GENERIC = {
  businesses: [{ id: 5, name: 'Batong Buwaya River', category: 'Attractions', status: 'approved', logo: null }],
  selected_business_id: 5,
  business: { name: 'Batong Buwaya River', category: 'Attractions' },
  stats: { total_orders: 0, total_revenue: 0, active_bookings: 0, pending_orders: 0, total_menu_items: 0, active_promotions: 0 },
  recent_orders: [],
  recent_bookings: [],
}

const daily = Array.from({ length: 30 }, (_, i) => ({ date: `2026-11-${String(i + 1).padStart(2, '0')}`, views: i === 29 ? 4 : 1 }))
const ATTRACTION = {
  business: { id: 5, name: 'Batong Buwaya River', category: 'Attractions', address: 'Rosacara, Bansud', photo: 'g/hero.jpg', open_status: { status: 'open', label: 'Always open' }, attraction_type: 'River', entrance_fee: '20' },
  views: { last_30_days: 33, previous_30_days: 22, daily },
  saves: { total: 7, last_30_days: 2 },
  reviews: {
    average: 4.5, count: 2, breakdown: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 }, last_30_days: 1,
    latest: [{ id: 1, rating: 5, review: 'Malamig ang tubig', created_at: '2026-11-20T08:00:00Z', user_name: 'Jayvie D.', user: { avatar: null } }],
  },
  gallery: { photos: 3, videos: 1 },
  checklist: [
    { key: 'photos', label: 'At least 5 gallery photos', done: false, hint: '3 of 5' },
    { key: 'entrance_fee', label: 'Entrance fee', done: true },
    { key: 'activities', label: 'Activities & highlights', done: false, hint: 'Swimming, hiking, picnics…' },
    { key: 'location', label: 'Map pin', done: true },
  ],
}

function renderDashboard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><BusinessOwnerDashboard /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.get.mockReset()
  store.selectedBusinessId = 5
  store.category = 'Attractions'
  api.get.mockImplementation(async (url: string) => (url.startsWith('/business-owner/dashboard/attraction/') ? ATTRACTION : GENERIC))
})

describe('Tourist attraction owner dashboard', () => {
  it('an "Attractions" business gets the attraction dashboard, not orders and revenue', async () => {
    renderDashboard()

    expect(await screen.findByRole('heading', { level: 1, name: 'Batong Buwaya River' })).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/business-owner/dashboard/attraction/5')
    for (const gone of [/Total Revenue/i, /Total Orders/i, /Menu Items/i, /Active Promos/i, /Manage Orders/i]) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    const hero = screen.getByRole('region', { name: 'Your attraction' })
    expect(hero).toHaveTextContent('River')
    expect(hero).toHaveTextContent('Always open')
    expect(hero).toHaveTextContent('₱20 entrance')
    expect(within(hero).getByRole('link', { name: /Edit visitor info/ })).toHaveAttribute('href', '/business-owner/businesses/5/tourist-attraction-edit')
    expect(within(hero).getByRole('link', { name: /See it as tourists do/ })).toHaveAttribute('href', '/explore/place/5')
  })

  it('shows views with the trend, saves, rating and gallery', async () => {
    renderDashboard()
    expect(await screen.findByTestId('kpi-views')).toHaveTextContent('33')
    expect(screen.getByTestId('kpi-views')).toHaveTextContent('+50% vs the 30 days before') // 33 vs 22
    expect(screen.getByTestId('kpi-saves')).toHaveTextContent('7')
    expect(screen.getByTestId('kpi-saves')).toHaveTextContent('+2 in the last 30 days')
    expect(screen.getByTestId('kpi-rating')).toHaveTextContent('4.5')
    expect(screen.getByTestId('kpi-rating')).toHaveTextContent('2 reviews · 1 new')
    expect(screen.getByTestId('kpi-gallery')).toHaveTextContent('3photos · 1 video')
    // The chart has a table for screen readers.
    expect(screen.getByRole('table', { name: 'Page views per day' })).toBeInTheDocument()
  })

  it('small numbers say how many more, not a huge percentage', async () => {
    api.get.mockImplementation(async (url: string) => (url.startsWith('/business-owner/dashboard/attraction/')
      ? { ...ATTRACTION, views: { ...ATTRACTION.views, last_30_days: 12, previous_30_days: 1 } }
      : GENERIC))
    renderDashboard()
    expect(await screen.findByTestId('kpi-views')).toHaveTextContent('11 more than the 30 days before')
  })

  it('the checklist links each missing item to where it is fixed', async () => {
    renderDashboard()
    expect(await screen.findByRole('progressbar', { name: 'Visitor information complete' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByTestId('todo-photos')).toHaveAttribute('href', '/business-owner/businesses/5/tourist-attraction-gallery')
    expect(screen.getByTestId('todo-activities')).toHaveAttribute('href', '/business-owner/businesses/5/tourist-attraction-edit')
    expect(screen.queryByTestId('todo-entrance_fee')).toBeNull() // done items are not links
  })

  it('lists the latest reviews with a link to all of them', async () => {
    renderDashboard()
    const reviews = await screen.findByRole('heading', { name: 'Latest reviews' })
    const section = reviews.closest('section')!
    expect(section).toHaveTextContent('Jayvie D.')
    expect(section).toHaveTextContent('Malamig ang tubig')
    expect(within(section).getByRole('link', { name: 'All reviews' })).toHaveAttribute('href', '/business-owner/notifications?tab=reviews')
  })

  it('a restaurant keeps its own dashboard', async () => {
    store.category = 'Restaurant'
    api.get.mockImplementation(async () => ({ ...GENERIC, business: { name: 'Ekslusibo Grill', category: 'Restaurant' } }))
    renderDashboard()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/business-owner/dashboard?business_id=5'))
    await new Promise((r) => setTimeout(r, 30))
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/dashboard/attraction/'))
    expect(screen.queryByRole('region', { name: 'Your attraction' })).toBeNull()
  })
})
