import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  ...api,
  default: { get: api.get },
  apiErrorMessage: (e: unknown, f: string) => (e as { message?: string })?.message ?? f,
}))
vi.mock('@/features/business-owner/services/business-owner-store', () => ({
  useBusinessOwnerStore: (sel: (s: { selectedBusinessId: number | null }) => unknown) => sel({ selectedBusinessId: null }),
}))
// The real layout pulls in the whole shell; the staff menu is what matters here.
vi.mock('@/features/business-owner/components/shell/BusinessOwnerShell', () => ({
  default: ({ sections, portal }: { sections: { items: { label: string }[] }[]; portal?: { navLabel?: string } }) => (
    <nav aria-label={portal?.navLabel}>{sections.flatMap((s) => s.items).map((i) => <span key={i.label}>{i.label}</span>)}</nav>
  ),
}))

import BusinessOwnerStaff from '@/features/business-owner/pages/BusinessOwnerStaff'
import BusinessOwnerStaffShow from '@/features/business-owner/pages/BusinessOwnerStaffShow'
import StaffActivatePage from '@/features/auth/pages/StaffActivatePage'
import StaffLayout from '@/features/staff/components/StaffLayout'
import BusinessOwnerOrders from '@/features/business-owner/pages/BusinessOwnerOrders'
import { BusinessPortalProvider } from '@/features/business-owner/services/business-portal'

function renderAt(ui: React.ReactElement, path = '/', route = '*') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path={route} element={ui} /><Route path="/login" element={<p>Login page</p>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** The owner's Orders page as the staff portal renders it (prefix /staff, one restaurant, role permissions). */
function renderStaffOrders(permissions: string[]) {
  return renderAt(
    <BusinessPortalProvider value={{ prefix: '/staff', isStaff: true, businessId: 1, businesses: [{ id: 1, name: 'Grill' }], can: (p) => permissions.includes(p) }}>
      <BusinessOwnerOrders />
    </BusinessPortalProvider>,
  )
}

const staffOrders = {
  data: [
    { id: 1, order_number: 'TT-1', customer_name: 'Tourist', status: 'accepted', order_type: 'delivery', created_at: '2026-11-23T08:00:00Z', total: 560, shared_with_other_restaurants: true,
      items: [{ id: 11, product_name: 'Iced Coffee', quantity: 1, unit_price: 120, total_price: 120, status: 'preparing' }] },
    { id: 2, order_number: 'TT-2', customer_name: 'Tourist', status: 'preparing', order_type: 'delivery', created_at: '2026-11-23T09:00:00Z', total: 450, shared_with_other_restaurants: false,
      items: [{ id: 21, product_name: 'Sisig', quantity: 2, unit_price: 200, total_price: 400, status: 'preparing' }] },
  ],
  meta: { current_page: 1, last_page: 1, total: 2, status_counts: { all: 2, preparing: 2 } },
}

const me = (permissions: string[]) => ({ staff: { id: 1, full_name: 'Maria', employee_id: 'EMP-1', role: 'Kitchen' }, business: { id: 1, name: 'Grill' }, permissions })

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
})

