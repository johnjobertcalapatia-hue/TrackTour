import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ post: api.post, apiErrorMessage: (_e: unknown, f: string) => f }))

import CancellationPenaltyCard, { cancellationFeeNote, type CancellationPenalty } from '@/features/tourist/components/ride/CancellationPenaltyCard'

/** Stage B (2026-11-18): free for 5 minutes after acceptance, then ₱50 may apply; tourists can dispute. */

const PENALTY: CancellationPenalty = {
  id: 1, amount: 50, status: 'owed', rider_name: 'Aldrin Robledo', seconds_after_acceptance: 420,
  review_reasons: [], disputed_at: null, dispute_reason: null, can_dispute: true,
}

function renderCard(penalty: CancellationPenalty) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CancellationPenaltyCard tripId={31} penalty={penalty} />
    </QueryClientProvider>,
  )
}

describe('cancel dialog note', () => {
  it('free time left, then the ₱50 note, from the server clock', () => {
    expect(cancellationFeeNote(null)).toBe('Cancelling before a driver accepts is free.')
    expect(cancellationFeeNote({ amount: 50, free_seconds: 300, free_until: '2026-11-18T02:05:00Z', server_now: '2026-11-18T02:02:30Z', applies_now: false }))
      .toMatch(/^Free cancellation for 2:30 more\. After 5 minutes .* ₱50\.00 cancellation fee may apply, paid to your driver\./)
    expect(cancellationFeeNote({ amount: 50, free_seconds: 300, free_until: '2026-11-18T02:05:00Z', server_now: '2026-11-18T02:06:00Z', applies_now: true }))
      .toMatch(/more than 5 minutes .* ₱50\.00 cancellation fee may apply.* If your driver wasn't on the way, it is reviewed first\./)
  })
})

describe('Cancellation penalty card', () => {
  it('shows the fee, who gets it, and lets the tourist dispute it', async () => {
    api.post.mockResolvedValue({ penalty: { ...PENALTY, status: 'disputed' } })
    renderCard(PENALTY)

    const card = screen.getByRole('region', { name: 'Cancellation fee' })
    expect(card).toHaveTextContent('₱50.00')
    expect(card).toHaveTextContent('You cancelled 7 min after Aldrin Robledo accepted. The fee goes to Aldrin Robledo.')
    expect(screen.getByTestId('penalty-status')).toHaveTextContent('Owed')

    fireEvent.click(screen.getByRole('button', { name: 'Dispute this fee' }))
    const send = screen.getByRole('button', { name: 'Send dispute' })
    expect(send).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Why should this fee not apply?'), { target: { value: 'The driver was going the wrong way.' } })
    await act(async () => { fireEvent.click(send) })
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tourist/transport/trip/31/penalty/dispute', { reason: 'The driver was going the wrong way.' }))
  })

  it('under review or disputed: nothing is collected meanwhile', () => {
    const { rerender } = renderCard({ ...PENALTY, status: 'under_review' })
    expect(screen.getByTestId('penalty-status')).toHaveTextContent('nothing is collected until the Tourism Office decides')
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <CancellationPenaltyCard tripId={31} penalty={{ ...PENALTY, status: 'disputed', can_dispute: false, dispute_reason: 'Driver never came.' }} />
      </QueryClientProvider>,
    )
    expect(screen.getByTestId('penalty-status')).toHaveTextContent('Disputed')
    expect(screen.getByText('Your dispute: Driver never came.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dispute this fee' })).toBeNull()
  })
})
