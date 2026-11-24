import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ post: vi.fn() }))
vi.mock('@/shared/services/api', () => ({ post: api.post, apiErrorMessage: (_e: unknown, f: string) => f }))

import CancellationPenaltyCard, { cancellationFeeNote, type CancellationPenalty } from '@/features/tourist/components/ride/CancellationPenaltyCard'

/** Free for 5 minutes after acceptance, then ₱50 applies; added to the next ride or food order (2026-11-23: no dispute). */

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
      .toMatch(/^Free cancellation for 2:30 more\. After 5 minutes .* ₱50\.00 cancellation fee applies, paid to your driver\./)
    expect(cancellationFeeNote({ amount: 50, free_seconds: 300, free_until: '2026-11-18T02:05:00Z', server_now: '2026-11-18T02:06:00Z', applies_now: true }))
      .toMatch(/more than 5 minutes .* ₱50\.00 cancellation fee applies, paid to your driver\. It will be added to your next ride or food order payment\./)
  })
})

describe('Cancellation penalty card', () => {
  it('shows the fee, who gets it, that it is added to the next payment, and no dispute', () => {
    renderCard({ ...PENALTY, can_pay: true })

    const card = screen.getByRole('region', { name: 'Cancellation fee' })
    expect(card).toHaveTextContent('₱50.00')
    expect(card).toHaveTextContent('You cancelled 7 min after Aldrin Robledo accepted. The fee goes to Aldrin Robledo.')
    expect(screen.getByTestId('penalty-status')).toHaveTextContent('Owed')
    expect(card).toHaveTextContent('It will be added to your next ride or food order payment')
    expect(screen.queryByRole('button', { name: /Dispute/ })).toBeNull()
  })

  it('an older under-review or disputed fee reads as owed', () => {
    renderCard({ ...PENALTY, status: 'under_review' })
    expect(screen.getByTestId('penalty-status')).toHaveTextContent('Owed')
    expect(screen.queryByText(/Tourism Office decides/)).toBeNull()
  })

  it('waived by the Tourism Office (Stage C2): says so, with the reason; nothing to pay or dispute', () => {
    renderCard({ ...PENALTY, status: 'waived', can_dispute: false, can_pay: false, waived_at: '2026-11-18T05:00:00Z', waiver_reason: 'The driver reported a breakdown.' })
    expect(screen.getByTestId('penalty-status')).toHaveTextContent('Waived by the Tourism Office — you owe nothing for it')
    expect(screen.getByText('Reason: The driver reported a breakdown.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pay|Dispute/ })).toBeNull()
  })
})
