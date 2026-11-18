import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, API_BASE_URL: 'http://localhost/api', apiErrorMessage: (_e: unknown, f = 'Request failed.') => f }))
vi.mock('@/features/admin/components/TripDiagnosticsPanel', () => ({ default: () => <div>diagnostics</div> }))

import AdminLiveDeliveries from '@/features/admin/pages/AdminLiveDeliveries'

const record = (id: number, extra: Record<string, unknown> = {}) => ({
  id, order_id: id, order_number: `TT-${id}`, order_type: 'delivery', customer_name: 'Jayvie De Torres', customer_phone: null,
  restaurants: ['Ekslusibo Grill and Restaurant'], rider_name: 'Johnjobert Calapatia', rider_phone: '09124827253', status: 'in_transit',
  pickup_address: 'Pag-asa, Bansud', delivery_address: 'Kawit, Gloria', distance_km: 12.48, delivery_fee: 197.2, total: 416.1,
  order: { payment_method: 'gcash' }, purchasing_cash: null, purchasing_cash_issued_at: null, purchasing_cash_received_at: null, cod_purchases: [],
  delivered_at: null, created_at: '2026-11-11T05:55:04Z', updated_at: '2026-11-12T04:07:11Z', ...extra,
})

const response = (bucket: string, data: unknown[]) => ({
  data,
  meta: { municipality: { id: 1, name: 'Bansud' }, bucket, counts: { active: 3, completed: 5, cancelled: 1, all: 9 }, total: data.length, current_page: 1, last_page: 1 },
})

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AdminLiveDeliveries />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockImplementation((_url: string, config?: { params?: { bucket?: string } }) =>
    Promise.resolve(config?.params?.bucket === 'completed'
      ? response('completed', [record(14, { status: 'completed', delivered_at: '2026-11-12T04:07:11Z', order: { payment_method: 'cash' }, purchasing_cash: 3725.7, purchasing_cash_issued_at: '2026-11-11T05:55:47Z', purchasing_cash_received_at: '2026-11-11T05:55:47Z' })])
      : response('active', [record(12)])),
  )
})

describe('Bansud admin — delivery record', () => {
  it('shows the Bansud delivery record with real order, restaurant and rider details', async () => {
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Bansud Deliveries' })).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/admin/live/deliveries', { params: { bucket: 'active', page: 1 } })
    const row = screen.getByText('TT-12').closest('tr')!
    expect(within(row).getByText('Ekslusibo Grill and Restaurant')).toBeInTheDocument()
    expect(within(row).getByText('Johnjobert Calapatia')).toBeInTheDocument()
    expect(within(row).getByText('₱416.10')).toBeInTheDocument()

    const tabs = screen.getByRole('tablist', { name: 'Delivery record' })
    expect(within(tabs).getByRole('tab', { name: /Active\s*3/ })).toHaveAttribute('aria-selected', 'true')
    expect(within(tabs).getByRole('tab', { name: /All records\s*9/ })).toBeInTheDocument()
  })

  it('opens the history and filters the record', async () => {
    renderPage()
    await screen.findByText('TT-12')

    fireEvent.click(screen.getByRole('tab', { name: /Completed\s*5/ }))
    expect(await screen.findByText('TT-14')).toBeInTheDocument()
    expect(screen.getByText(/₱3,725\.70 · Received/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search deliveries'), { target: { value: 'TT-14' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'delivery' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } })
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith('/admin/live/deliveries', { params: { bucket: 'completed', page: 1, search: 'TT-14', type: 'delivery', from: '2026-11-01' } }),
    )
  })
})
