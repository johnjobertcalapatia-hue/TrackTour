import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, post } from '@/shared/services/api'
import { formatCurrency } from '@/shared/utils'

export interface CancellationPenalty {
  id: number
  amount: number
  status: 'owed' | 'under_review' | 'disputed' | 'waived'
  rider_name: string | null
  seconds_after_acceptance: number
  review_reasons: string[]
  disputed_at: string | null
  dispute_reason: string | null
  can_dispute: boolean
}

export interface CancellationPenaltyPreview {
  amount: number
  free_seconds: number
  free_until: string
  server_now: string
  applies_now: boolean
}

const STATUS_TEXT: Record<CancellationPenalty['status'], string> = {
  owed: 'Owed',
  under_review: 'Under review — nothing is collected until the Tourism Office decides',
  disputed: 'Disputed — nothing is collected until the Tourism Office decides',
  waived: 'Waived',
}

/** Cancel dialog note (Stage B, 2026-11-18): free for 5 minutes after the driver accepts, then ₱50 may apply. */
export function cancellationFeeNote(preview: CancellationPenaltyPreview | null | undefined): string {
  if (!preview) return 'Cancelling before a driver accepts is free.'
  if (!preview.applies_now) {
    const left = Math.max(0, Math.round((Date.parse(preview.free_until) - Date.parse(preview.server_now)) / 1000))
    return `Free cancellation for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} more. After 5 minutes from your driver's acceptance, a ${formatCurrency(preview.amount)} cancellation fee may apply, paid to your driver.`
  }
  return `It's been more than 5 minutes since your driver accepted, so a ${formatCurrency(preview.amount)} cancellation fee may apply, paid to your driver. If your driver wasn't on the way, it is reviewed first.`
}

/** After a cancellation: the penalty, its status, and a dispute form. */
export default function CancellationPenaltyCard({ tripId, penalty }: { tripId: number; penalty: CancellationPenalty }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const dispute = useMutation({
    mutationFn: () => post(`/tourist/transport/trip/${tripId}/penalty/dispute`, { reason }),
    onSuccess: () => {
      setOpen(false)
      queryClient.invalidateQueries({ queryKey: ['tourist', 'trip-tracking', String(tripId)] })
    },
  })

  return (
    <section aria-label="Cancellation fee" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-[#7C4A03]">Cancellation fee</p>
        <p className="font-bold text-[#7C4A03]">{formatCurrency(penalty.amount)}</p>
      </div>
      <p className="mt-1 text-xs text-[#7C4A03]">
        You cancelled {Math.floor(penalty.seconds_after_acceptance / 60)} min after {penalty.rider_name ?? 'your driver'} accepted. The fee goes to {penalty.rider_name ?? 'that driver'}.
      </p>
      <p className="mt-1 text-xs font-semibold text-[#7C4A03]" data-testid="penalty-status">{STATUS_TEXT[penalty.status]}</p>
      {penalty.dispute_reason && <p className="mt-1 text-xs text-[#7C4A03]">Your dispute: {penalty.dispute_reason}</p>}

      {penalty.can_dispute && !open && (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs font-semibold text-[#087F3F] underline">
          Dispute this fee
        </button>
      )}
      {open && (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 5) dispute.mutate() }}
        >
          <label className="block text-xs font-semibold text-[#17201B]" htmlFor="penalty-dispute-reason">Why should this fee not apply?</label>
          <textarea
            id="penalty-dispute-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-[#E5E9E7] bg-white px-3 py-2 text-sm"
          />
          {dispute.isError && <p role="alert" className="text-xs text-[#B91C1C]">{apiErrorMessage(dispute.error, "Couldn't send your dispute.")}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="h-9 flex-1 rounded-full border border-[#E5E9E7] bg-white text-xs font-semibold">Cancel</button>
            <button type="submit" disabled={reason.trim().length < 5 || dispute.isPending} className="h-9 flex-1 rounded-full bg-[#087F3F] text-xs font-bold text-white disabled:opacity-60">
              {dispute.isPending ? 'Sending…' : 'Send dispute'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
