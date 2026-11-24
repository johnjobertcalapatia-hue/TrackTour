import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Staff portal redesign (2026-11-24): the owner's green shell with the staff
 * member's restaurant, name and role, and their own My Profile page (contact
 * details, photo and password only).
 */
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  ...api,
  default: { get: api.get },
  apiErrorMessage: (e: unknown, f: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? f,
}))
vi.mock('@/shared/components/SystemNoticeBanner', () => ({ default: () => null }))

import StaffLayout from '@/features/staff/components/StaffLayout'
import StaffProfile from '@/features/staff/pages/StaffProfile'
import StaffBookings from '@/features/staff/pages/StaffBookings'
import StaffDashboard from '@/features/staff/pages/StaffDashboard'

const ME = {
  staff: { id: 1, full_name: 'Maria Santos', employee_id: 'EMP-00001', role: 'Order & Pickup Staff', profile_picture: null },
  business: { id: 7, name: 'Ekslusibo Grill', category: 'Restaurant', logo: null },
  permissions: ['orders.view', 'orders.update'],
}

const PROFILE = {
  id: 1, employee_id: 'EMP-00001', full_name: 'Maria Santos', email: 'maria@staff.test', mobile_number: '09170000000', address: null,
  gender: null, date_of_birth: null, profile_picture: null, status: 'active', roles: ['Order & Pickup Staff'], date_hired: '2026-11-01', employment_status: 'full_time',
  business: { id: 7, name: 'Ekslusibo Grill', category: 'Restaurant', logo: null },
  permissions: [
    { key: 'orders.view', group: 'Orders and reservations', label: "View their restaurant's orders" },
    { key: 'orders.update', group: 'Orders and reservations', label: 'Accept orders, start preparation and mark items ready' },
  ],
}

function renderAt(path: string, ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/staff" element={ui}>
            <Route path="orders" element={<p>Orders page</p>} />
          </Route>
          <Route path="/staff/profile" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
})

