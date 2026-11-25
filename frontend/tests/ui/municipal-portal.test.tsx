import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), openAuthenticatedDocument: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f = 'Request failed.') => f }))

import MunicipalLayout from '@/features/municipal/components/MunicipalLayout'
import MunicipalDashboard, { toMunicipalPath } from '@/features/municipal/pages/MunicipalDashboard'
import MunicipalBusinessOwners from '@/features/municipal/pages/MunicipalBusinessOwners'
import MunicipalDocuments from '@/features/municipal/pages/MunicipalDocuments'
import MunicipalReports from '@/features/municipal/pages/MunicipalReports'
import MunicipalProfile from '@/features/municipal/pages/MunicipalProfile'
import MunicipalTourists from '@/features/municipal/pages/MunicipalTourists'
import { MunicipalAnnouncements, MunicipalDestinations } from '@/features/municipal/pages/MunicipalTourismContent'
import AdminMunicipalities from '@/features/admin/pages/AdminMunicipalities'
import AdminMunicipalityAccounts from '@/features/admin/pages/AdminMunicipalityAccounts'
import { getRoleDashboardPath } from '@/shared/utils'

function renderPage(ui: React.ReactNode, path = '/') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const listMeta = (stats: Record<string, number>, total = 1) => ({ current_page: 1, last_page: 1, per_page: 15, total, stats })

const dashboard = {
  municipality: { id: 4, name: 'Gloria', district: 'District 2', province: 'Oriental Mindoro', logo: null, cover_photo: null, barangays_count: 27 },
  stats: {
    business_owners: { total: 6, pending: 2, approved: 4, suspended: 0 },
    businesses: { total: 9, pending: 1, approved: 8, suspended: 0 },
    riders: { total: 5, pending: 1, approved: 4, active_now: 3 },
    tourists: { total: 40 },
    orders: { total: 120, this_month: 18 },
    documents: { business_pending: 3, business_flagged: 1, riders_pending: 1 },
  },
  recent_businesses: [{ id: 21, business_name: 'Gloria Grill', category: 'Restaurant', barangay: 'Poblacion', status: 'under_review', logo: null, created_at: '2026-11-10T00:00:00Z' }],
  recent_activity: [{ id: 1, action: 'rider.approved', description: 'Approved rider account (ben@example.com).', actor: 'Maria Santos', model_type: 'User', model_id: 5, created_at: '2026-11-12T02:00:00Z' }],
  pending: {
    business_owners: [{ id: 11, name: 'Ana Reyes', email: 'ana@example.com', created_at: '2026-11-10T00:00:00Z' }],
    businesses: [{ id: 21, business_name: 'Gloria Grill', category: 'Restaurant', status: 'under_review', created_at: '2026-11-10T00:00:00Z' }],
    riders: [],
  },
}

const cmp = (value: number, previous: number) => ({ value, previous })

