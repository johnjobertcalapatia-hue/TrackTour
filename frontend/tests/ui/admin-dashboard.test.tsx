import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, API_BASE_URL: 'http://localhost/api', apiErrorMessage: (_e: unknown, f = 'Request failed.') => f }))

import AdminDashboard from '@/features/admin/pages/AdminDashboard'

const cmp = (value: number, previous: number) => ({ value, previous })
const row = (id: number, name: string, cls: string, extra: Record<string, unknown> = {}) => ({
  id, name, logo: null, municipality: 'Bansud', category: 'Restaurant',
  metrics: { views: 25, offering_views: 5, favorites: 2, inquiries: 1, bookings: 0, transactions: 4, reviews: 1 },
  score: 60, previous_score: 40, growth: 50, conversion: 16, rating: 4.6, review_total: 3, class: cls, ...extra,
})

const analytics = {
  period: { key: 'this_month', label: 'This month', from: '2026-11-01', to: '2026-11-18', previous_from: '2026-10-01', previous_to: '2026-10-18', generated_at: '2026-11-18T02:00:00Z' },
  municipality: null,
  overview: {
    businesses: { total: 148, active: 142, pending: 6, suspended: 0, new: cmp(6, 3) },
    users: { total: 25720, online_now: 842, new: cmp(120, 100), new_today: 9 },
    deliveries: cmp(8420, 7136), ride_hailing: cmp(5230, 4548), bookings: cmp(42, 40),
    cashouts: { requested: cmp(487500, 400000), open_count: 72 },
    riders: { active: 60, online_now: 18 }, business_owners: { active: 130 },
    pending_approvals: { businesses: 6, business_owners: 2, riders: 3 },
  },
  live: { users_online: 842, tourists_online: 600, riders_available: 12, riders_on_delivery: 5, drivers_on_rides: 3, active_food_orders: 9, ongoing_rides: 3, pending_deliveries: 2, cancelled_today: 1 },
  operations: { food_orders: cmp(312, 274), deliveries: cmp(289, 249), ride_hailing: cmp(126, 113), accommodation: cmp(42, 40), cancelled: 7 },
  financial: {
    gross_transaction_value: cmp(250000, 200000), platform_revenue: cmp(24850, 21000), business_owner_earnings: cmp(200000, 170000),
    rider_earnings: cmp(18000, 15000), refunds: cmp(500, 900), operating_expenses: cmp(4850, 4000), net_income: cmp(20000, 17000),
    earnings_today: 850, earnings_this_month: 24850,
    cashouts: { requested: cmp(487500, 400000), approved: cmp(300000, 250000), completed: cmp(280000, 240000), liability: 207500 },
    pending_settlements: { count: 2, amount: 1399 }, cod_collections: cmp(40000, 35000), cod_remitted: cmp(30000, 25000),
    rider_cash_advances: cmp(2000, 0), gateway: { value: 210000, previous: 160000, count: 1500 },
  },
  trend: { granularity: 'day', points: [
    { date: '2026-11-16', platform_revenue: 800, expenses: 0, gross_value: 9000, transactions: 30 },
    { date: '2026-11-17', platform_revenue: 1200, expenses: 300, gross_value: 12000, transactions: 41 },
    { date: '2026-11-18', platform_revenue: 850, expenses: 0, gross_value: 8000, transactions: 25 },
  ] },
  popularity: {
    summary: { high: 3, growing: 4, average: 10, low: 5, declining: 2 },
    top: [row(1, 'Ekslusibo Grill', 'high'), row(2, 'Bansud Beach Resort', 'growing')],
    needs_help: [row(3, 'Quiet Cafe', 'declining', { score: 5, previous_score: 20, growth: -75 })],
  },
  opportunities: [
    { kind: 'declining', business: 'Quiet Cafe', title: 'Quiet Cafe: engagement down 75%', action: 'Recommend a promotional campaign', link: '/admin/businesses/3' },
    { kind: 'event', business: null, title: 'Upcoming event: Bansud Town Fiesta (Nov 28)', action: 'Promote the event and invite businesses to join', link: null },
  ],
  municipalities: [
    { id: 1, name: 'Bansud', logo: null, is_home: true, businesses: 60, riders: 30, transactions: 900, value: 95000, share: 38, has_office: true },
    { id: 2, name: 'Gloria', logo: null, is_home: false, businesses: 10, riders: 4, transactions: 50, value: 20000, share: 8, has_office: false },
  ],
  alerts: [
    { key: 'businesses', label: 'Business registrations to review', count: 6, link: '/admin/businesses?status=pending' },
    { key: 'offices', label: 'Municipalities without an office account', count: 0, link: '/admin/municipalities/accounts' },
  ],
  system: [
    { key: 'database', label: 'Database', status: 'ok', detail: '2 ms' },
    { key: 'payments', label: 'Payments', status: 'ok', detail: 'Last paid 1 hour ago' },
    { key: 'tracking', label: 'Live tracking', status: 'idle', detail: 'Last fix 2 days ago' },
    { key: 'jobs', label: 'Background jobs', status: 'ok', detail: 'No failures in 24 h' },
  ],
  activity: [{ id: 1, description: 'New business approved: Bansud Beach Resort', by: 'Bansud Tourism Office', at: '2026-11-18T01:58:00Z' }],
}