describe('Staff portal shell', () => {
  it("uses the owner's shell with the staff member's restaurant, name and role", async () => {
    api.get.mockResolvedValue(ME)
    renderAt('/staff/orders', <StaffLayout />)

    expect(await screen.findAllByText('Maria Santos')).not.toHaveLength(0)
    const card = screen.getAllByTestId('staff-business-card')[0]!
    expect(card).toHaveTextContent('Ekslusibo Grill')
    expect(card).toHaveTextContent('Staff')
    expect(screen.getAllByText('Order & Pickup Staff').length).toBeGreaterThan(0)
    expect(screen.getByText('Staff portal · EMP-00001')).toBeInTheDocument()
    expect(screen.queryByText('?')).toBeNull() // no unknown-person avatar
    expect(screen.queryByText('Business Owner')).toBeNull()
    expect(screen.queryByRole('link', { name: /Notifications/ })).toBeNull() // no owner bell
    expect(api.get.mock.calls.every(([url]) => !String(url).startsWith('/business-owner'))).toBe(true)

    const menu = screen.getByRole('navigation', { name: 'Staff menu' })
    expect(within(menu).getByRole('link', { name: /Orders/ })).toHaveAttribute('aria-current', 'page')
    expect(within(menu).getByRole('link', { name: /My Profile/ })).toHaveAttribute('href', '/staff/profile')
    expect(within(menu).queryByRole('link', { name: /Menu/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { expanded: false, name: /Maria Santos/ }))
    expect(screen.getByRole('menuitem', { name: /My Profile/ })).toHaveAttribute('href', '/staff/profile')
    expect(screen.queryByRole('menuitem', { name: /Business Profile/ })).toBeNull()
  })
})

describe('Staff: My Profile', () => {
  it('shows their details, roles and what the roles allow', async () => {
    api.get.mockResolvedValue(PROFILE)
    renderAt('/staff/profile', <StaffProfile />)

    expect(await screen.findByRole('heading', { level: 1, name: 'My Profile' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Maria Santos' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('maria@staff.test')
    expect(screen.getByLabelText('Email')).toHaveAttribute('readonly')
    const employment = screen.getByRole('region', { name: 'Employment' })
    expect(employment).toHaveTextContent('EMP-00001')
    expect(employment).toHaveTextContent('Full-time')
    expect(screen.getByRole('region', { name: 'What you can do' })).toHaveTextContent('mark items ready')
  })

  it('saves contact details, checking the phone number first', async () => {
    api.get.mockResolvedValue(PROFILE)
    api.put.mockResolvedValue({ ...PROFILE, mobile_number: '09171234567', address: 'Poblacion, Bansud' })
    renderAt('/staff/profile', <StaffProfile />)

    const mobile = await screen.findByLabelText('Mobile number')
    fireEvent.change(mobile, { target: { value: 'call me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText('Use digits only, e.g. 09171234567.')).toBeInTheDocument()
    expect(api.put).not.toHaveBeenCalled()

    fireEvent.change(mobile, { target: { value: '09171234567' } })
    fireEvent.change(screen.getByLabelText('Home address'), { target: { value: 'Poblacion, Bansud' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })) })
    expect(api.put).toHaveBeenCalledWith('/staff/profile', { mobile_number: '09171234567', address: 'Poblacion, Bansud' })
    expect(await screen.findByRole('status')).toHaveTextContent('Contact details saved.')
  })

  it('changes the password, and shows a wrong current password under its field', async () => {
    api.get.mockResolvedValue(PROFILE)
    api.put.mockRejectedValueOnce({ response: { status: 422, data: { message: 'Your current password is incorrect.', errors: { current_password: ['Your current password is incorrect.'] } } } })
      .mockResolvedValueOnce(null)
    renderAt('/staff/profile', <StaffProfile />)

    const fill = (current: string) => {
      fireEvent.change(screen.getByLabelText('Current password'), { target: { value: current } })
      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'NewPassword1!' } })
      fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'NewPassword1!' } })
    }
    await screen.findByLabelText('Current password')
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }))
    expect(screen.getByText('Use at least 8 characters.')).toBeInTheDocument()

    fill('wrong')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change password' })) })
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true'))
    expect(document.getElementById('staff-current-password-error')).toHaveTextContent('Your current password is incorrect.')

    fill('OldPassword1!')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Change password' })) })
    expect(api.put).toHaveBeenLastCalledWith('/staff/profile/password', { current_password: 'OldPassword1!', password: 'NewPassword1!', password_confirmation: 'NewPassword1!' })
    expect(await screen.findByRole('status')).toHaveTextContent('Other devices were signed out')
    expect(screen.getByLabelText('Current password')).toHaveValue('')
  })

  it('checks the photo before uploading it', async () => {
    api.get.mockResolvedValue(PROFILE)
    api.post.mockResolvedValue({ ...PROFILE, profile_picture: 'staff/profile-pictures/a.png' })
    renderAt('/staff/profile', <StaffProfile />)

    const input = await screen.findByLabelText('Profile photo')
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.gif', { type: 'image/gif' })] } })
    expect(screen.getByRole('alert')).toHaveTextContent('Use a JPG or PNG photo.')
    expect(api.post).not.toHaveBeenCalled()

    await act(async () => { fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } }) })
    expect(api.post).toHaveBeenCalledWith('/staff/profile/photo', expect.any(FormData))
    expect(await screen.findByRole('img', { name: 'Your profile photo' })).toBeInTheDocument()
  })
})

describe('Staff: Bookings', () => {
  const bookings = {
    bookings: [{ id: 3, booking_number: 'BK-3', customer_name: 'Ana', booking_type: 'room', status: 'pending', check_in_date: '2026-12-01', check_out_date: '2026-12-02', total_amount: 1500 }],
    status_counts: { pending: 1 },
    pagination: { current_page: 1, last_page: 1, per_page: 20, total: 1 },
  }

  it('lists the bookings the API sends (previously always empty) and confirms one', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/staff/me' ? { ...ME, permissions: ['bookings.view', 'bookings.update'] } : bookings))
    api.patch.mockResolvedValue({})
    renderAt('/staff/profile', <StaffBookings />)

    expect(await screen.findByText('BK-3')).toBeInTheDocument()
    expect(screen.getByText('₱1,500.00')).toBeInTheDocument()
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Confirm' })) })
    expect(api.patch).toHaveBeenCalledWith('/staff/bookings/3/status', { status: 'confirmed' })

    fireEvent.click(screen.getByRole('button', { name: /Pending/ }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/staff/bookings?page=1&status=pending'))
  })

  it('hides status buttons without bookings.update', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/staff/me' ? { ...ME, permissions: ['bookings.view'] } : bookings))
    renderAt('/staff/profile', <StaffBookings />)
    expect(await screen.findByText('BK-3')).toBeInTheDocument()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/staff/me'))
    expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull()
  })
})