describe('Business owner: Staff Management page (Stage 1)', () => {
  it('shows the overview counts and recent activity', async () => {
    api.get.mockResolvedValue({
      counts: { total: 12, active: 10, pending: 1, suspended: 1, inactive: 0 },
      recent_activity: [{ id: 1, action: 'staff.invited', description: 'Invitation sent to pedro@example.com.', actor_type: 'owner', actor_name: 'Owner', staff_name: 'Pedro', created_at: '2026-11-23T08:00:00Z' }],
    })
    renderAt(<BusinessOwnerStaff />, '/business-owner/staff')

    expect(await screen.findByTestId('stat-Total staff')).toHaveTextContent('12')
    expect(screen.getByTestId('stat-Active staff')).toHaveTextContent('10')
    expect(screen.getByTestId('stat-Pending invitations')).toHaveTextContent('1')
    expect(screen.getByTestId('stat-Suspended')).toHaveTextContent('1')
    expect(screen.getByText('Invitation sent to pedro@example.com.')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/business-owner/staff/overview')
  })

  it('lists staff with their status and filters them', async () => {
    api.get.mockResolvedValue({
      staff: [
        { id: 1, name: 'Maria Santos', email: 'maria@x.test', role_label: 'Order & Payment Staff', status: 'active', employee_id: 'EMP-1', last_login_at: null, created_at: '2026-11-01' },
        { id: 2, name: 'Pedro Garcia', email: 'pedro@x.test', role_label: 'Inventory Staff', status: 'pending', employee_id: 'EMP-2', last_login_at: null, created_at: '2026-11-02' },
        { id: 3, name: 'Ana Cruz', email: 'ana@x.test', role_label: 'Kitchen / Preparation Staff', status: 'suspended', employee_id: 'EMP-3', last_login_at: null, created_at: '2026-11-03' },
      ],
      status_counts: { active: 1, pending: 1, suspended: 1 },
    })
    renderAt(<BusinessOwnerStaff />, '/business-owner/staff?tab=staff')

    expect(await screen.findByTestId('staff-row-2')).toHaveTextContent('Invitation pending')
    expect(screen.getByTestId('staff-row-3')).toHaveTextContent('Suspended')
    fireEvent.click(screen.getByRole('button', { name: 'Suspended · 1' }))
    expect(screen.queryByTestId('staff-row-1')).toBeNull()
    expect(screen.getByTestId('staff-row-3')).toBeInTheDocument()
  })

  it('resending an invitation whose email fails gives the owner the link to share', async () => {
    api.get.mockResolvedValue({ invitations: [{ id: 5, staff_id: 9, name: 'Pedro', email: 'pedro@x.test', role: 'Inventory Staff', business: 'Grill', state: 'expired', sent_at: '2026-11-19T00:00:00Z', expires_at: '2026-11-22T00:00:00Z' }] })
    api.post.mockResolvedValue({ mail_sent: false, activation_url: 'http://localhost:3000/staff/activate/abc' })
    renderAt(<BusinessOwnerStaff />, '/business-owner/staff?tab=invitations')

    fireEvent.click(await within(await screen.findByTestId('invitation-5')).findByRole('button', { name: 'Resend' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/business-owner/staff/9/resend-invitation'))
    expect(await screen.findByLabelText('Activation link')).toHaveValue('http://localhost:3000/staff/activate/abc')
  })
})

describe('Staff profile actions', () => {
  const profile = (status: string) => ({
    id: 7, name: 'Maria Santos', email: 'maria@x.test', employee_id: 'EMP-7', mobile_number: null, address: null,
    role_label: 'Order & Payment Staff', status, date_hired: null, employment_status: null, last_login_at: null, created_at: '2026-11-01',
    business: { business_name: 'Grill' },
    granted_permissions: [{ key: 'orders.view', module: 'Orders and reservations', label: "View their restaurant's orders" }],
    invitation: status === 'pending' ? { state: 'pending', sent_at: '2026-11-23T00:00:00Z', expires_at: '2026-11-26T00:00:00Z', accepted_at: null } : null,
    activity: [],
  })

  it('suspends after confirmation and never offers a password field', async () => {
    api.get.mockResolvedValue(profile('active'))
    api.patch.mockResolvedValue({})
    renderAt(<BusinessOwnerStaffShow />, '/business-owner/staff/7', '/business-owner/staff/:id')

    expect(await screen.findByText("View their restaurant's orders")).toBeInTheDocument()
    expect(document.querySelector('input[type="password"]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Suspend' }))
    expect(screen.getByText(/signed out at once/)).toBeInTheDocument()
    const suspendButtons = screen.getAllByRole('button', { name: 'Suspend' })
    await act(async () => { fireEvent.click(suspendButtons[suspendButtons.length - 1]!) })
    expect(api.patch).toHaveBeenCalledWith('/business-owner/staff/7/status', { status: 'suspended' })
  })

  it('offers resend for a pending invitation and a reset link only for active staff', async () => {
    api.get.mockResolvedValue(profile('pending'))
    renderAt(<BusinessOwnerStaffShow />, '/business-owner/staff/7', '/business-owner/staff/:id')

    expect(await screen.findByRole('button', { name: /Resend invitation/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Send password reset link/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Suspend$/ })).toBeNull()
  })
})

describe('Staff activation page', () => {
  it('lets the invited staff member set their own password', async () => {
    api.get.mockResolvedValue({ state: 'pending', email: 'ana@x.test', name: 'Ana', business: 'Ekslusibo Grill', role: 'Kitchen / Preparation Staff' })
    api.post.mockResolvedValue({ email: 'ana@x.test' })
    renderAt(<StaffActivatePage />, '/staff/activate/tok123', '/staff/activate/:token')

    expect(await screen.findByText(/Ekslusibo Grill added you as Kitchen \/ Preparation Staff/)).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveValue('ana@x.test')
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'MyOwnPass123!' } })
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'MyOwnPass123!' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Activate account' })) })

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/staff-invitations/tok123/accept', { password: 'MyOwnPass123!', password_confirmation: 'MyOwnPass123!' }))
    expect(await screen.findByText('Login page')).toBeInTheDocument()
  })

  it('explains an expired invitation instead of showing the form', async () => {
    api.get.mockResolvedValue({ state: 'expired', email: 'ana@x.test', name: 'Ana', business: 'Grill', role: null })
    renderAt(<StaffActivatePage />, '/staff/activate/old', '/staff/activate/:token')

    expect(await screen.findByText(/This invitation has expired/)).toBeInTheDocument()
    expect(screen.queryByLabelText('New password')).toBeNull()
  })
})