const analytics = {
  period: { key: 'this_month', label: 'This month', from: '2026-11-01', to: '2026-11-17', previous_from: '2026-10-01', previous_to: '2026-10-17', generated_at: '2026-11-17T05:00:00Z' },
  municipality: { id: 4, name: 'Gloria' },
  overview: {
    businesses: { total: 9, active: 8, pending: 1, suspended: 0, new: cmp(2, 1) },
    users: { total: 52, online_now: 4, new: cmp(6, 3), new_today: 1 },
    deliveries: cmp(24, 20),
    ride_hailing: cmp(5, 5),
    bookings: cmp(3, 0),
    riders: { active: 4, online_now: 3 },
    business_owners: { active: 4 },
    pending_approvals: { businesses: 1, business_owners: 2, riders: 1 },
  },
  live: { users_online: 4, tourists_online: 2, riders_available: 2, riders_on_delivery: 1, drivers_on_rides: 0, active_food_orders: 1, ongoing_rides: 0, pending_deliveries: 0, cancelled_today: 0 },
  operations: { food_orders: cmp(30, 22), deliveries: cmp(24, 20), ride_hailing: cmp(5, 5), accommodation: cmp(3, 0), cancelled: 1 },
  economy: {
    gross_transaction_value: cmp(12500, 10000),
    business_owner_earnings: cmp(9000, 7000),
    rider_earnings: cmp(1800, 1500),
    refunds: cmp(0, 200),
    cod_collections: cmp(4000, 3000),
    gateway: { value: 8500, previous: 7000, count: 20 },
    pending_settlements: { count: 2, amount: 600 },
  },
  trend: { granularity: 'day', points: [{ date: '2026-11-01', gross_value: 500, transactions: 2 }, { date: '2026-11-02', gross_value: 0, transactions: 0 }] },
  popularity: {
    summary: { high: 1, growing: 0, average: 0, low: 0, declining: 0 },
    top: [{ id: 21, name: 'Gloria Grill', logo: null, municipality: 'Gloria', category: 'Restaurant', metrics: { views: 30, offering_views: 4, favorites: 2, inquiries: 1, bookings: 0, transactions: 6, reviews: 1 }, score: 70, previous_score: 50, growth: 40, conversion: 20, rating: 4.6, review_total: 3, class: 'high' }],
    needs_help: [],
  },
  opportunities: [{ kind: 'top_rated', business: 'Gloria Grill', title: 'Gloria Grill: rated 4.6 from 3 reviews', action: 'Feature as a recommended business', link: '/municipal/businesses/21' }],
}

function mockDashboard() {
  api.get.mockImplementation((url: string) => Promise.resolve(url === '/municipal/dashboard/analytics' ? analytics : dashboard))
}

