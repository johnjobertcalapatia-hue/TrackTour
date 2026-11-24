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
})
