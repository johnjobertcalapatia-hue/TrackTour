import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminRiderCashReconciliation from '@/features/admin/pages/AdminRiderCashReconciliation'
import RiderCashReconciliation from '@/features/rider/pages/RiderCashReconciliation'

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  apiErrorMessage: vi.fn(() => 'request failed'),
}))

vi.mock('@/shared/services/api', () => api)

const PH_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())

const totals = {
  eligible_delivery_count: 1,
  cash_collected: 500,
  cash_tendered: 550,
  change_given: 50,
  rider_delivery_fee_entitlement: 40,
  rider_tip_entitlement: 10,
  verified_personal_purchase_reimbursement: 20,
  net_cod_remittance_expected: 430,
  additional_rider_payable: 0,
  tourism_office_cash_issued_to_date: 300,
  tourism_office_cash_used_to_date: 250,
  tourism_office_cash_returned_to_date: 0,
  unreturned_tourism_office_cash_balance: 50,
}

function riderReceipt(overrides: Record<string, unknown> = {}) {
  return {
    working_date: PH_DATE,
    policy_status: 'inactive_pending_activation',
    reconciliation_policy: { mutations_enabled: false, effective_date: null, status: 'inactive_pending_activation' },
    deliveries: [],
    excluded_deliveries: [],
    reconciliation: null,
    totals,
    ...overrides,
  }
}

function adminReceipt(overrides: Record<string, unknown> = {}) {
  return {
    working_date: PH_DATE,
    rider: { id: 8, name: 'Rider Test' },
    reconciliation_policy: { mutations_enabled: false, effective_date: null, status: 'inactive_pending_activation' },
    deliveries: [{
      delivery_id: 9,
      completed_at: '2026-10-30T12:00:00Z',
      cash_settled_at: '2026-10-30T12:05:00Z',
      cash_collected: 500,
      cash_tendered: 550,
      change_given: 50,
      rider_delivery_fee_earnings: 40,
      rider_tip_entitlement: 10,
      verified_personal_purchase_contribution: 20,
      cod_settlement: { base: 400, restaurant_share: 320, tourism_office_share: 80 },
      purchases: [{
        purchase_id: 14,
        business_name: 'Restaurant Test',
        planned_purchase_amount: 250,
        expense_submissions: [{
          revision: 1,
          actual_purchase_amount: 250,
          tourism_office_cash_used: 230,
          rider_personal_contribution: 20,
          status: 'verified',
          receipt_evidence_available: true,
        }],
      }],
      purchasing_cash: { transactions: [{ reference_number: 'CASH-001', type: 'cash_issued', amount: 300 }] },
    }],
    reconciliation: {
      id: 17,
      revision: 1,
      status: 'submitted',
      expected_cod_remittance: 430,
      expected_office_cash_return: 50,
      expected_rider_payable: 0,
      submitted_cod_remittance: 430,
      submitted_office_cash_return: 50,
      remittance_reference: 'RCPT-001',
      rider_note: null,
      submitted_at: '2026-10-30T12:00:00Z',
      verified_cod_received: null,
      verified_office_cash_return: null,
      verified_rider_reimbursement: null,
      rider_reimbursement_outstanding: 0,
      verification_note: null,
      verified_at: null,
      closed_at: null,
      corrected_result_status: 'submitted',
      is_finally_reconciled: false,
      corrections: [],
      discrepancies: {
        cod_remittance_vs_expected: 0,
        cash_return_vs_expected: 0,
        office_cod_received_vs_rider_submission: null,
        office_cash_return_vs_rider_submission: null,
      },
      events: [],
    },
    financial_movements: [],
    cash_movement_reference_namespaces: [
      { key: 'office-receipts', type: 'office_receipt', label: 'Office receipt book A' },
      { key: 'paymongo', type: 'provider_transaction', label: 'PayMongo reference' },
    ],
    totals,
    ...overrides,
  }
}

function renderRiderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/rider/cash-reconciliation']}>
        <Routes>
          <Route path="/rider/cash-reconciliation" element={<RiderCashReconciliation />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function renderAdminPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin/riders/8/cash-reconciliation']}>
        <Routes>
          <Route path="/admin/riders/:id/cash-reconciliation" element={<AdminRiderCashReconciliation />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('daily cash reconciliation screens', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset().mockResolvedValue({})
    api.get.mockImplementation(async (path: string) => path.startsWith('/rider/')
      ? riderReceipt()
      : adminReceipt())
  })

  afterEach(() => vi.clearAllMocks())

  it('keeps rider submission disabled while policy is inactive and supports date review', async () => {
    renderRiderPage()

    expect(await screen.findByText(/policy inactive — read-only preview/i)).toBeInTheDocument()
    const submit = screen.getByRole('button', { name: 'Submit daily cash' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Working date'), { target: { value: '2020-01-01' } })
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/rider/cash-fund/daily-receipt', {
        params: { date: '2020-01-01' },
      })
    })
  })

  it('submits the rider cash amounts only when the server enables reconciliation', async () => {
    api.get.mockImplementation(async (path: string) => path.startsWith('/rider/')
      ? riderReceipt({
          policy_status: 'active',
          reconciliation_policy: { mutations_enabled: true, effective_date: PH_DATE, status: 'active' },
        })
      : adminReceipt())
    renderRiderPage()

    fireEvent.change(await screen.findByLabelText('Cash remitted'), { target: { value: '430' } })
    fireEvent.change(screen.getByLabelText('Tourism Office cash returned'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Remittance reference'), { target: { value: 'RCPT-001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit daily cash' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/rider/cash-fund/daily-receipt/submissions', expect.objectContaining({
        date: PH_DATE,
        cash_remitted: 430,
        office_cash_returned: 50,
        remittance_reference: 'RCPT-001',
      }))
    })
  })

  it('shows the Tourism Office submitted record while policy verification remains disabled', async () => {
    renderAdminPage()

    expect(await screen.findByRole('heading', { name: 'Rider Test' })).toBeInTheDocument()
    expect(screen.getByText(/policy inactive — verification and closing disabled/i)).toBeInTheDocument()
    expect(screen.getByText('Delivery #9')).toBeInTheDocument()
    expect(screen.getByText(/Restaurant Test.*planned/)).toBeInTheDocument()
    expect(screen.getByText(/cash issued.*CASH-001/)).toBeInTheDocument()
    expect(screen.getByText('RCPT-001')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Record Tourism Office verification' })).toBeDisabled()
  })

  it('records physical movements separately before verifying a reconciliation', async () => {
    api.get.mockImplementation(async (path: string) => path.startsWith('/rider/')
      ? riderReceipt()
      : adminReceipt({
          reconciliation_policy: { mutations_enabled: true, effective_date: PH_DATE, status: 'active' },
        }))
    renderAdminPage()

    await screen.findByRole('heading', { name: 'Rider Test' })
    fireEvent.change(screen.getByLabelText('Movement amount'), { target: { value: '430' } })
    fireEvent.change(screen.getByLabelText('Physical transaction reference'), { target: { value: 'OFFICE-COD-001' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record physical movement' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/admin/riders/8/cash-fund/daily-receipt/17/movements',
        expect.objectContaining({
          movement_type: 'cod_remittance_received',
          amount: 430,
          reference: 'OFFICE-COD-001',
          reference_namespace: 'office-receipts',
        }),
      )
    })

    fireEvent.change(screen.getByLabelText('Cash physically received'), { target: { value: '430' } })
    fireEvent.change(screen.getByLabelText('Advance physically returned'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Reimbursement actually paid'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record Tourism Office verification' }))
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/admin/riders/8/cash-fund/daily-receipt/17/verify',
        expect.objectContaining({
          cash_received: 430,
          office_cash_returned: 50,
          rider_reimbursement_paid: 0,
        }),
      )
    })
  })

  it('records an independent purchasing-cash return without a COD reconciliation', async () => {
    api.get.mockImplementation(async (path: string) => path.startsWith('/rider/')
      ? riderReceipt()
      : adminReceipt({
          reconciliation_policy: { mutations_enabled: true, effective_date: PH_DATE, status: 'active' },
          reconciliation: null,
          deliveries: [],
        }))
    renderAdminPage()

    fireEvent.change(await screen.findByLabelText('Cash-fund return amount'), { target: { value: '25' } })
    fireEvent.change(screen.getByLabelText('Cash-fund return reference'), { target: { value: 'RETURN-001' } })
    fireEvent.change(screen.getByLabelText('Cash-fund return evidence'), { target: { value: 'Signed receipt slip' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record cash-fund return' }))

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/admin/riders/8/cash-fund/returns',
        expect.objectContaining({
          amount: 25,
          reference: 'RETURN-001',
          reference_namespace: 'office-receipts',
          evidence_details: 'Signed receipt slip',
          transaction_at: expect.any(String),
        }),
      )
    })
  })

  it('shows and closes a correction cycle separately from the original closure', async () => {
    const original = adminReceipt().reconciliation
    api.get.mockImplementation(async (path: string) => path.startsWith('/rider/')
      ? riderReceipt()
      : adminReceipt({
          reconciliation_policy: { mutations_enabled: true, effective_date: PH_DATE, status: 'active' },
          reconciliation: {
            ...original,
            status: 'closed',
            corrected_result_status: 'correction_reviewed_pending_close',
            is_finally_reconciled: false,
            corrections: [{
              id: 21,
              cycle_number: 1,
              status: 'reviewed',
              balance_snapshot: { cod_remittance_outstanding: '0.00' },
              created_by: { id: 1, name: 'Officer' },
              created_at: '2026-10-30T12:00:00Z',
              review_decision: 'approve',
              review_note: 'Reviewed correction.',
              reviewed_by: { id: 1, name: 'Officer' },
              reviewed_at: '2026-10-30T12:01:00Z',
              closed_by: null,
              closed_at: null,
              movement_ids: [104, 105],
            }],
          },
        }))
    renderAdminPage()

    expect(await screen.findByText(/original closure preserved · correction cycle 1: reviewed/i)).toBeInTheDocument()
    expect(screen.getByText('Linked ledger movements: #104, #105')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close corrected result' }))
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/admin/riders/8/cash-fund/daily-receipt/17/corrections/21/close',
        expect.objectContaining({ idempotency_key: expect.any(String) }),
      )
    })
  })
})