const profile = {
  municipality: { id: 4, name: 'Gloria', district: 'District 2', province: 'Oriental Mindoro' },
  logo_url: null,
  cover_url: null,
  account: { name: 'Maria Santos', email: 'tourism@gloria.gov.ph' },
  office_name: 'Gloria Tourism Office',
  about: '',
  email: '',
  phone: '',
  address: 'Municipal Hall, Gloria, Oriental Mindoro',
  office_hours: '',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('municipal tourism office portal', () => {
  it('sends municipal officers to their own dashboard after sign-in', () => {
    expect(getRoleDashboardPath('tourism_office')).toBe('/municipal/dashboard')
    expect(getRoleDashboardPath('bansud_tourism_office')).toBe('/admin/dashboard')
  })

  it('has its own sidebar with every municipal section and pending badges', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/municipal/profile' ? profile : dashboard))

    renderPage(
      <Routes>
        <Route path="/municipal" element={<MunicipalLayout />}>
          <Route path="dashboard" element={<p>content</p>} />
        </Route>
      </Routes>,
      '/municipal/dashboard',
    )

    const nav = await screen.findByRole('navigation', { name: 'Municipal navigation' })
    for (const label of ['Dashboard', 'Live Map', 'Deliveries', 'Rider Cash', 'SOS Alerts', 'Business Owners', 'Businesses', 'Riders', 'Tourists', 'Destinations', 'Events', 'Announcements', 'Documents', 'Reports', 'Activity Logs', 'Office Profile']) {
      expect(within(nav).getByRole('link', { name: new RegExp(label) })).toBeInTheDocument()
    }
    expect(within(nav).getByRole('link', { name: /Live Map/ })).toHaveAttribute('href', '/municipal/live/map')
    expect(within(nav).getByRole('link', { name: /Rider Cash/ })).toHaveAttribute('href', '/municipal/rider-cash')
    expect(within(nav).getByRole('link', { name: /SOS Alerts/ })).toHaveAttribute('href', '/municipal/live/sos')
    // Municipal Office plan Stages 1–2: the same group headings, in order, as the Bansud sidebar.
    const headings = within(nav).getAllByText(/^(Overview|Live operations|Tourism management|Tourism content|Financial management|Records & analytics|System)$/).map((el) => el.textContent)
    expect(headings).toEqual(['Overview', 'Live operations', 'Tourism management', 'Tourism content', 'Financial management', 'Records & analytics', 'System'])
    // Platform-wide settings stay with Bansud.
    expect(within(nav).queryByRole('link', { name: /Landing|Municipalities/ })).not.toBeInTheDocument()
    await waitFor(() => expect(within(nav).getByLabelText('4 waiting')).toBeInTheDocument()) // 3 docs + 1 rider
    expect(screen.getAllByText('Gloria Tourism Office').length).toBeGreaterThan(0)
  })

  it('uses the Bansud dashboard design with figures for this municipality only', async () => {
    mockDashboard()

    renderPage(<MunicipalDashboard />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Gloria Tourism Dashboard' })).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/municipal/dashboard/analytics', { params: { period: 'this_month' } })
    // No municipality picker: the office only ever sees its own municipality.
    expect(screen.queryByRole('combobox', { name: 'Municipality' })).not.toBeInTheDocument()
    expect(screen.getByText('Nov 1 – 17, 2026')).toBeInTheDocument()
    expect(screen.getByText('compared with Oct 1 – 17, 2026')).toBeInTheDocument()

    // Tier 1: the local economy hero and the KPI tiles, with period comparison.
    expect(screen.getByRole('link', { name: 'Tourism transaction value ₱12,500.00, This month' })).toHaveAttribute('href', '/municipal/reports')
    const kpis = within(screen.getByRole('region', { name: 'Municipality performance' }))
    expect(kpis.getByRole('link', { name: /Tourism Businesses/ })).toHaveAttribute('href', '/municipal/businesses')
    expect(kpis.getByRole('link', { name: /Deliveries/ })).toHaveTextContent(/24.*\+20%/)

    // Platform-only figures never appear.
    expect(screen.queryByText(/Platform revenue/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Net income/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Record expense/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Municipality Statistics' })).not.toBeInTheDocument()
  })

  it('lists the review queues and keeps every link inside the municipal portal', async () => {
    mockDashboard()

    renderPage(<MunicipalDashboard />)

    const alerts = within(await screen.findByRole('region', { name: 'Alerts & Approvals' }))
    expect(alerts.getByRole('link', { name: /Business owners to verify\s*2/ })).toHaveAttribute('href', '/municipal/business-owners')
    expect(alerts.getByRole('link', { name: /Business documents to verify\s*3/ })).toHaveAttribute('href', '/municipal/documents')
    expect(alerts.getByRole('link', { name: /Rider requirements to review\s*1/ })).toHaveAttribute('href', '/municipal/documents?type=rider')

    // Shared sections (popularity, recommendations, activity) open municipal pages.
    expect(screen.getAllByRole('link', { name: /Gloria Grill/ }).every((l) => l.getAttribute('href') === '/municipal/businesses/21')).toBe(true)
    expect(screen.getByText('Approved rider account (ben@example.com).')).toBeInTheDocument()
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href') ?? '')
    expect(hrefs.filter((h) => h.startsWith('/admin'))).toEqual([])
  })

  it('switches the period and maps admin links to municipal pages', async () => {
    mockDashboard()
    renderPage(<MunicipalDashboard />)

    fireEvent.change(await screen.findByRole('combobox', { name: 'Period' }), { target: { value: 'this_year' } })
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/municipal/dashboard/analytics', { params: { period: 'this_year' } }))

    expect(toMunicipalPath('/admin/businesses/9')).toBe('/municipal/businesses/9')
    expect(toMunicipalPath('/admin/users/tourists')).toBe('/municipal/tourists')
    expect(toMunicipalPath('/admin/users?role=business_owner')).toBe('/municipal/business-owners')
    expect(toMunicipalPath('/admin/live/map')).toBe('/municipal/riders')
    expect(toMunicipalPath('/admin/audit-logs')).toBe('/municipal/activity-logs')
    expect(toMunicipalPath('/admin/rider-cash')).toBe('/municipal/riders')
    expect(toMunicipalPath('/admin/anything-else')).toBe('/municipal/reports')
  })

  it('requires a reason before suspending a business owner', async () => {
    api.get.mockResolvedValue({
      data: [{ id: 7, name: 'Ben Cruz', email: 'ben@example.com', role: 'business_owner', account_status: 'approved', created_at: '2026-11-01T00:00:00Z', businesses_count: 2 }],
      meta: listMeta({ total: 1, pending: 0, approved: 1, suspended: 0, rejected: 0 }),
    })
    api.post.mockResolvedValue({})

    renderPage(<MunicipalBusinessOwners />)

    fireEvent.click(await screen.findByRole('button', { name: 'Suspend' }))
    const dialog = screen.getByRole('heading', { name: 'Suspend Ben Cruz?' }).closest('form')!
    const confirm = within(dialog).getByRole('button', { name: 'Suspend' })
    expect(confirm).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Reason (required)'), { target: { value: 'Expired business permit' } })
    fireEvent.click(confirm)

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/municipal/business-owners/7/suspend', { remarks: 'Expired business permit' }),
    )
  })

  it('verifies a business document from the documents queue', async () => {
    api.get.mockResolvedValue({
      data: [{
        id: 31, name: 'Mayor\'s Permit', file_url: 'http://api.test/api/business-documents/31/file', file_name: 'permit.pdf',
        document_number: null, expiration_date: null, owner_remarks: null, admin_remarks: null, verification_status: 'pending',
        uploaded_at: '2026-11-10T00:00:00Z', business: { id: 21, business_name: 'Gloria Grill', category: 'Restaurant', status: 'under_review' },
      }],
      meta: listMeta({ business_pending: 1, business_flagged: 0, business_verified: 0, riders_pending: 0 }),
    })
    api.put.mockResolvedValue({})

    renderPage(<MunicipalDocuments />, '/?status=pending')

    fireEvent.click(await screen.findByRole('button', { name: /Verify/ }))
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/municipal/businesses/21/documents/31/review', { verification_status: 'verified' }),
    )
    expect(api.get).toHaveBeenCalledWith('/municipal/documents', expect.objectContaining({ params: expect.objectContaining({ type: 'business', status: 'pending' }) }))
  })

  it('offers a table view of the orders trend and a CSV export', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/municipal/profile'
          ? profile
          : {
              range: { from: '2026-11-01', to: '2026-11-02' },
              orders: { total: 3, completed: 2, by_status: [{ status: 'completed', total: 2 }], item_sales: 450, trend: [{ date: '2026-11-01', orders: 1 }, { date: '2026-11-02', orders: 2 }] },
              top_businesses: [{ id: 21, business_name: 'Gloria Grill', orders: 2, sales: 450 }],
              bookings: { total: 0, completed_value: 0, by_status: [] },
              businesses: { total: 9, registered_in_range: 1, by_status: [], by_category: [{ category: 'Restaurant', total: 9 }] },
              riders: { total: 5, registered_in_range: 0, by_status: [], completed_deliveries: 4 },
              tourists: { active_in_range: 2 },
            },
      ),
    )

    renderPage(<MunicipalReports />)

    expect(await screen.findByText('Gloria Grill')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show table' }))
    const table = screen.getByRole('columnheader', { name: 'Date' }).closest('table')!
    expect(within(table).getAllByRole('row')).toHaveLength(3)
  })

  it('saves the office profile as multipart form data', async () => {
    api.get.mockResolvedValue(profile)
    api.post.mockResolvedValue(profile)

    renderPage(<MunicipalProfile />)

    fireEvent.change(await screen.findByLabelText('Contact number'), { target: { value: '0917 000 1111' } })
    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    const [url, body] = api.post.mock.calls[0]!
    expect(url).toBe('/municipal/profile')
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('phone')).toBe('0917 000 1111')
    expect((body as FormData).get('office_name')).toBe('Gloria Tourism Office')
    expect(screen.getByText('These details are managed by the Bansud Tourism Office.')).toBeInTheDocument()
  })

  it('lists tourists read-only with no moderation buttons', async () => {
    api.get.mockResolvedValue({
      data: [{ id: 3, name: 'Kim Lee', email: 'kim@example.com', phone: null, nationality: 'Korean', account_status: 'approved', created_at: '2026-10-01T00:00:00Z', orders_count: 4, bookings_count: 1, last_activity_at: '2026-11-12T00:00:00Z' }],
      meta: listMeta({ total: 1 }),
    })

    renderPage(<MunicipalTourists />)

    expect(await screen.findByRole('link', { name: 'Kim Lee' })).toHaveAttribute('href', '/municipal/tourists/3')
    expect(screen.queryByRole('button', { name: /Suspend|Approve|Reject/ })).not.toBeInTheDocument()
  })

  it('creates a destination without choosing a municipality (the server uses the office town)', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/tourism-office/categories'
          ? [{ id: 2, name: 'Waterfalls' }]
          : { data: [{ id: 7, name: 'Tamaraw Falls', address: 'Brgy. Villaflor', status: 'active', category: { name: 'Waterfalls' } }], current_page: 1, last_page: 1, per_page: 15, total: 1 },
      ),
    )
    api.post.mockResolvedValue({ id: 8 })

    renderPage(<MunicipalDestinations />)

    expect(await screen.findByText('Tamaraw Falls')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/tourism-office/destinations?page=1')

    fireEvent.click(screen.getByRole('button', { name: /Add destination/ }))
    expect(screen.queryByLabelText(/Municipality/)).not.toBeInTheDocument()
    const save = screen.getByRole('button', { name: 'Create destination' })
    expect(save).toBeDisabled()

    await screen.findByRole('option', { name: 'Waterfalls' })
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Bongol Spring' } })
    fireEvent.change(screen.getByLabelText(/^Category/), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Cold spring' } })
    fireEvent.change(screen.getByLabelText(/^Address/), { target: { value: 'Brgy. Bongol' } })
    fireEvent.change(screen.getByLabelText(/^Latitude/), { target: { value: '12.97' } })
    fireEvent.change(screen.getByLabelText(/^Longitude/), { target: { value: '121.47' } })
    fireEvent.change(screen.getByLabelText(/^Amenities/), { target: { value: 'Parking\nCottages' } })
    fireEvent.click(save)

    await waitFor(() => expect(api.post).toHaveBeenCalled())
    const [url, body] = api.post.mock.calls[0]!
    expect(url).toBe('/tourism-office/destinations')
    expect(body).toMatchObject({ name: 'Bongol Spring', category_id: 2, latitude: 12.97, longitude: 121.47, status: 'draft', amenities: ['Parking', 'Cottages'], entrance_fee: null })
    expect(body).not.toHaveProperty('municipality_id')
    expect(await screen.findByText('Destination created.')).toBeInTheDocument()
  })

  it('asks before deleting an announcement', async () => {
    api.get.mockResolvedValue({ data: [{ id: 3, title: 'Road closure', type: 'safety', status: 'published', published_at: '2026-11-20T00:00:00Z' }], current_page: 1, last_page: 1, per_page: 15, total: 1 })
    api.del.mockResolvedValue(null)

    renderPage(<MunicipalAnnouncements />)

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Road closure' }))
    expect(api.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/tourism-office/announcements/3'))
  })
})