const office = { name: 'Bansud Tourism Office', about: '', email: '', phone: '', address: '', logo_url: null, cover_url: null, updated_at: null }

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((url: string) => {
    if (url.includes('profile')) return Promise.resolve(office)
    if (url.includes('platform-expenses')) return Promise.resolve({ data: [], meta: { categories: ['operations', 'marketing'] } })
    return Promise.resolve(analytics)
  })
  api.post.mockResolvedValue({})
})

describe('Bansud Tourism Dashboard (business intelligence)', () => {
  it('leads with municipality performance cards that drill down, compared with the previous period', async () => {
    renderPage()

    const cards = await screen.findByRole('region', { name: 'Municipality performance' })
    expect(within(cards).getByRole('link', { name: /Tourism Businesses\s*148\s*\+100%\s*Active 142 · Pending 6/ })).toHaveAttribute('href', '/admin/businesses')
    expect(within(cards).getByRole('link', { name: /Registered Users\s*25,720.*Online now: 842/ })).toHaveAttribute('href', '/admin/users')
    expect(within(cards).getByRole('link', { name: /Deliveries\s*8,420\s*\+18%/ })).toHaveAttribute('href', '/admin/live/deliveries')
    expect(within(cards).getByRole('link', { name: /Cashout Requests\s*₱487,500\.00.*72 open requests/ })).toHaveAttribute('href', '/admin/cashouts')
    // Header: labelled filters and the compared periods in readable dates.
    const header = within(screen.getByRole('region', { name: 'Dashboard header' }))
    // Global CSS colours h1 dark; the title must set white itself or it vanishes on the band.
    expect(header.getByRole('heading', { level: 1, name: 'Bansud Tourism Dashboard' })).toHaveClass('text-white')
    expect(within(header.getByRole('group', { name: 'Dashboard filters' })).getByLabelText('Municipality')).toHaveValue('')
    expect(header.getByText('Nov 1 – 18, 2026')).toBeInTheDocument()
    expect(header.getByText('compared with Oct 1 – 18, 2026')).toBeInTheDocument()
    expect(header.getByText(/^Live · Updated/)).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Indicators' })).getByRole('link', { name: /Pending approvals\s*11/ })).toBeInTheDocument()
  })

  it('refetches for the chosen period, custom range and municipality', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Municipality performance' })

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'this_week' } })
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/dashboard/analytics', { params: { period: 'this_week' } }))

    fireEvent.change(screen.getByLabelText('Municipality'), { target: { value: '2' } })
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/dashboard/analytics', { params: { period: 'this_week', municipality_id: 2 } }))

    fireEvent.change(screen.getByLabelText('Period'), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith('/admin/dashboard/analytics', { params: { period: 'custom', from: '2026-11-01', to: '2026-11-10', municipality_id: 2 } }),
    )
  })

  it('shows popularity classes and both business lists with growth opportunities', async () => {
    renderPage()

    const pop = await screen.findByRole('region', { name: 'Business Popularity Analytics' })
    expect(within(within(pop).getByRole('list', { name: 'Popularity classes' })).getByText('Declining').closest('li')).toHaveTextContent('2')
    expect(within(pop).getByRole('link', { name: /Ekslusibo Grill/ })).toHaveAttribute('href', '/admin/businesses/1')
    expect(within(pop).getAllByText('High popularity').length).toBeGreaterThan(0)

    fireEvent.click(within(pop).getByRole('tab', { name: 'Needs promotional support' }))
    expect(within(pop).getByRole('link', { name: /Quiet Cafe/ })).toBeInTheDocument()
    expect(within(pop).queryByRole('link', { name: /Ekslusibo Grill/ })).toBeNull()

    const opp = screen.getByRole('region', { name: 'Tourism Growth Opportunities' })
    expect(within(opp).getByRole('link', { name: /Quiet Cafe: engagement down 75%\s*Recommend a promotional campaign/ })).toHaveAttribute('href', '/admin/businesses/3')
    expect(within(opp).getByText('Upcoming event: Bansud Town Fiesta (Nov 28)')).toBeInTheDocument()
  })

  it('separates gross value, platform revenue, expenses and net income, with a chart/table view', async () => {
    renderPage()

    const fin = await screen.findByRole('region', { name: 'Financial Overview' })
    expect(within(fin).getByText('Gross transaction value').parentElement).toHaveTextContent('₱250,000.00')
    expect(within(fin).getAllByText('Platform revenue')[0]!.parentElement).toHaveTextContent('₱24,850.00')
    expect(within(fin).getByText('Net income').parentElement).toHaveTextContent('₱20,000.00')
    expect(within(fin).getByText('Open liability').parentElement).toHaveTextContent('₱207,500.00')

    const bars = within(fin).getAllByRole('listitem', { name: /revenue ₱/ })
    expect(bars).toHaveLength(3)
    fireEvent.mouseEnter(bars[1]!)
    expect(within(fin).getByText(/Gross ₱12,000\.00 · 41 transactions/)).toBeInTheDocument()

    fireEvent.click(within(fin).getByRole('button', { name: 'Show table' }))
    expect(within(fin).getByRole('table')).toHaveTextContent('₱1,200.00')
  })

  it('records an operating expense', async () => {
    renderPage()

    fireEvent.click(await screen.findByRole('button', { name: '+ Record expense' }))
    fireEvent.change(await screen.findByLabelText('Amount (₱)'), { target: { value: '1500' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Fiesta stage' } })
    fireEvent.click(screen.getByRole('button', { name: /^Record expense$/ }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/platform-expenses', expect.objectContaining({ category: 'operations', description: 'Fiesta stage', amount: 1500, municipality_id: null })),
    )
  })

  it('shows operations, live activity, municipalities, alerts, activity and system health with drill-downs', async () => {
    renderPage()

    const ops = await screen.findByRole('region', { name: 'Daily Operations' })
    expect(within(ops).getByRole('link', { name: /Food orders\s*312/ })).toHaveAttribute('href', '/admin/live/deliveries')
    const live = screen.getByRole('region', { name: 'Live Platform Activity' })
    expect(within(live).getByRole('link', { name: /Deliveries waiting for a rider\s*2/ })).toBeInTheDocument()

    const muni = screen.getByRole('region', { name: 'Municipality Statistics' })
    expect(within(muni).getByRole('link', { name: /Gloria\s*No office account\s*8%/ })).toHaveAttribute('href', '/admin/municipalities/2')

    const alerts = screen.getByRole('region', { name: 'Alerts & Approvals' })
    expect(within(alerts).getByText('6 open')).toBeInTheDocument()
    expect(within(alerts).getByRole('link', { name: /Business registrations to review\s*6/ })).toHaveAttribute('href', '/admin/businesses?status=pending')

    expect(within(screen.getByRole('region', { name: 'Recent Activities' })).getByText('New business approved: Bansud Beach Resort')).toBeInTheDocument()
    const sys = screen.getByRole('region', { name: 'System Health' })
    expect(within(sys).getByText('Check items')).toBeInTheDocument()
    expect(within(sys).getByText('Last fix 2 days ago')).toBeInTheDocument()
  })

  it('follows a visual hierarchy: one hero figure, then attention, then numbered sections', async () => {
    renderPage()

    // Tier 1: a single high-emphasis hero (platform revenue), not five equal cards.
    expect(await screen.findByRole('link', { name: 'Platform revenue ₱24,850.00, This month' })).toHaveAttribute('href', '/admin/reports')
    // Attention bar lists only open items and summarises the rest.
    const attention = screen.getByRole('region', { name: 'Alerts & Approvals' })
    expect(within(attention).queryByText('Municipalities without an office account')).toBeNull()
    expect(within(attention).getByText('+ 1 other checks clear')).toBeInTheDocument()

    // Tier 2/3: numbered section headings in order of importance; panels sit a level below.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Business popularity & growth', 'Finances', 'Operations & records',
    ])
    expect(screen.getByRole('heading', { level: 3, name: 'Business Popularity Analytics' })).toBeInTheDocument()

    const order = ['Alerts & Approvals', 'Business Popularity Analytics', 'Financial Overview', 'Daily Operations', 'System Health']
      .map((name) => screen.getByRole('region', { name }))
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })
})
