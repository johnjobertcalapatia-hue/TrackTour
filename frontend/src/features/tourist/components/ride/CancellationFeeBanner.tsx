import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { apiErrorMessage, get } from '@/shared/services/api'
import { ONLINE_PAYMENT_NAME } from '@/shared/services/payment'
import { formatCurrency } from '@/shared/utils'
import { usePayCancellationFee, type CancellationPenalty } from './CancellationPenaltyCard'

export const PENALTIES_KEY = ['tourist', 'transport-penalties']

type PenaltiesResponse = { penalties: CancellationPenalty[]; outstanding_total: number }

/**
 * Owner decision 2026-11-23: the tourist's OWED cancellation fees, added to
 * the next ride or food order payment (cash or online). No review, no dispute.
 */
export function useOwedCancellationFees(enabled = true) {
  const { data } = useQuery({
    queryKey: PENALTIES_KEY,
    queryFn: () => get<PenaltiesResponse>('/tourist/transport/penalties'),
    enabled,
  })
  const fees = (data?.penalties ?? []).filter((p) => p.status === 'owed')
  const total = Math.round(fees.reduce((sum, p) => sum + Number(p.amount), 0) * 100) / 100
  return { fees, total }
}

/** One line per owed fee, for a price breakdown. */
export function OwedFeeLines({ fees, className = 'text-xs text-[#68736D]' }: { fees: CancellationPenalty[]; className?: string }) {
  return (
    <>
      {fees.map((p) => (
        <div key={p.id} className={`flex justify-between ${className}`} data-testid="owed-cancellation-fee">
          <span>Cancellation fee{p.order_number ? ` (ride ${p.order_number})` : ''}</span>
          <span className="font-medium text-[#B45309]">{formatCurrency(Number(p.amount))}</span>
        </div>
      ))}
    </>
  )
}

/** Before booking or ordering: the owed fee and that it is added to this payment. */
export default function CancellationFeeBanner() {
  const { fees } = useOwedCancellationFees()
  const pay = usePayCancellationFee()
  if (fees.length === 0) return null

  return (
    <div className="mb-4 space-y-2">
      {fees.map((p) => (
        <section key={p.id} role="alert" aria-label="Cancellation fee" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-[#7C4A03]">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            You owe a {formatCurrency(p.amount)} cancellation fee
          </p>
          <p className="mt-1 text-xs text-[#7C4A03]">
            You cancelled {p.order_number ? `ride ${p.order_number}` : 'a ride'} {Math.max(1, Math.round(p.seconds_after_acceptance / 60))} min after your driver accepted.{' '}
            It is added to this ride's payment (cash to your driver, or online) and goes to the driver who accepted that ride. You can also pay it now.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {p.can_pay && (
              <button
                type="button"
                onClick={() => pay.mutate(p.id)}
                disabled={pay.isPending}
                className="h-9 rounded-full bg-[#087F3F] px-4 text-xs font-bold text-white disabled:opacity-60"
              >
                {pay.isPending ? 'Opening PayMongo…' : `Pay ${formatCurrency(p.amount)} now (${ONLINE_PAYMENT_NAME})`}
              </button>
            )}
            {p.cancelled_order_id && (
              <Link to={`/tourist/transport/tracking/${p.cancelled_order_id}`} className="text-xs font-semibold text-[#087F3F] underline">
                View the cancelled ride
              </Link>
            )}
          </div>
          {pay.isError && <p role="alert" className="mt-1 text-xs text-[#B91C1C]">{apiErrorMessage(pay.error, "Couldn't open the payment.")}</p>}
        </section>
      ))}
    </div>
  )
}

/** On the next ride: the owed fee this ride's driver can collect, or pay it online. */
export function CancellationFeeDueCard({ due }: { due: { penalty_id: number; amount: number; from_ride: string | null } }) {
  const pay = usePayCancellationFee()
  return (
    <section aria-label="Unpaid cancellation fee" className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm">
      <p className="font-semibold text-[#7C4A03]">Unpaid cancellation fee: {formatCurrency(due.amount)}</p>
      <p className="mt-0.5 text-xs text-[#7C4A03]">
        From {due.from_ride ? `ride ${due.from_ride}` : 'an earlier ride'}. It is added to this ride: give it to your driver in cash with the fare, or it is included when you pay online. You can also pay it now.
      </p>
      <button
        type="button"
        onClick={() => pay.mutate(due.penalty_id)}
        disabled={pay.isPending}
        className="mt-2 h-9 w-full rounded-full border-2 border-[#087F3F] bg-white text-xs font-bold text-[#087F3F] disabled:opacity-60"
      >
        {pay.isPending ? 'Opening PayMongo…' : `Pay ${formatCurrency(due.amount)} now (${ONLINE_PAYMENT_NAME})`}
      </button>
      {pay.isError && <p role="alert" className="mt-1 text-xs text-[#B91C1C]">{apiErrorMessage(pay.error, "Couldn't open the payment.")}</p>}
    </section>
  )
}
