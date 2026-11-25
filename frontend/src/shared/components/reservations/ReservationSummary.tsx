import { formatDateTime } from '@/shared/utils'
import {
  ACTOR_LABEL, PAYMENT_OPTION_LABEL, RESERVATION_STATUS, itemDetail, peso, type Reservation,
} from './reservation-types'

const CARD = 'rounded-[20px] border border-[#E2E8E3] bg-white p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]'

export function ReservationStatusBadge({ status }: { status: string }) {
  const s = RESERVATION_STATUS[status] ?? { label: status, tone: 'bg-[#F1F3F2] text-[#56615B]' }
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${s.tone}`} data-testid="reservation-status">{s.label}</span>
}

/**
 * What was reserved and what it costs, how it is paid, the cancellation policy
 * that applies, and the status history — the same for the tourist and the owner.
 */
export function ReservationSummary({ reservation: r, audience }: { reservation: Reservation; audience: 'tourist' | 'owner' }) {
  return (
    <div className="space-y-5">
      <section className={CARD} aria-labelledby="reservation-items-heading">
        <h2 id="reservation-items-heading" className="mb-3 text-base font-bold text-[#17201B]">Reserved</h2>
        <ul className="divide-y divide-[#EEF2EF]" aria-label="Reserved items">
          {r.items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#17201B]">{item.name}</p>
                <p className="text-xs text-[#5E6B63]">{itemDetail(item)}</p>
              </div>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-[#17201B]">{peso(item.subtotal)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between border-t border-[#E2E8E3] pt-3">
          <span className="text-sm font-bold text-[#17201B]">Total</span>
          <span className="text-lg font-bold tabular-nums text-[#126B32]" data-testid="reservation-total">{peso(r.total_amount)}</span>
        </div>
        <p className="mt-1 text-xs text-[#5E6B63]" data-testid="reservation-payment">
          {PAYMENT_OPTION_LABEL[r.payment_option ?? ''] ?? 'Payment'}
          {r.payment_option === 'pay_at_resort' && (audience === 'tourist' ? ' — pay when you arrive.' : ' — collect when the guest arrives.')}
          {r.payment_option === 'gcash' && (r.payment_status === 'paid' || r.payment_status === 'refunded'
            ? ` — ${peso(r.paid_amount)} paid online.`
            : r.payment_status === 'awaiting_payment' ? ' — waiting for payment.' : ' — not paid.')}
        </p>
        {r.refund && r.refund.status !== 'none' && (
          <p className={`mt-2 rounded-xl px-3 py-2 text-sm ${r.refund.status === 'failed' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#EAF6ED] text-[#126B32]'}`} data-testid="reservation-refund">
            {r.refund.status === 'refunded' && `${peso(r.refund.refunded)} refunded to ${audience === 'tourist' ? 'your' : 'the guest’s'} GCash.`}
            {r.refund.status === 'pending' && `Refund of ${peso(r.refund.due)} is on its way (PayMongo is processing it).`}
            {r.refund.status === 'failed' && `Refund of ${peso(r.refund.due - r.refund.refunded)} did not go through yet. TrackTour retries it${audience === 'owner' ? '; the admins are told if it keeps failing' : ' and will contact you if needed'}.`}
          </p>
        )}
      </section>

      {r.cancellation_policy && (
        <section className={CARD} aria-labelledby="reservation-policy-heading">
          <h2 id="reservation-policy-heading" className="mb-1 text-base font-bold text-[#17201B]">Cancellation policy</h2>
          <p className="text-sm text-[#3F4A43]">{r.cancellation_policy.summary}</p>
          {(r.payment_option === 'pay_at_resort' || r.payment_status === 'unpaid' || r.payment_status === 'awaiting_payment') && <p className="mt-1 text-xs text-[#5E6B63]">Nothing was paid online, so cancelling costs nothing.</p>}
        </section>
      )}

      {r.status_logs && r.status_logs.length > 0 && (
        <section className={CARD} aria-labelledby="reservation-history-heading">
          <h2 id="reservation-history-heading" className="mb-3 text-base font-bold text-[#17201B]">History</h2>
          <ol className="space-y-2.5" aria-label="Reservation history">
            {r.status_logs.map((log, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#16803C]" aria-hidden="true" />
                <div>
                  <p className="font-medium text-[#17201B]">{RESERVATION_STATUS[log.to_status]?.label ?? log.to_status}<span className="font-normal text-[#5E6B63]"> · {ACTOR_LABEL[log.actor_type] ?? log.actor_type}</span></p>
                  {log.reason && <p className="text-xs text-[#3F4A43]">“{log.reason}”</p>}
                  <p className="text-xs text-[#8A948E]">{formatDateTime(log.created_at)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
