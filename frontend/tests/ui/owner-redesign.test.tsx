import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, apiErrorMessage: (_e: unknown, f: string) => f, default: { get: api.get } }))
const auth = vi.hoisted(() => ({ logout: vi.fn(), user: { id: 1, name: 'Johnjobert Calapatia', role: 'business_owner', profile_photo: null } }))
vi.mock('@/features/auth/services/auth-store', () => ({
  useAuthStore: (sel?: (s: typeof auth) => unknown) => (sel ? sel(auth) : auth),
}))
// ResponsiveContainer measures 0×0 in jsdom; give charts a fixed size.
vi.mock('recharts', async (orig) => {
  const mod = await orig<typeof import('recharts')>()
  return { ...mod, ResponsiveContainer: ({ children }: { children: React.ReactElement }) => <div style={{ width: 600, height: 300 }}>{children}</div> }
})

import BusinessOwnerShell from '@/features/business-owner/components/shell/BusinessOwnerShell'
import RestaurantOwnerDashboard from '@/features/business-owner/pages/Dashboard/RestaurantOwnerDashboard'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'

const dashboardData = {
  business: { name: 'Ekslusibo Grill', category: 'Restaurant' },
  stats: { total_orders: 312, total_revenue: 128450, pending_orders: 3, active_promotions: 2, total_menu_items: 42 },
  recent_orders: [{ id: 9, order_number: 'TT-10024', customer_name: 'Maria Santos', status: 'preparing', total: 420, created_at: '2026-11-23T10:18:00+08:00' }],
}

function respond(cover: string | null = null) {
  api.get.mockImplementation((url: string) => Promise.resolve(
    url.includes('/reports/sales') ? { sales_data: [{ date: '2026-11-01', total_orders: 3, total_revenue: '1200' }, { date: '2026-11-02', total_orders: 5, total_revenue: '2100' }], summary: { total_revenue: '3300', total_orders: 8 } }
      : url.includes('/expenses/summary') ? { total_expenses: 4220, by_category: { ingredients: 2400, utilities: 1820 } }
        : url.includes('/staff') ? { staff: [{ status: 'active' }, { status: 'active' }, { status: 'suspended' }] }
          : url.includes('/businesses') ? [{ id: 7, business_name: 'Ekslusibo Grill', cover_photo: cover }]
            : url.includes('/notifications') ? { data: [{ read_at: null }, { read_at: null }, { read_at: '2026-11-20' }] }
              : {},
  ))
}

function renderAt(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/business-owner/dashboard']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  api.get.mockReset()
  useBusinessOwnerStore.setState({ businesses: [{ id: 7, name: 'Ekslusibo Grill', category: 'Restaurant', status: 'approved', logo: null, module_codes: [] }], selectedBusinessId: 7 })
})

