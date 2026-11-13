import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), openAuthenticatedDocument: vi.fn(async () => undefined) }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import { RiderCashoutCard } from '@/features/rider/components/RiderCashoutCard'
import AdminRiderCashouts from '@/features/admin/pages/AdminRiderCashouts'
import { CashoutInvestigation, type CashoutDetail, type OriginalRecords } from '@/features/admin/pages/AdminCashoutInvestigation'

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )

// ---------------- rider ----------------

describe('Rider cashout card', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
  })

  it('shows verified online earnings, explains cash and held amounts, and requests to GCash', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/rider/payouts/available'
          ? { earnings: [{ earning_id: 1, reference: 'TT-62973', type: 'food', amount: 40 }], total: 40, payable: true, cash_total: 84.54, held_total: 55 }
          : { data: [] },
      ),
    )
    api.post.mockResolvedValue({})
    wrap(<RiderCashoutCard />)

    await waitFor(() => expect(screen.getByTestId('cashout-available')).toHaveTextContent('₱40.00'))
    expect(screen.getByText(/1 verified online earning/)).toBeInTheDocument()
    expect(screen.getByText(/₱84.54 from cash trips/)).toBeInTheDocument()
    expect(screen.getByText(/₱55.00 waiting for payment confirmation/)).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: 'Request cashout' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByLabelText('GCash number'), { target: { value: '09171234567' } })
    fireEvent.change(screen.getByLabelText('GCash account name'), { target: { value: 'Aldrin Robledo' } })
    fireEvent.click(submit)

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/rider/payouts/request', { amount: undefined, gcash_number: '09171234567', account_name: 'Aldrin Robledo' }),
    )
    expect(await screen.findByText(/Cashout requested/)).toBeInTheDocument()
  })

  it('shows the open request (cancel only while pending) and the GCash reference of paid ones', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url === '/rider/payouts/available'
          ? { earnings: [], total: 0, payable: false, cash_total: 0, held_total: 0 }
          : {
              data: [
                { id: 2, payout_number: 'PYT-2', status: 'pending', amount: 100, items_count: 2, destination_gcash_number: '09171234567', destination_account_name: 'Aldrin Robledo', requested_at: '2026-11-11T03:00:00Z', paid_at: null, payment_reference: null, rejection_reason: null, failure_reason: null },
                { id: 1, payout_number: 'PYT-1', status: 'paid', amount: 40, items_count: 1, destination_gcash_number: '09171234567', destination_account_name: 'Aldrin Robledo', requested_at: '2026-11-10T03:00:00Z', paid_at: '2026-11-10T05:00:00Z', payment_reference: '5012345678901', rejection_reason: null, failure_reason: null },
              ],
            },
      ),
    )
    api.post.mockResolvedValue({})
    wrap(<RiderCashoutCard />)

    const open = within(await screen.findByTestId('cashout-open'))
    expect(open.getByText('Waiting for review')).toBeInTheDocument()
    fireEvent.click(open.getByRole('button', { name: 'Cancel request' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/rider/payouts/2/cancel'))

    const history = within(screen.getByRole('list', { name: 'Cashout history' }))
    expect(history.getByText(/GCash ref 5012345678901/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Request cashout' })).toBeNull()
  })
})

// ---------------- Tourism Office ----------------

const detail = (over: Partial<CashoutDetail> = {}): CashoutDetail => ({
  id: 7,
  payout_number: 'PYT-20261111-ABCD1234',
  status: 'pending',
  amount: 100,
  requested_at: '2026-11-11T03:00:00Z',
  rider: { id: 8, name: 'Aldrin Robledo', email: 'r@example.com', phone: '09170000001', account_status: 'approved', municipality: 'Bansud', member_since: '2026-06-01T00:00:00Z', email_verified: true },
  destination: { gcash_number: '09171234567', account_name: 'Aldrin Robledo' },
  gcash_history: [{ gcash_number: '09171234567', account_name: 'Aldrin Robledo', requests: 2, paid: 1, first_used_at: '2026-10-01T00:00:00Z', last_used_at: '2026-11-01T00:00:00Z' }],
  new_destination: false,
  financial: {
    customer_paid: 720,
    gateway_confirmed: 720,
    earnings_in_request: 100,
    paid_out_before: 40,
    other_open_requests: 0,
    lifetime_online_earnings: 140,
    remaining_unpaid: 0,
    checks: [
      { key: 'gateway_matches', label: 'Provider-confirmed amounts equal what the customers were charged', ok: true },
      { key: 'request_matches_earnings', label: 'Request amount equals its earnings', ok: true },
    ],
  },
  items: [
    {
      earning_id: 1, type: 'food', reference: 'TT-62973', customer_name: 'Jayvie De Torres', restaurant: 'Ekslusibo Grill', payment_method: 'gcash',
      payment_reference: 'pay_abc123', payment_provider: 'paymongo', paid_at: '2026-11-10T11:00:00Z', completed_at: '2026-11-10T11:56:16Z', amount: 40, customer_paid: 360, gateway_amount: 360,
      checks: [
        { key: 'payment', label: 'Payment confirmed by the provider and not refunded', ok: true, detail: null },
        { key: 'completed', label: 'Delivery completed', ok: true, detail: null },
      ],
      verified: true,
    },
    {
      earning_id: 2, type: 'ride', reference: 'TRP-1', customer_name: 'Jayvie De Torres', restaurant: null, payment_method: 'gcash',
      payment_reference: 'pay_def456', payment_provider: 'paymongo', paid_at: '2026-11-11T01:00:00Z', completed_at: '2026-11-11T02:00:00Z', amount: 60, customer_paid: 360, gateway_amount: 360,
      checks: [{ key: 'payment', label: 'Payment confirmed by the provider and not refunded', ok: true, detail: null }],
      verified: true,
    },
  ],
  items_total: 100,
  all_verified: true,
  two_person_threshold: 5000,
  two_person_required: false,
  review: { started_by: null, started_at: null, approved_by: null, approved_at: null, note: null, rejection_reason: null },
  payment: null,
  failure: null,
  history: [{ action: 'payout.requested', description: 'Rider requested cashout PYT-20261111-ABCD1234 of ₱100.00 (2 earnings).', by: 'Aldrin Robledo', at: '2026-11-11T03:00:00Z' }],
  ...over,
})

const foodRecords: OriginalRecords = {
  type: 'food',
  verification: [{ key: 'payment', label: 'Payment confirmed by the provider and not refunded', ok: true }],
  tourist: { name: 'Jayvie De Torres', email: 'tourist@example.com', phone: '09181112222', account_id: 31, account_status: 'approved', email_verified: true, member_since: '2026-09-01T00:00:00Z' },
  order: { id: 5, number: 'TT-62973', status: 'completed', placed_at: '2026-11-10T10:30:00Z', payment_method: 'gcash', payment_status: 'paid', subtotal: 300, delivery_fee: 60, system_fee: 0, tip: 0, total: 360, delivery_address: 'Poblacion, Bansud' },
  restaurants: [{ id: 3, name: 'Ekslusibo Grill', status: 'approved', address: null }],
  items: [{ name: 'Chicken Inasal', quantity: 2, cancelled_quantity: 0, unit_price: 150, subtotal: 300, status: 'ready', business_id: 3 }],
  ride: null,
  payments: [{ number: 'PAY-1', method: 'gcash', provider: 'paymongo', provider_reference: 'pay_abc123', status: 'paid', amount: 360, paid_at: '2026-11-10T10:31:00Z', refunded_at: null }],
  assignment: {
    delivery_id: 9,
    rider: { id: 8, name: 'Aldrin Robledo' },
    status: 'completed',
    assigned_at: '2026-11-10T10:35:00Z',
    dispatch: [
      { rider: 'Other Rider', is_this_rider: false, attempt: 1, response: 'rejected', offered_at: '2026-11-10T10:32:00Z', responded_at: '2026-11-10T10:33:00Z' },
      { rider: 'Aldrin Robledo', is_this_rider: true, attempt: 2, response: 'accepted', offered_at: '2026-11-10T10:34:00Z', responded_at: '2026-11-10T10:35:00Z' },
    ],
  },
  pickups: [{ restaurant: 'Ekslusibo Grill', arrived_at: '2026-11-10T11:10:00Z', confirmed_at: '2026-11-10T11:15:00Z', status: 'picked_up' }],
  completion: { picked_up_at: '2026-11-10T11:15:00Z', arrived_destination_at: '2026-11-10T11:50:00Z', delivered_at: '2026-11-10T11:56:00Z', confirmed_at: '2026-11-10T11:56:00Z', confirmed_by: 'rider (photo at drop-off)', proof_photo: true, proof_distance_m: 12, cash_settled_at: null },
  earning: { id: 1, status: 'earned', earned_at: '2026-11-10T11:56:16Z', delivery_fee_charged: 60, rider_commission: 40, tip: 0, total: 40, formula: 'Rider commission ₱40.00 + tip ₱0.00 = ₱40.00', matches_formula: true },
}

const rideRecords: OriginalRecords = {
  ...foodRecords,
  type: 'ride',
  order: { ...foodRecords.order, number: 'TRP-1' },
  restaurants: [],
  items: [],
  pickups: [],
  ride: { vehicle_type: 'tricycle', passenger_count: 2, fare: 360, distance_km: 4.2, duration_minutes: 12, pickup_address: 'Bansud Plaza', dropoff_address: 'Pagasa' },
}

const summary = { pending_count: 3, under_review_count: 1, awaiting_review_amount: 450.5, approved_unpaid_count: 2, approved_unpaid_amount: 180, paid_today_amount: 95, paid_today_count: 1 }

function mockAdmin(d: CashoutDetail) {
  api.get.mockImplementation((url: string) => {
    if (url === '/admin/payouts/summary') return Promise.resolve(summary)
    if (url === '/admin/payouts') {
      return Promise.resolve({ data: [{ id: 7, payout_number: d.payout_number, status: d.status, amount: d.amount, rider: { id: 8, name: 'Aldrin Robledo' }, destination_gcash_number: '0917•••567', items_count: 2, requested_at: d.requested_at }] })
    }
    if (url === '/admin/payouts/7/earnings/1') return Promise.resolve(foodRecords)
    if (url === '/admin/payouts/7/earnings/2') return Promise.resolve(rideRecords)
    return Promise.resolve(d)
  })
}

describe('Tourism Office cashout dashboard', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
  })

  it('shows the four tiles, the stage tabs, and opens the investigation page from a row', async () => {
    mockAdmin(detail())
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/admin/cashouts']}>
          <Routes>
            <Route path="/admin/cashouts" element={<AdminRiderCashouts />} />
            <Route path="/admin/cashouts/:id" element={<p>Investigation page</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => expect(screen.getByTestId('tile-pending')).toHaveTextContent('3'))
    expect(screen.getByTestId('tile-awaiting')).toHaveTextContent('₱450.50')
    expect(screen.getByTestId('tile-approved')).toHaveTextContent('2')
    expect(screen.getByTestId('tile-paid-today')).toHaveTextContent('₱95.00')

    const tabs = within(screen.getByRole('tablist', { name: 'Cashout status' }))
    for (const name of ['Pending', 'Under Review', 'Approved', 'Paid', 'Rejected']) {
      expect(tabs.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeInTheDocument()
    }
    expect(api.get).toHaveBeenCalledWith('/admin/payouts', { params: { status: 'pending' } })

    fireEvent.click(tabs.getByRole('tab', { name: /^Under Review/ }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/payouts', { params: { status: 'under_review' } }))

    fireEvent.click(await screen.findByTestId('cashout-row'))
    expect(await screen.findByText('Investigation page')).toBeInTheDocument()
  })
})

describe('Tourism Office cashout investigation', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.post.mockReset()
    api.post.mockResolvedValue({})
  })

  it('A–D: rider identity and GCash history, breakdown, original food records, financial checks', async () => {
    mockAdmin(detail())
    wrap(<CashoutInvestigation id={7} />)

    const identity = within(await screen.findByRole('region', { name: 'Rider identity' }))
    expect(identity.getByTestId('gcash-destination')).toHaveTextContent('09171234567')
    expect(within(identity.getByRole('list', { name: 'GCash history' })).getByText('(this request)')).toBeInTheDocument()
    expect(screen.getByTestId('risk-summary')).toHaveTextContent('No warning signs found')

    const breakdown = within(screen.getByRole('table', { name: 'Transaction breakdown' }))
    expect(breakdown.getByText(/Food · TT-62973/)).toBeInTheDocument()
    expect(breakdown.getByText(/Ride · TRP-1/)).toBeInTheDocument()
    expect(breakdown.getByText('pay_abc123')).toBeInTheDocument()

    // C: the first earning's original records load by default.
    const records = within(await screen.findByRole('region', { name: 'Original transaction records' }))
    await waitFor(() => expect(records.getByRole('group', { name: 'Tourist account' })).toHaveTextContent('Jayvie De Torres'))
    expect(records.getByRole('table', { name: 'Order items' })).toHaveTextContent('2× Chicken Inasal')
    expect(records.getByRole('list', { name: 'Payments' })).toHaveTextContent('pay_abc123')
    expect(records.getByRole('list', { name: 'Dispatch history' })).toHaveTextContent('#2 Aldrin Robledo — accepted')
    expect(records.getByRole('list', { name: 'Pickup confirmations' })).toHaveTextContent('Ekslusibo Grill')
    expect(records.getByRole('group', { name: 'Delivery confirmation' })).toHaveTextContent('taken 12 m from the drop-off')
    expect(records.getByTestId('earning-formula')).toHaveTextContent('Rider commission ₱40.00 + tip ₱0.00 = ₱40.00')

    const financial = within(screen.getByRole('region', { name: 'Financial verification' }))
    expect(financial.getByText('Provider confirmed').nextSibling).toHaveTextContent('₱720.00')
    expect(financial.getByTestId('remaining-unpaid')).toHaveTextContent('₱0.00')
    expect(financial.getByRole('list', { name: 'Financial checks' })).toHaveTextContent('Request amount equals its earnings')
    expect(screen.getByRole('list', { name: 'Audit trail' })).toHaveTextContent('Rider requested cashout')
  })

  it('switches the records to a ride booking when its row is investigated', async () => {
    mockAdmin(detail())
    wrap(<CashoutInvestigation id={7} />)
    const breakdown = within(await screen.findByRole('table', { name: 'Transaction breakdown' }))
    fireEvent.click(breakdown.getByText(/Ride · TRP-1/))

    const ride = await screen.findByRole('group', { name: 'Ride booking' })
    expect(ride).toHaveTextContent('tricycle')
    expect(ride).toHaveTextContent('Bansud Plaza')
    expect(api.get).toHaveBeenCalledWith('/admin/payouts/7/earnings/2')
    expect(screen.queryByRole('group', { name: 'Pickup confirmations' })).toBeNull()
  })

  it('flags a new GCash number, a name mismatch and failed checks', async () => {
    const d = detail({
      all_verified: false,
      new_destination: true,
      destination: { gcash_number: '09998887777', account_name: 'Someone Else' },
    })
    d.items[0]!.verified = false
    d.items[0]!.checks[0]!.ok = false
    d.financial!.checks[0]!.ok = false
    mockAdmin(d)
    wrap(<CashoutInvestigation id={7} />)

    const flags = within(await screen.findByRole('list', { name: 'Warning signs' }))
    expect(flags.getByText('One or more earnings failed verification.')).toBeInTheDocument()
    expect(flags.getByText('1 financial check fails.')).toBeInTheDocument()
    expect(flags.getByText('No earlier cashout was paid to this GCash number.')).toBeInTheDocument()
    expect(flags.getByText("The GCash account name differs from the rider's name.")).toBeInTheDocument()
    expect(within(screen.getByRole('table', { name: 'Transaction breakdown' })).getByText(/Payment confirmed by the provider/)).toBeInTheDocument()

    const approve = within(screen.getByRole('form', { name: 'Approve cashout' }))
    fireEvent.change(approve.getByLabelText('Approver password'), { target: { value: 'x' } })
    expect(approve.getByRole('button', { name: 'Approve cashout' })).toBeDisabled()
    expect(approve.getByText(/blocked until every earning verifies/)).toBeInTheDocument()
  })

  it('E: approves only with the staff password; reject needs a reason', async () => {
    mockAdmin(detail())
    wrap(<CashoutInvestigation id={7} />)
    const approve = within(await screen.findByRole('form', { name: 'Approve cashout' }))

    expect(approve.getByRole('button', { name: 'Approve cashout' })).toBeDisabled()
    fireEvent.change(approve.getByLabelText('Approver password'), { target: { value: 'StaffA-pass1' } })
    fireEvent.click(approve.getByRole('button', { name: 'Approve cashout' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/payouts/7/approve', { password: 'StaffA-pass1', note: undefined }))

    fireEvent.click(screen.getByRole('button', { name: 'Reject…' }))
    const reject = within(screen.getByRole('form', { name: 'Reject cashout' }))
    expect(reject.getByRole('button', { name: 'Reject cashout' })).toBeDisabled()
    fireEvent.change(reject.getByLabelText('Rejection reason'), { target: { value: 'GCash name does not match' } })
    fireEvent.click(reject.getByRole('button', { name: 'Reject cashout' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/payouts/7/reject', { reason: 'GCash name does not match' }))
  })

  it('E: approved — confirms the GCash payment with reference, amount, recipient, date, proof and password', async () => {
    mockAdmin(detail({ status: 'approved', two_person_required: true, two_person_threshold: 50, review: { started_by: null, started_at: null, approved_by: { id: 1, name: 'Staff A' }, approved_at: '2026-11-11T03:30:00Z', note: null, rejection_reason: null } }))
    wrap(<CashoutInvestigation id={7} />)
    const pay = within(await screen.findByRole('form', { name: 'Confirm GCash payment' }))

    expect(pay.getByText(/a staff member other than the approver \(Staff A\) must confirm/)).toBeInTheDocument()
    expect(pay.getByLabelText('Recipient GCash number')).toHaveValue('09171234567')
    expect(pay.getByLabelText('Amount sent')).toHaveValue(100)
    expect(pay.getByRole('button', { name: 'Mark as paid' })).toBeDisabled()
    expect(screen.queryByRole('form', { name: 'Approve cashout' })).toBeNull()

    fireEvent.change(pay.getByLabelText('GCash reference number'), { target: { value: '5012345678901' } })
    fireEvent.change(pay.getByLabelText('Proof of transfer'), { target: { files: [new File(['x'], 'gcash.jpg', { type: 'image/jpeg' })] } })
    fireEvent.change(pay.getByLabelText('Payer password'), { target: { value: 'StaffB-pass1' } })
    fireEvent.click(pay.getByRole('button', { name: 'Mark as paid' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1))
    const [url, body] = api.post.mock.calls[0]!
    expect(url).toBe('/admin/payouts/7/mark-paid')
    expect(body).toBeInstanceOf(FormData)
    const form = body as FormData
    expect(form.get('reference')).toBe('5012345678901')
    expect(form.get('amount')).toBe('100')
    expect(form.get('recipient_number')).toBe('09171234567')
    expect(form.get('password')).toBe('StaffB-pass1')
    expect(form.get('proof')).toBeInstanceOf(File)
  })

  it('E: paid — shows the payment record and the proof', async () => {
    mockAdmin(
      detail({
        status: 'paid',
        review: { started_by: null, started_at: null, approved_by: { id: 1, name: 'Staff A' }, approved_at: null, note: null, rejection_reason: null },
        payment: { paid_by: { id: 2, name: 'Staff B' }, paid_at: '2026-11-11T04:00:00Z', reference: '5012345678901', amount: 100, recipient_number: '09171234567', recipient_name: 'Aldrin Robledo', has_proof: true },
      }),
    )
    wrap(<CashoutInvestigation id={7} />)
    const record = within(await screen.findByTestId('payment-record'))
    expect(record.getByText('5012345678901')).toBeInTheDocument()
    expect(record.getByText('Staff B')).toBeInTheDocument()
    fireEvent.click(record.getByRole('button', { name: /View transfer proof/ }))
    expect(api.openAuthenticatedDocument).toHaveBeenCalledWith('/admin/payouts/7/proof')
    expect(screen.queryByRole('form', { name: 'Confirm GCash payment' })).toBeNull()
  })

  // ---- Stage 6: ledger validation ----
  const validation = (result: 'pass' | 'flag' | 'block', failed: { label: string; severity: 'flag' | 'block'; detail: string }[] = []) => ({
    result, context: 'request', checked_by: 'Aldrin Robledo', at: '2026-11-11T03:00:00Z', decision_note: null,
    checks: [{ key: 'amount', label: 'Reserved earnings equal the requested amount', ok: true, severity: 'block' as const, detail: null },
      ...failed.map((f, i) => ({ key: `f${i}`, label: f.label, ok: false, severity: f.severity, detail: f.detail }))],
  })

  it('a FLAGGED cashout needs a documented investigation decision to approve', async () => {
    mockAdmin(detail({ validation: validation('flag', [{ label: 'TT-62973: transaction history verified', severity: 'flag', detail: 'A rider had accepted; refund refused.' }]), decision_note_min: 10 }))
    wrap(<CashoutInvestigation id={7} />)

    const panel = within(await screen.findByRole('region', { name: 'Ledger validation' }))
    expect(panel.getByTestId('validation-result')).toHaveTextContent('FLAG')
    expect(panel.getByRole('list', { name: 'Failed validation checks' })).toHaveTextContent('A rider had accepted; refund refused.')

    const approve = within(screen.getByRole('form', { name: 'Approve cashout' }))
    fireEvent.change(approve.getByLabelText('Approver password'), { target: { value: 'StaffA-pass1' } })
    expect(approve.getByRole('button', { name: 'Approve cashout' })).toBeDisabled()
    fireEvent.change(approve.getByLabelText('Approval note'), { target: { value: 'Checked the order with the restaurant; delivery confirmed.' } })
    fireEvent.click(approve.getByRole('button', { name: 'Approve cashout' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/payouts/7/approve', { password: 'StaffA-pass1', note: 'Checked the order with the restaurant; delivery confirmed.' }))
  })

  it('a BLOCKED cashout cannot be approved, and can be checked again', async () => {
    mockAdmin(detail({ validation: validation('block', [{ label: 'TT-62973: recorded in the earnings ledger', severity: 'block', detail: 'Not recorded in the earnings ledger yet (run earnings:ledger-backfill).' }]) }))
    wrap(<CashoutInvestigation id={7} />)

    const panel = within(await screen.findByRole('region', { name: 'Ledger validation' }))
    expect(panel.getByTestId('validation-result')).toHaveTextContent('BLOCK')
    const approve = within(screen.getByRole('form', { name: 'Approve cashout' }))
    fireEvent.change(approve.getByLabelText('Approver password'), { target: { value: 'StaffA-pass1' } })
    expect(approve.getByRole('button', { name: 'Approve cashout' })).toBeDisabled()

    fireEvent.click(panel.getByRole('button', { name: 'Check again against the ledger' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/payouts/7/validate'))
  })

  it('a PASSING cashout approves with an optional note', async () => {
    mockAdmin(detail({ validation: validation('pass') }))
    wrap(<CashoutInvestigation id={7} />)
    expect(within(await screen.findByRole('region', { name: 'Ledger validation' })).getByTestId('validation-result')).toHaveTextContent('PASS')
    const approve = within(screen.getByRole('form', { name: 'Approve cashout' }))
    fireEvent.change(approve.getByLabelText('Approver password'), { target: { value: 'StaffA-pass1' } })
    expect(approve.getByRole('button', { name: 'Approve cashout' })).toBeEnabled()
  })
})
