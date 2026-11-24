import { useMutation } from '@tanstack/react-query'
import { apiErrorMessage } from '@/shared/services/api'
import { createCheckoutSession, ONLINE_PAYMENT_NAME } from '@/shared/services/payment'
import { openExternalPage } from '@/shared/utils/external-redirect'
import { formatCurrency } from '@/shared/utils'

export interface CancellationPenalty {
  id: number
  amount: number
  status: 'owed' | 'under_review' | 'disputed' | 'waived' | 'collected'
  rider_name: string | null
  seconds_after_acceptance: number
  review_reasons: string[]
  disputed_at: string | null
  dispute_reason: string | null
  can_dispute: boolean
  /** Stage C: only an owed fee can be paid (online here, or in cash to the next driver). */
  can_pay?: boolean
  collected_at?: string | null
  collection_method?: 'cash' | 'online' | null
  order_number?: string | null
  cancelled_order_id?: number
  /** Sent with the cancel response: the tourist's notification text. */
  notice?: { title: string; message: string }
  /** Stage C2: waived by the Tourism Office, with its reason. */
  waived_at?: string | null
  waiver_reason?: string | null
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
  // Older statuses (before 2026-11-23); such fees were made owed.
  under_review: 'Owed',
  disputed: 'Owed',
  waived: 'Waived by the Tourism Office — you owe nothing for it',
  collected: 'Paid',
}

/** Pay an owed cancellation fee online (GCash or QR Ph), on its own (Stage C, 2026-11-18). */
export function usePayCancellationFee() {
  return useMutation({
    mutationFn: async (penaltyId: number) => {
      const data = await createCheckoutSession('ride_penalty', penaltyId, 'gcash')
      openExternalPage(data.checkout_url)
      return data
    },
  })
}

/** Cancel dialog note (Stage B, 2026-11-18): free for 5 minutes after the driver accepts, then ₱50 may apply. */
export function cancellationFeeNote(preview: CancellationPenaltyPreview | null | undefined): string {
  if (!preview) return 'Cancelling before a driver accepts is free.'
  if (!preview.applies_now) {
    const left = Math.max(0, Math.round((Date.parse(preview.free_until) - Date.parse(preview.server_now)) / 1000))
    return `Free cancellation for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} more. After 5 minutes from your driver's acceptance, a ${formatCurrency(preview.amount)} cancellation fee applies, paid to your driver.`
  }
  // 2026-11-23: owed on cancelling and added to the next ride or food order payment.
  return `It's been more than 5 minutes since your driver accepted, so a ${formatCurrency(preview.amount)} cancellation fee applies, paid to your driver. It will be added to your next ride or food order payment.`
}

/** After a cancellation: the penalty and its status (no dispute, 2026-11-23). */
export default function CancellationPenaltyCard({ penalty }: { tripId?: number; penalty: CancellationPenalty }) {
  const pay = usePayCancellationFee()

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
      {penalty.status === 'waived' && penalty.waiver_reason && <p className="mt-1 text-xs text-[#7C4A03]">Reason: {penalty.waiver_reason}</p>}
      {penalty.status === 'collected' && (
        <p className="mt-1 text-xs text-[#7C4A03]">Paid {penalty.collection_method === 'online' ? 'online' : 'in cash to your driver'}. Thank you.</p>
      )}
      {penalty.can_pay && (
        <>
          <p className="mt-1 text-xs text-[#7C4A03]">It will be added to your next ride or food order payment (cash or online). You can also pay it now.</p>
          <button
            type="button"
            onClick={() => pay.mutate(penalty.id)}
            disabled={pay.isPending}
            className="mt-2 h-9 w-full rounded-full bg-[#087F3F] text-xs font-bold text-white disabled:opacity-60"
          >
            {pay.isPending ? 'Opening PayMongo…' : `Pay ${formatCurrency(penalty.amount)} now (${ONLINE_PAYMENT_NAME})`}
          </button>
          {pay.isError && <p role="alert" className="mt-1 text-xs text-[#B91C1C]">{apiErrorMessage(pay.error, "Couldn't open the payment.")}</p>}
        </>
      )}
    </section>
  )
}
