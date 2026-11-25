import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }))
vi.mock('@/shared/services/api', () => ({
  ...api,
  apiErrorMessage: (e: unknown, f: string) => (e as { message?: string })?.message ?? f,
}))

import BusinessOwnerRoles, { togglePermission } from '@/features/business-owner/pages/BusinessOwnerRoles'

const page = {
  business: { id: 7, name: 'Ekslusibo Grill', category: 'Restaurant' },
  modules: [
    { key: 'orders', label: 'Orders', description: 'Food orders', permissions: [
      { key: 'orders.view', label: 'View orders' }, { key: 'orders.update', label: 'Accept orders' }, { key: 'orders.reject', label: 'Reject orders' },
    ] },
    { key: 'finance', label: 'Sales & reports', description: 'Sales', permissions: [{ key: 'finance.view', label: 'View sales' }] },
  ],
  owner_only: ['Mark a GCash payment as paid'],
  built_in: [
    { id: 1, name: 'Finance Staff', description: 'Money', is_custom: false, permissions: ['finance.view'], modules: ['finance'], staff_count: 0, staff: [] },
  ],
  custom: [
    { id: 9, name: 'Cashier', description: null, is_custom: true, permissions: ['orders.view'], modules: ['orders'], staff_count: 2,
      staff: [{ id: 3, name: 'Ana Cruz', status: 'active' }, { id: 4, name: 'Ben Reyes', status: 'active' }] },
  ],
  max_custom_roles: 20,
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><BusinessOwnerRoles /></MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  api.get.mockResolvedValue(page)
})

describe('Roles & Permissions page', () => {
  it('shows built-in roles read-only, custom roles editable and the owner-only list', async () => {
    renderPage()
    const builtIn = await screen.findByTestId('role-1')
    expect(within(builtIn).getByText('Built-in')).toBeInTheDocument()
    expect(within(builtIn).getByRole('button', { name: /Duplicate/ })).toBeInTheDocument()
    expect(within(builtIn).queryByRole('button', { name: /Edit/ })).toBeNull()

    const custom = screen.getByTestId('role-9')
    expect(within(custom).getByRole('button', { name: 'Edit Cashier' })).toBeInTheDocument()
    expect(within(custom).getByText('2 staff')).toBeInTheDocument()
    expect(screen.getByText('Mark a GCash payment as paid')).toBeInTheDocument()
  })

  it('adds a role with the modules the owner ticks', async () => {
    api.post.mockResolvedValue({ ...page.custom[0], id: 10, name: 'Runner' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /Add role/ }))
    fireEvent.change(screen.getByLabelText('Role name'), { target: { value: 'Runner' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sales & reports' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Add role' }).at(-1)!)

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/business-owner/roles', {
      business_id: 7, name: 'Runner', description: '', permissions: ['finance.view'],
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Runner was added.')
  })

  it('needs at least one module and warns when the change reaches staff', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Cashier' }))
    expect(screen.getByText(/changes access for 2 staff members right away/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Orders' })) // partly on → all on
    fireEvent.click(screen.getByRole('checkbox', { name: 'Orders' })) // all off
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Choose at least one module this role can manage.')).toBeInTheDocument()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('will not delete a role staff still hold', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Cashier' }))
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete role' })).toBeDisabled()
  })

  it('managing a module brings its view along, and removing the view removes the rest', () => {
    expect(togglePermission([], 'orders.update')).toEqual(['orders.update', 'orders.view'])
    expect(togglePermission(['orders.view', 'orders.update', 'orders.reject'], 'orders.view')).toEqual([])
  })
})