describe('Restaurant owner dashboard (redesign)', () => {
  it('shows only real figures: this month from the sales report, all-time from the dashboard', async () => {
    respond()
    renderAt(<RestaurantOwnerDashboard data={dashboardData} businessId={7} />)

    expect(await screen.findByRole('heading', { name: 'Welcome back, Johnjobert!' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('kpi-Orders this month')).toHaveTextContent('8'))
    expect(screen.getByTestId('kpi-Orders this month')).toHaveTextContent('312 orders all time')
    expect(screen.getByTestId('kpi-Revenue this month')).toHaveTextContent('₱3,300.00')
    await waitFor(() => expect(screen.getByTestId('kpi-Active staff')).toHaveTextContent('2'))
    expect(screen.getByTestId('kpi-Active promotions')).toHaveTextContent('2')
    // No invented period-over-period badges.
    expect(document.body.textContent).not.toMatch(/\+\d+%/)
    // Net = this month's sales − expenses.
    expect(screen.getByRole('status')).toHaveTextContent('₱3,300.00 − expenses ₱4,220.00 = -₱920.00')
    expect(screen.getByRole('status')).toHaveTextContent('Expenses are higher than sales this month')
    // Sales report requested for this restaurant only.
    expect(api.get).toHaveBeenCalledWith('/business-owner/reports/sales?business_id=7&period=monthly')
  })

  it('uses the restaurant’s own cover photo for the banner, else brand green', async () => {
    respond('businesses/covers/grill.jpg')
    const { container, unmount } = renderAt(<RestaurantOwnerDashboard data={dashboardData} businessId={7} />)
    await waitFor(() => expect(container.querySelector('section[aria-label="Welcome"] img')).not.toBeNull())
    expect(container.querySelector('section[aria-label="Welcome"] img')!.getAttribute('src')).toContain('/storage/businesses/covers/grill.jpg')
    unmount()

    respond(null)
    const second = renderAt(<RestaurantOwnerDashboard data={dashboardData} businessId={7} />)
    await screen.findByRole('heading', { name: 'Welcome back, Johnjobert!' })
    expect(second.container.querySelector('section[aria-label="Welcome"] img')).toBeNull()
  })

  it('changes the sales period and links recent orders and quick actions to real pages', async () => {
    respond()
    renderAt(
      <Routes>
        <Route path="/business-owner/dashboard" element={<RestaurantOwnerDashboard data={dashboardData} businessId={7} />} />
        <Route path="/business-owner/orders/:id" element={<p>Order page</p>} />
        <Route path="/business-owner/promotions/create" element={<p>New promotion page</p>} />
      </Routes>,
    )
    fireEvent.change(await screen.findByLabelText('Period'), { target: { value: 'weekly' } })
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/business-owner/reports/sales?business_id=7&period=weekly'))

    fireEvent.click(screen.getByRole('button', { name: /Create Promotion/ }))
    expect(await screen.findByText('New promotion page')).toBeInTheDocument()
  })
})

describe('Business owner shell (redesign)', () => {
  const sections = [
    { items: [{ to: '/business-owner/dashboard', label: 'Dashboard' }, { to: '/business-owner/orders', label: 'Orders' }] },
    { label: 'Staff & Access', items: [{ to: '/business-owner/staff', label: 'Staff Management' }] },
  ]

  it('shows the business, the navigation with the active page, unread notifications and the profile menu', async () => {
    respond()
    renderAt(
      <Routes>
        <Route path="/business-owner" element={<BusinessOwnerShell sections={sections} />}>
          <Route path="dashboard" element={<p>Dashboard body</p>} />
        </Route>
      </Routes>,
    )

    const nav = screen.getAllByRole('navigation', { name: 'Sections' })[0]!
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Staff Management/ })).toHaveTextContent('New')
    expect(screen.getAllByText('Ekslusibo Grill').length).toBeGreaterThan(0)
    expect(screen.getByText('Dashboard body')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Notifications, 2 unread' })).toHaveAttribute('href', '/business-owner/notifications')

    fireEvent.click(screen.getByRole('button', { name: /Johnjobert Calapatia/ }))
    expect(screen.getByRole('menuitem', { name: /Business Profile/ })).toHaveAttribute('href', '/business-owner/profile')
    fireEvent.click(screen.getByRole('menuitem', { name: /Log Out/ }))
    expect(auth.logout).toHaveBeenCalled()
  })

  it('highlights Business Gallery, not My Businesses, on a business\'s gallery page', () => {
    respond()
    const gallerySections = [{ items: [
      { to: '/business-owner/businesses', label: 'My Businesses' },
      { to: '/business-owner/gallery', label: 'Business Gallery' },
    ] }]
    const page = (path: string) => render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/business-owner" element={<BusinessOwnerShell sections={gallerySections} />}>
              <Route path="*" element={<p>Body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Business Gallery redirects to /business-owner/businesses/:id/gallery.
    const first = page('/business-owner/businesses/7/gallery')
    let nav = screen.getAllByRole('navigation', { name: 'Sections' })[0]!
    expect(within(nav).getByRole('link', { name: 'Business Gallery' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'My Businesses' })).not.toHaveAttribute('aria-current')
    first.unmount()

    // Other business pages still belong to My Businesses.
    page('/business-owner/businesses/7/edit')
    nav = screen.getAllByRole('navigation', { name: 'Sections' })[0]!
    expect(within(nav).getByRole('link', { name: 'My Businesses' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Business Gallery' })).not.toHaveAttribute('aria-current')
  })

  it.each([
    ['Restaurant', 'Grow your restaurant with TrackTour', 'See your sales, orders and expenses in one place.', 'View Insights'],
    ['Resort', 'Grow your resort with TrackTour', 'See your reservations, earnings and expenses in one place.', 'View Insights'],
    ['Tourist Attraction', 'Grow your attraction with TrackTour', 'Share deals and posts to reach more visitors.', 'Create a Post'],
  ])('the side card fits a %s', (category, title, text, action) => {
    respond()
    useBusinessOwnerStore.setState({ businesses: [{ id: 7, name: 'Place', category, status: 'approved', logo: null, module_codes: [] }], selectedBusinessId: 7 })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/business-owner/dashboard']}>
          <Routes>
            <Route path="/business-owner" element={<BusinessOwnerShell sections={[{ items: [{ to: '/business-owner/dashboard', label: 'Dashboard' }] }]} />}>
              <Route path="*" element={<p>Body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getAllByText(title)[0]).toBeInTheDocument()
    expect(screen.getAllByText(text)[0]).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: new RegExp(action) })[0]).toBeInTheDocument()
    expect(screen.queryByText(category === 'Tourist Attraction' ? /sales, orders/ : /deals and posts to reach/)).toBeNull()
  })

  it('switching business saves the choice and reloads the whole page (Dashboard when the page does not fit)', async () => {
    respond()
    const { fullPageLoad } = await import('@/features/business-owner/navigation/owner-nav')
    const load = vi.spyOn(fullPageLoad, 'to').mockImplementation(() => {})
    useBusinessOwnerStore.setState({
      businesses: [
        { id: 2, name: 'Ekslusibo Grill', category: 'Restaurant', status: 'approved', logo: null, module_codes: ['menu_management', 'staff_management'] },
        { id: 7, name: 'RJM Beach Resort', category: 'Resort', status: 'approved', logo: null, module_codes: ['reservation_management', 'staff_management'] },
      ],
      selectedBusinessId: 2,
    })
    const page = (path: string) => render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/business-owner" element={<BusinessOwnerShell sections={[{ items: [{ to: '/business-owner/dashboard', label: 'Dashboard' }] }]} />}>
              <Route path="*" element={<p>Body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const pick = (name: string) => {
      fireEvent.click(screen.getAllByRole('button', { name: /Switch business/ })[0]!)
      fireEvent.click(within(screen.getAllByRole('listbox', { name: 'Your businesses' })[0]!).getByRole('option', { name: new RegExp(name) }))
    }

    // On the restaurant's menu: the resort has no menu → its Dashboard.
    let view = page('/business-owner/menu')
    pick('RJM Beach Resort')
    expect(useBusinessOwnerStore.getState().selectedBusinessId).toBe(7)
    expect(localStorage.getItem('selected_business_id') ?? String(useBusinessOwnerStore.getState().selectedBusinessId)).toBe('7')
    expect(load).toHaveBeenLastCalledWith('/business-owner/dashboard')
    view.unmount()

    // On a page both have: the same page reloads.
    useBusinessOwnerStore.setState({ selectedBusinessId: 7 })
    view = page('/business-owner/staff')
    pick('Ekslusibo Grill')
    expect(load).toHaveBeenLastCalledWith('/business-owner/staff')
    view.unmount()

    // Picking the business already selected does nothing.
    load.mockClear()
    page('/business-owner/staff')
    pick('Ekslusibo Grill')
    expect(load).not.toHaveBeenCalled()
    load.mockRestore()
  })

  it('highlights only Attraction Details, not also My Businesses, on the attraction edit page', () => {
    respond()
    const sections = [{ items: [
      { to: '/business-owner/businesses', label: 'My Businesses' },
      { to: '/business-owner/businesses/8/tourist-attraction-edit', label: 'Attraction Details' },
      { to: '/business-owner/settings?tab=location', label: 'Location' },
      { to: '/business-owner/settings?tab=documents', label: 'Documents' },
    ] }]
    const page = (path: string) => render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/business-owner" element={<BusinessOwnerShell sections={sections} />}>
              <Route path="*" element={<p>Body</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const current = () => within(screen.getAllByRole('navigation', { name: 'Sections' })[0]!)
      .getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page').map((l) => l.textContent?.trim())

    let view = page('/business-owner/businesses/8/tourist-attraction-edit')
    expect(current()).toEqual(['Attraction Details'])
    view.unmount()

    view = page('/business-owner/businesses')
    expect(current()).toEqual(['My Businesses'])
    view.unmount()

    view = page('/business-owner/businesses/8/documents')
    expect(current()).toEqual(['My Businesses'])
    view.unmount()

    page('/business-owner/settings?tab=documents')
    expect(current()).toEqual(['Documents'])
  })
})