describe('Bansud admin municipality management', () => {
  it('flags municipalities without a Tourism Office account and adds a new municipality', async () => {
    api.get.mockResolvedValue({
      data: [
        { id: 1, name: 'Bansud', district: 'District 2', province: 'Oriental Mindoro', logo: null, is_home: true, barangays_count: 13, businesses_count: 20, pending_businesses_count: 0, riders_count: 8, admins_count: 1 },
        { id: 4, name: 'Gloria', district: 'District 2', province: 'Oriental Mindoro', logo: null, is_home: false, barangays_count: 27, businesses_count: 0, pending_businesses_count: 0, riders_count: 0, admins_count: 0 },
      ],
      meta: { current_page: 1, last_page: 1, per_page: 24, total: 2 },
    })
    api.post.mockResolvedValue({ id: 9 })

    renderPage(<AdminMunicipalities />)

    expect(await screen.findByText('Managed by the Bansud Tourism Office')).toBeInTheDocument()
    expect(screen.getByText('No Tourism Office account yet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add municipality/ }))
    fireEvent.change(screen.getByLabelText('Municipality name'), { target: { value: 'Pola' } })
    fireEvent.change(screen.getByLabelText('District'), { target: { value: 'District 1' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add municipality' }).at(-1)!)

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/municipalities', {
        name: 'Pola',
        district: 'District 1',
        province: 'Oriental Mindoro',
        latitude: null,
        longitude: null,
      }),
    )
  })

  it('creates a municipality account for the chosen municipality and offers reassignment', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/admin/municipalities'
          ? { data: [{ id: 1, name: 'Bansud', is_home: true, admins_count: 1 }, { id: 7, name: 'Roxas', is_home: false, admins_count: 0 }], meta: { current_page: 1, last_page: 1, per_page: 100, total: 2 } }
          : {
              data: [
                { id: 50, name: 'Maria Santos', email: 'tourism@gloria.gov.ph', phone: null, account_status: 'approved', created_at: '2026-11-15T00:00:00Z', municipality_id: 4, municipality: 'Gloria' },
                { id: 51, name: 'Old Officer', email: 'old@roxas.gov.ph', phone: null, account_status: 'suspended', created_at: '2026-10-01T00:00:00Z', municipality_id: null, municipality: null },
              ],
              meta: { current_page: 1, last_page: 1, per_page: 20, total: 2, stats: { total: 2, active: 1, suspended: 1, unassigned: 1, municipalities_without_account: 1 } },
            },
      ),
    )
    api.post.mockResolvedValue({})

    renderPage(<AdminMunicipalityAccounts />)

    expect(await screen.findByRole('link', { name: 'Gloria' })).toHaveAttribute('href', '/admin/municipalities/4')
    expect(screen.getByRole('button', { name: 'Assign & reactivate' })).toBeInTheDocument()
    expect(screen.getByText('1 municipality(ies) have no active Tourism Office account yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Create municipality account/ }))
    const form = (await screen.findByRole('heading', { name: 'Create municipality account' })).closest('form')!
    await waitFor(() => expect(within(form).getByRole('option', { name: 'Roxas — no account yet' })).toBeInTheDocument())
    fireEvent.change(within(form).getByLabelText('Municipality'), { target: { value: '7' } })
    fireEvent.change(within(form).getByLabelText('First name'), { target: { value: 'Rosa' } })
    fireEvent.change(within(form).getByLabelText('Last name'), { target: { value: 'Villanueva' } })
    fireEvent.change(within(form).getByLabelText('Office email'), { target: { value: 'tourism@roxas.gov.ph' } })
    fireEvent.change(within(form).getByLabelText('Temporary password'), { target: { value: 'Roxas2026!' } })
    fireEvent.change(within(form).getByLabelText('Confirm password'), { target: { value: 'Roxas2026!' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/municipality-accounts', {
        municipality_id: 7,
        first_name: 'Rosa',
        last_name: 'Villanueva',
        email: 'tourism@roxas.gov.ph',
        mobile_number: '',
        password: 'Roxas2026!',
        password_confirmation: 'Roxas2026!',
      }),
    )
    expect(await screen.findByText(/tourism@roxas.gov.ph created for Roxas/)).toBeInTheDocument()
  })
})
