import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  ...api,
  default: { get: api.get },
  apiErrorMessage: (e: unknown, f: string) => (e as { message?: string })?.message ?? f,
}))
vi.mock('@/features/business-owner/components/shell/BusinessOwnerShell', () => ({
  default: ({ sections, portal }: { sections: { items: { label: string }[] }[]; portal?: { navLabel?: string } }) => (
    <nav aria-label={portal?.navLabel}>{sections.flatMap((s) => s.items).map((i) => <span key={i.label}>{i.label}</span>)}</nav>
  ),
}))

import StaffLayout from '@/features/staff/components/StaffLayout'
import BusinessOwnerOrders from '@/features/business-owner/pages/BusinessOwnerOrders'
import BusinessOwnerExpenses from '@/features/business-owner/pages/BusinessOwnerExpenses'
import { BusinessPortalProvider } from '@/features/business-owner/services/business-portal'
import { RolePicker } from '@/features/business-owner/components/staff/RolePicker'

function renderUi(ui: React.ReactElement) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

const me = (permissions: string[]) => ({ staff: { id: 1, full_name: 'Maria', employee_id: 'EMP-1', role: 'Staff' }, business: { id: 7, name: 'Ekslusibo Grill' }, permissions })

beforeEach(() => Object.values(api).forEach((fn) => fn.mockReset()))

describe('Restaurant staff roles: the staff menu', () => {
  it.each([
    ['Finance Staff', ['finance.view', 'expenses.manage'], ['Sales & Reports', 'Expenses'], ['Orders', 'Menu', 'Deals & Posts']],
    ['Menu & Promotions Staff', ['menu.view', 'menu.manage', 'promotions.manage'], ['Menu', 'Deals & Posts'], ['Orders', 'Expenses', 'Sales & Reports']],
    ['Order & Pickup Staff', ['orders.view', 'orders.update', 'payments.confirm_rider_cash', 'handover.confirm'], ['Orders'], ['Menu', 'Expenses', 'Deals & Posts']],
  ])('%s sees only their screens', async (_role, permissions, shown, hidden) => {
    api.get.mockResolvedValue(me(permissions))
    renderUi(<StaffLayout />)
    const menu = await screen.findByRole('navigation', { name: 'Staff menu' })
    await waitFor(() => expect(menu).toHaveTextContent(shown[0]!))
    for (const label of shown) expect(menu).toHaveTextContent(label)
    for (const label of hidden) expect(menu).not.toHaveTextContent(label)
  })
})

describe('Order & Pickup Staff: cash and handover (the owner\'s Orders page)', () => {
  const orders = {
    data: [
      { id: 1, order_number: 'TT-1', customer_name: 'Tourist', status: 'preparing', order_type: 'delivery', payment_method: 'cash', created_at: '2026-11-23T08:00:00Z', total: 250,
        delivery: { rider: { name: 'rico', first_name: 'Rico', phone: '0917' } }, my_handover: null,
        restaurant_purchases: [{ business_id: 7, status: 'pending', purchase_amount: 200, payment_confirmed_at: null, rider_arrived_at: '2026-11-23T08:20:00Z', can_confirm_payment: true }],
        items: [{ id: 11, business_id: 7, product_name: 'Sisig', quantity: 1, unit_price: 200, total_price: 200, status: 'preparing' }] },
      { id: 2, order_number: 'TT-2', customer_name: 'Tourist', status: 'ready', order_type: 'delivery', payment_method: 'gcash', created_at: '2026-11-23T09:00:00Z', total: 200,
        delivery: { rider: { name: 'ana', first_name: 'Ana', phone: null } }, my_handover: null,
        items: [{ id: 21, business_id: 7, product_name: 'Adobo', quantity: 1, unit_price: 150, total_price: 150, status: 'ready' }] },
      { id: 3, order_number: 'TT-3', customer_name: 'Tourist', status: 'ready', order_type: 'delivery', payment_method: 'gcash', created_at: '2026-11-23T10:00:00Z', total: 140,
        delivery: { rider: { name: 'ben', first_name: 'Ben', phone: null } }, my_handover: { confirmed_at: '2026-11-23T10:30:00Z', confirmed_by: 5 },
        items: [{ id: 31, business_id: 7, product_name: 'Halo-halo', quantity: 1, unit_price: 90, total_price: 90, status: 'ready' }] },
    ],
    meta: { current_page: 1, last_page: 1, total: 3, status_counts: { all: 3 } },
  }

  function renderOrders(permissions: string[]) {
    return renderUi(
      <BusinessPortalProvider value={{ prefix: '/staff', isStaff: true, businessId: 7, businesses: [{ id: 7, name: 'Ekslusibo Grill' }], can: (p) => permissions.includes(p) }}>
        <BusinessOwnerOrders />
      </BusinessPortalProvider>,
    )
  }
  const open = async (id: number) => {
    const card = await screen.findByTestId(`order-card-${id}`)
    fireEvent.click(within(card).getByRole('button', { expanded: false }))
    return card
  }

  it('confirms the rider’s cash, records the handover once items are ready, and shows a done handover', async () => {
    api.get.mockResolvedValue(orders)
    api.post.mockResolvedValue({ already_confirmed: false })
    renderOrders(['orders.view', 'orders.update', 'payments.confirm_rider_cash', 'handover.confirm'])

    const cashOrder = await open(1)
    expect(within(cashOrder).queryByRole('button', { name: /Handed to rider/ })).toBeNull()
    expect(cashOrder).toHaveTextContent('Rico · 0917')
    await act(async () => { fireEvent.click(within(cashOrder).getByRole('button', { name: 'Payment received' })) })
    expect(api.post).toHaveBeenCalledWith('/staff/orders/1/cod-payment-received', { business_id: 7 })

    const readyOrder = await open(2)
    await act(async () => { fireEvent.click(within(readyOrder).getByRole('button', { name: /Handed to rider/ })) })
    expect(api.post).toHaveBeenLastCalledWith('/staff/orders/2/handover')

    const doneOrder = await open(3)
    expect(within(doneOrder).getByTestId('handover-done-3')).toHaveTextContent('Handed to the rider')
    expect(within(doneOrder).queryByRole('button', { name: /Handed to rider/ })).toBeNull()
  })

  it('shows no cash or handover buttons without those permissions', async () => {
    api.get.mockResolvedValue(orders)
    renderOrders(['orders.view', 'orders.update'])
    const cashOrder = await open(1)
    expect(within(cashOrder).queryByRole('button', { name: 'Payment received' })).toBeNull()
    expect(cashOrder).toHaveTextContent('A teammate who handles cash confirms the payment')
    const readyOrder = await open(2)
    expect(within(readyOrder).queryByRole('button', { name: /Handed to rider/ })).toBeNull()
  })

  it('the business owner keeps /business-owner and no staff-only handover panel', async () => {
    api.get.mockResolvedValue({ ...orders, data: [orders.data[1]] })
    renderUi(<BusinessOwnerOrders />)
    const card = await open(2)
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/business-owner\/orders\?/))
    expect(within(card).queryByText('Rider Handover')).toBeNull()
    expect(within(card).getByRole('link', { name: /View Order/ })).toHaveAttribute('href', '/business-owner/orders/2')
  })
})