describe('Staff portal follows permissions', () => {
  it('shows only the menu items the role allows', async () => {
    api.get.mockResolvedValue(me(['orders.view', 'orders.update', 'menu.view']))
    renderAt(<StaffLayout />)

    const menu = await screen.findByRole('navigation', { name: 'Staff menu' })
    await waitFor(() => expect(menu).toHaveTextContent('Orders'))
    expect(menu).toHaveTextContent('Menu')
    expect(menu).not.toHaveTextContent('Bookings')
  })

  it('staff use the owner\'s Orders page through /staff: a shared order shows only their items', async () => {
    api.get.mockResolvedValue(staffOrders)
    api.patch.mockResolvedValue({})
    renderStaffOrders(['orders.view', 'orders.update'])

    const shared = await screen.findByTestId('order-card-1')
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/staff\/orders\?/))
    expect(api.get.mock.calls.every(([url]) => !String(url).startsWith('/business-owner'))).toBe(true)
    expect(String(api.get.mock.calls[0]![0])).not.toContain('business_id') // the server scopes staff
    expect(shared).toHaveTextContent('Shared order')
    expect(shared).toHaveTextContent('₱120.00') // their items, not the whole order's ₱560

    fireEvent.click(within(shared).getByRole('button', { expanded: false }))
    expect(within(shared).getByText('Your Items')).toBeInTheDocument()
    expect(within(shared).getByRole('link', { name: /View Order/ })).toHaveAttribute('href', '/staff/orders/1')
    await act(async () => { fireEvent.click(within(shared).getByRole('button', { name: /Mark Ready for Pickup/ })) })
    expect(api.patch).toHaveBeenCalledWith('/staff/orders/1/items/11/status', { status: 'ready' })
  })

  it('shows no order actions without the update permission', async () => {
    api.get.mockResolvedValue(staffOrders)
    renderStaffOrders(['orders.view'])

    const order = await screen.findByTestId('order-card-2')
    fireEvent.click(within(order).getByRole('button', { expanded: false }))
    expect(within(order).queryByRole('button', { name: /Mark Ready/ })).toBeNull()
  })
})