describe('Staff: Dashboard by role', () => {
  const dashboard = {
    staff: { full_name: 'Maria Santos', role: 'Order & Pickup Staff' },
    business: { name: 'Ekslusibo Grill', category: 'Restaurant' },
    today_summary: { pending: 5, in_progress: 2, completed_today: 3, cancelled_today: 1 },
    recent_orders: [{ id: 9, order_number: 'TT-9', customer_name: 'Ana', status: 'preparing', total: 560, created_at: '2026-11-24T08:00:00Z', shared_with_other_restaurants: true,
      items: [{ status: 'preparing', total_price: 120 }, { status: 'cancelled', total_price: 50 }] }],
    recent_bookings: [],
  }
  const mock = (permissions: string[], body: object = dashboard) =>
    api.get.mockImplementation((url: string) => Promise.resolve(url === '/staff/me' ? { ...ME, permissions } : body))

  it("Order & Pickup Staff: today's order counts, their pages, and their items' total in a shared order", async () => {
    mock(['orders.view', 'orders.update'])
    renderAt('/staff/profile', <StaffDashboard />)

    expect(await screen.findByRole('heading', { level: 1, name: 'Good day, Maria!' })).toBeInTheDocument()
    expect(screen.getByTestId('stat-pending')).toHaveTextContent('5')
    expect(screen.getByTestId('stat-cancelled_today')).toHaveTextContent('1')
    const pages = screen.getByRole('region', { name: 'Your pages' })
    await waitFor(() => expect(within(pages).getByRole('link', { name: /Orders/ })).toHaveAttribute('href', '/staff/orders'))
    expect(within(pages).queryByRole('link', { name: /Expenses/ })).toBeNull()
    const activity = screen.getByRole('region', { name: 'Recent activity' })
    expect(within(activity).getByRole('link', { name: /TT-9/ })).toHaveAttribute('href', '/staff/orders/9')
    expect(activity).toHaveTextContent('₱120.00') // not the whole order's ₱560
    expect(within(activity).getByRole('link', { name: 'See all' })).toHaveAttribute('href', '/staff/orders')
    expect(screen.queryByText(/Menu Items|Active Promos|Revenue/i)).toBeNull()
  })

  it('Finance Staff: their finance pages, no order counts or activity', async () => {
    mock(['finance.view', 'expenses.manage'], { ...dashboard, today_summary: [], recent_orders: [] })
    renderAt('/staff/profile', <StaffDashboard />)

    const pages = await screen.findByRole('region', { name: 'Your pages' })
    await waitFor(() => expect(within(pages).getByRole('link', { name: /Sales & Reports/ })).toHaveAttribute('href', '/staff/reports'))
    expect(within(pages).getByRole('link', { name: /Expenses/ })).toHaveAttribute('href', '/staff/expenses')
    expect(within(pages).queryByRole('link', { name: /Orders/ })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Today' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Recent activity' })).toBeNull()
  })

  it('Menu & Promotions Staff: menu and deals', async () => {
    mock(['menu.view', 'menu.manage', 'promotions.manage'], { ...dashboard, today_summary: [], recent_orders: [] })
    renderAt('/staff/profile', <StaffDashboard />)

    const pages = await screen.findByRole('region', { name: 'Your pages' })
    await waitFor(() => expect(within(pages).getByRole('link', { name: /Deals & Posts/ })).toHaveAttribute('href', '/staff/promotions'))
    expect(within(pages).getByRole('link', { name: /^Menu/ })).toHaveAttribute('href', '/staff/menu')
    expect(within(pages).getByRole('link', { name: /My Profile/ })).toHaveAttribute('href', '/staff/profile')
  })
})
