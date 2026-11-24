import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ get: api.get, post: api.post, apiErrorMessage: (_e: unknown, f: string) => f }))

import AdminRidePenalties, { type AdminRidePenalty } from '@/features/admin/pages/AdminRidePenalties'
import { RIDERS_TABS } from '@/features/admin/sectionTabs'

/** Stage C2 (2026-11-18): the Tourism Office sees cancellation fees and waives one with a reason. */

const OWED: AdminRidePenalty = {
  id: 3, cancelled_order_id: 27, order_number: 'TRP-6AFD5987F17B8', tourist_name: 'Jayvie De Torres', rider_name: 'Aldrin Robledo',
  amount: 50, status: 'owed', seconds_after_acceptance: 1018, cancelled_at: '2026-11-18T08:12:11Z',
  evidence: { fixes_since_acceptance: 0, pickup_arrival_confirmed_at: null, latest_fix_distance_to_pickup_m: null },
  review_reasons: [], dispute_reason: null, waiver_reason: null, waived_at: null, waived_by: null, collected_at: null, collection_method: null, can_waive: true,
}

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AdminRidePenalties /></QueryClientProvider>,
)

beforeEach(() => {
  api.get.mockReset()
  api.post.mockReset()
  api.post.mockResolvedValue({})
})

describe('Admin › Riders › Cancellation fees', () => {
  it('is a tab of the Riders module', () => {
    expect(RIDERS_TABS.map((t) => t.label)).toEqual(['Rider accounts', 'Fare configuration', 'Cancellation fees'])
    expect(RIDERS_TABS[2]!.to).toBe('/admin/riders/cancellation-fees')
  })

  it('lists a fee with who, when and the GPS evidence for reference, and waives it only with a reason', async () => {
    api.get.mockResolvedValue({ penalties: [OWED], counts: { owed: 1, under_review: 0, disputed: 0, waived: 0, collected: 0 } })
    renderPage()
    const row = await screen.findByRole('article', { name: 'Cancellation fee TRP-6AFD5987F17B8' })
    expect(row).toHaveTextContent('Owed')
    expect(row).toHaveTextContent('Jayvie De Torres cancelled 17 min after Aldrin Robledo accepted')
    expect(row).toHaveTextContent('Evidence (for reference): 0 GPS fix(es) since acceptance, no confirmed arrival')
    expect(screen.getByRole('button', { name: 'Owed (1)' })).toBeInTheDocument()

    fireEvent.click(within(row).getByRole('button', { name: 'Waive' }))
    const submit = within(row).getByRole('button', { name: 'Waive fee' })
    expect(submit).toBeDisabled()
    fireEvent.change(within(row).getByLabelText('Why is this fee waived?'), { target: { value: 'The driver reported a breakdown.' } })
    await act(async () => { fireEvent.click(submit) })
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/ride-penalties/3/waive', { reason: 'The driver reported a breakdown.' }))
  })

  it('a waived or paid fee shows its record and cannot be waived again; the historical review note is shown', async () => {
    api.get.mockResolvedValue({
      penalties: [
        { ...OWED, id: 4, status: 'waived', can_waive: false, waiver_reason: 'Breakdown.', waived_by: 'Bansud Tourism Office', waived_at: '2026-11-18T09:00:00Z' },
        { ...OWED, id: 5, order_number: 'TRP-OLD', status: 'under_review', review_reasons: ['No saved rider location since the booking was accepted.'] },
      ],
      counts: {},
    })
    renderPage()
    const waived = await screen.findByRole('article', { name: 'Cancellation fee TRP-6AFD5987F17B8' })
    expect(waived).toHaveTextContent('Waived by Bansud Tourism Office')
    expect(waived).toHaveTextContent('Breakdown.')
    expect(within(waived).queryByRole('button', { name: 'Waive' })).toBeNull()
    const old = screen.getByRole('article', { name: 'Cancellation fee TRP-OLD' })
    expect(old).toHaveTextContent('Under review')
    expect(old).toHaveTextContent('Earlier review note: No saved rider location since the booking was accepted.')
  })

  it('filters by status', async () => {
    api.get.mockResolvedValue({ penalties: [], counts: {} })
    renderPage()
    await screen.findByText('No cancellation fees.')
    fireEvent.click(screen.getByRole('button', { name: 'Disputed' }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/admin/ride-penalties?status=disputed'))
  })
})
