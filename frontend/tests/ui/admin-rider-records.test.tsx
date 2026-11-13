import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), openAuthenticatedDocument: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import { RiderRecords, type RiderRecordsData } from '@/features/admin/components/RiderRecords'
import AdminRiders from '@/features/admin/pages/AdminRiders'

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())

const records: RiderRecordsData = {
  date: today,
  rider: {
    id: 5,
    name: 'Johnjobert Calapatia',
    account_status: 'approved',
    rider_status: 'busy',
    current_service: 'food',
    municipality: 'Bansud',
    active_delivery: { delivery_id: 9, order_number: 'TT-11111', status: 'picked_up', payment: 'cod' },
  },
  deliveries: {
    all_time: { total: 12, cod: 7, online: 5, rides: 0 },
    on_date: { total: 3, cod: 2, online: 1, rides: 0 },
    cancelled: 1,
  },
  earnings: {
    all_time: { total: 520, delivery_fee_share: 480, tips: 40, from_cod: 300, from_online: 220 },
    on_date: { total: 140, delivery_fee_share: 120, tips: 20, from_cod: 80, from_online: 60 },
  },
  cash_out: {
    available: 220,
    pending: 0,
    paid: 300,
    payouts: [{ payout_number: 'PO-0001', amount: 300, status: 'paid', requested_at: '2026-11-09T02:00:00Z', paid_at: '2026-11-09T05:00:00Z' }],
  },
  cod_cash: {
    available: true,
    receipt_status: 'calculated_preview',
    policy_status: 'inactive_pending_activation',
    cod_deliveries: 2,
    office_cash_issued: 1000,
    office_cash_used: 900,
    office_cash_returned: 0,
    office_cash_with_rider: 100,
    cod_cash_collected: 1204,
    rider_own_money_used: 150,
    delivery_fee_earned: 80,
    tips_earned: 0,
    net_cod_remittance: 974,
    payable_to_rider: 0,
  },
  recent_deliveries: [
    { delivery_id: 8, order_number: 'TT-62973', type: 'food', payment: 'online', status: 'completed', completed_at: '2026-11-10T11:56:16Z', created_at: '2026-11-04T04:14:23Z', order_total: 569, cod_cash_due: null, earning: 40 },
    { delivery_id: 7, order_number: 'TT-99006', type: 'food', payment: 'cod', status: 'completed', completed_at: '2026-11-09T13:33:43Z', created_at: '2026-11-04T04:13:18Z', order_total: 602, cod_cash_due: 602, earning: 40 },
  ],
}

function renderRecords() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <RiderRecords riderId={5} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Admin rider records', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.get.mockResolvedValue(records)
  })

  it('shows status, current delivery, COD vs online deliveries and earnings', async () => {
    renderRecords()
    expect(await screen.findByTestId('rider-status')).toHaveTextContent('Busy')
    const status = within(screen.getByRole('region', { name: 'Status' }))
    expect(status.getByText('TT-11111')).toBeInTheDocument()
    expect(status.getByText('Picked up')).toBeInTheDocument()
    expect(status.getByText('COD')).toBeInTheDocument()

    const deliveries = within(screen.getByRole('region', { name: 'Deliveries' }))
    expect(deliveries.getByText('Today').nextSibling).toHaveTextContent('3')
    expect(deliveries.getByText('COD').nextSibling).toHaveTextContent('2')
    expect(deliveries.getByText('Online').nextSibling).toHaveTextContent('1')
    expect(deliveries.getByText(/All time:/)).toHaveTextContent('12 completed · 7 COD · 5 online · 1 cancelled')

    const earnings = within(screen.getByRole('region', { name: 'Earnings' }))
    expect(earnings.getByText('Today').nextSibling).toHaveTextContent('₱140.00')
    expect(earnings.getByText('From COD').nextSibling).toHaveTextContent('₱80.00')
    expect(earnings.getByText('From online').nextSibling).toHaveTextContent('₱60.00')
    expect(api.get).toHaveBeenCalledWith('/admin/riders/5/records', { params: { date: today } })
  })

  it("shows the day's COD cash: office cash, COD collected, the rider's own money, remittance", async () => {
    renderRecords()
    const cash = within(await screen.findByRole('region', { name: 'COD cash · Today' }))
    expect(cash.getByText('Office cash issued').nextSibling).toHaveTextContent('₱1,000.00')
    expect(cash.getByText('Office cash still with rider').nextSibling).toHaveTextContent('₱100.00')
    expect(cash.getByText('COD cash collected').nextSibling).toHaveTextContent('₱1,204.00')
    expect(cash.getByText("Rider's own money used").nextSibling).toHaveTextContent('₱150.00')
    expect(cash.getByText('To remit to the office').nextSibling).toHaveTextContent('₱974.00')
    expect(cash.getByText(/policy is not active yet/)).toBeInTheDocument()
    expect(cash.getByRole('link', { name: /Daily receipt/ })).toHaveAttribute('href', `/admin/riders/5/cash-reconciliation?date=${today}`)
  })

  it('shows cash out online and the recent deliveries with COD / Online', async () => {
    renderRecords()
    const cashOut = within(await screen.findByRole('region', { name: 'Cash out online' }))
    expect(cashOut.getByText('Available to cash out').nextSibling).toHaveTextContent('₱220.00')
    expect(cashOut.getByText('Paid out').nextSibling).toHaveTextContent('₱300.00')
    expect(cashOut.getByText(/PO-0001/)).toBeInTheDocument()

    const recent = within(screen.getByRole('region', { name: 'Recent deliveries' }))
    const rows = recent.getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByText('TT-62973')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Online')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('COD')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('₱602.00')).toBeInTheDocument()
  })

  it('explains when the COD cash cannot be shown, and reloads for another day', async () => {
    api.get.mockResolvedValue({
      ...records,
      cod_cash: { available: false, reason: "The rider is outside this Tourism Office account's municipality." },
    })
    renderRecords()
    expect(await screen.findByText(/outside this Tourism Office account's municipality/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Records day'), { target: { value: '2026-11-09' } })
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/riders/5/records', { params: { date: '2026-11-09' } }))
  })

  it('clicking a rider row in the Riders table opens that rider', async () => {
    api.get.mockImplementation((url: string) => {
      if (url === '/admin/riders')
        return Promise.resolve({
          data: [{ id: 5, name: 'Johnjobert Calapatia', email: 'j@example.com', phone: null, account_status: 'approved', created_at: '2026-10-12T00:00:00Z' }],
          meta: { current_page: 1, last_page: 1, total: 1 },
        })
      return Promise.resolve(null)
    })
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/admin/riders']}>
          <Routes>
            <Route path="/admin/riders" element={<AdminRiders />} />
            <Route path="/admin/riders/:id" element={<p>Rider page opened</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const row = await screen.findByTestId('rider-row')
    expect(within(row).getByRole('link', { name: 'Johnjobert Calapatia' })).toHaveAttribute('href', '/admin/riders/5')
    fireEvent.click(within(row).getByText('j@example.com'))
    expect(await screen.findByText('Rider page opened')).toBeInTheDocument()
  })
})