describe('Owner pages reused in the staff portal', () => {
  const expenses = (url: string) => Promise.resolve(
    url.includes('/expenses/summary') ? { total: 500, by_category: {} }
      : url.includes('/expenses') ? { data: [{ id: 4, vendor_name: 'Palengke', category: 'ingredients', amount: 500, expense_date: '2026-11-20', business: { business_name: 'Ekslusibo Grill' } }], meta: { last_page: 1 } }
        : { data: [{ id: 7, name: 'Ekslusibo Grill' }] },
  )

  it('Finance Staff use the expenses page through /staff and cannot delete', async () => {
    api.get.mockImplementation(expenses)
    renderUi(
      <BusinessPortalProvider value={{ prefix: '/staff', isStaff: true, businessId: 7, businesses: [{ id: 7, name: 'Ekslusibo Grill' }] }}>
        <BusinessOwnerExpenses />
      </BusinessPortalProvider>,
    )
    expect(await screen.findByText('Palengke')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/staff\/expenses\?/))
    expect(api.get.mock.calls.every(([url]) => !String(url).startsWith('/business-owner'))).toBe(true)
    expect(screen.queryByRole('button', { name: 'Delete expense' })).toBeNull()
  })

  it('the business owner still uses /business-owner and keeps delete', async () => {
    api.get.mockImplementation(expenses)
    renderUi(<BusinessOwnerExpenses />)
    expect(await screen.findByText('Palengke')).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith(expect.stringMatching(/^\/business-owner\/expenses\?/))
    expect(screen.getByRole('button', { name: 'Delete expense' })).toBeInTheDocument()
  })
})

describe('One employee, several roles', () => {
  it('the owner ticks more than one role', () => {
    function Harness() {
      const [ids, setIds] = useState<number[]>([1])
      return (
        <>
          <RolePicker roles={[{ id: 1, name: 'Order & Pickup Staff' }, { id: 2, name: 'Finance Staff' }, { id: 3, name: 'Menu & Promotions Staff' }]} value={ids} onChange={setIds} />
          <output data-testid="ids">{ids.join(',')}</output>
        </>
      )
    }
    render(<Harness />)
    fireEvent.click(screen.getByRole('checkbox', { name: /Menu & Promotions Staff/ }))
    expect(screen.getByTestId('ids')).toHaveTextContent('1,3')
    fireEvent.click(screen.getByRole('checkbox', { name: /Order & Pickup Staff/ }))
    expect(screen.getByTestId('ids')).toHaveTextContent('3')
  })
})
