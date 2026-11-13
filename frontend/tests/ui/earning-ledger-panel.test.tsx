import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ ...api, apiErrorMessage: (_e: unknown, f: string) => f }))

import { EarningLedgerPanel, type EarningLedger } from '@/features/admin/components/EarningLedgerPanel'

const LEDGER: EarningLedger = {
  earning_id: 5, recorded_total: 60, earned: 70, in_cashout: 0, paid_out: 0, available: 70, two_person_threshold: 5000,
  entries: [
    { id: 1, type: 'earning_posted', bucket: 'earned', amount: 60, channel: 'online', reason: null, by: 'System', approved_by: null, payout_id: null, at: '2026-11-11T03:00:00Z' },
    { id: 2, type: 'adjustment', bucket: 'earned', amount: 10, channel: 'online', reason: 'Long wait at pickup', by: 'Staff A', approved_by: null, payout_id: null, at: '2026-11-11T04:00:00Z' },
  ],
}

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EarningLedgerPanel earningId={5} />
    </QueryClientProvider>,
  )

describe('Earning ledger panel (Stage 5)', () => {
  beforeEach(() => {
    api.get.mockReset().mockResolvedValue(LEDGER)
    api.post.mockReset().mockResolvedValue(LEDGER)
  })

  it('shows the balances and the permanent entries', async () => {
    wrap()
    const entries = within(await screen.findByRole('list', { name: 'Ledger entries' }))
    expect(entries.getByText('Commission posted')).toBeInTheDocument()
    expect(entries.getByText(/Long wait at pickup/)).toBeInTheDocument()
    expect(screen.getByText('Available').nextSibling).toHaveTextContent('₱70.00')
    expect(api.get).toHaveBeenCalledWith('/admin/rider-earnings/5/ledger')
  })

  it('records an adjustment only with amount, reason and password', async () => {
    wrap()
    const form = within(await screen.findByRole('form', { name: 'Adjust earning' }))
    const submit = form.getByRole('button', { name: 'Record adjustment' })
    expect(submit).toBeDisabled()

    fireEvent.change(form.getByLabelText('Adjustment amount'), { target: { value: '-15' } })
    fireEvent.change(form.getByLabelText('Adjustment reason'), { target: { value: 'Duplicate fee' } })
    fireEvent.change(form.getByLabelText('Staff password'), { target: { value: 'StaffA-pass1' } })
    expect(form.queryByLabelText('Second staff email')).toBeNull()
    fireEvent.click(submit)

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/rider-earnings/5/adjust', { amount: -15, reason: 'Duplicate fee', password: 'StaffA-pass1' }),
    )
  })

  it('asks for a second staff member at or above the threshold', async () => {
    wrap()
    const form = within(await screen.findByRole('form', { name: 'Adjust earning' }))
    fireEvent.change(form.getByLabelText('Adjustment amount'), { target: { value: '5000' } })
    fireEvent.change(form.getByLabelText('Adjustment reason'), { target: { value: 'Year-end correction' } })
    fireEvent.change(form.getByLabelText('Staff password'), { target: { value: 'StaffA-pass1' } })
    expect(form.getByRole('button', { name: 'Record adjustment' })).toBeDisabled()

    fireEvent.change(form.getByLabelText('Second staff email'), { target: { value: 'b@bansud.gov.ph' } })
    fireEvent.change(form.getByLabelText('Second staff password'), { target: { value: 'StaffB-pass1' } })
    fireEvent.click(form.getByRole('button', { name: 'Record adjustment' }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/admin/rider-earnings/5/adjust', expect.objectContaining({ second_staff_email: 'b@bansud.gov.ph', second_staff_password: 'StaffB-pass1' })),
    )
  })
})
