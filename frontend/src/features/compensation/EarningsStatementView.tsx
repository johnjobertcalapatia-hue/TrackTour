import { formatCurrency, formatDateTime } from '@/shared/utils'
import { COMPENSATION_STATUS, type EarningsStatement } from './types'

/**
 * Stage D (2026-11-18): a rider's earnings statement — normal earnings and
 * cancellation compensation as separate lines, what is payable now, what was
 * paid, the remaining balance, and each compensation with its cancelled
 * booking. Shown to the rider and to the Tourism Office.
 */
export default function EarningsStatementView({ statement: s, audience = 'rider' }: { statement: EarningsStatement; audience?: 'rider' | 'office' }) {
  const row = 'flex items-center justify-between gap-3 py-1'
  return (
    <section aria-label="Earnings statement" className="rounded-2xl border border-[#E5E9E7] bg-white p-4 text-sm">
      <h2 className="text-base font-bold text-[#17201B]">Earnings statement</h2>
      <dl className="mt-2 divide-y divide-[#EEF1EF]">
        <div className={row}><dt className="text-[#4B5563]">Ride earnings</dt><dd className="font-semibold">{formatCurrency(s.lines.ride_earnings)}</dd></div>
        <div className={row}><dt className="text-[#4B5563]">Delivery earnings</dt><dd className="font-semibold">{formatCurrency(s.lines.delivery_earnings)}</dd></div>
        <div className={row}><dt className="text-[#4B5563]">Cancellation compensation</dt><dd className="font-semibold" data-testid="statement-compensation">{formatCurrency(s.lines.cancellation_compensation)}</dd></div>
        {s.lines.adjustments !== 0 && <div className={row}><dt className="text-[#4B5563]">Adjustments</dt><dd className="font-semibold">{formatCurrency(s.lines.adjustments)}</dd></div>}
        <div className={row}><dt className="font-semibold text-[#17201B]">Total earned (online)</dt><dd className="font-bold">{formatCurrency(s.total_earned)}</dd></div>
        <div className={row}><dt className="text-[#4B5563]">Previously paid</dt><dd className="font-semibold">{formatCurrency(s.previously_paid)}</dd></div>
        <div className={row}><dt className="font-semibold text-[#17201B]">Remaining balance</dt><dd className="font-bold text-[#16803C]" data-testid="statement-remaining">{formatCurrency(s.remaining_balance)}</dd></div>
        <div className={row}>
          <dt className="text-[#4B5563]">Payable now</dt>
          <dd className="text-right font-semibold">
            {formatCurrency(s.total_payable_now)}
            <span className="block text-[11px] font-normal text-[#6B7280]">earnings {formatCurrency(s.payable_now.earnings)} · compensation {formatCurrency(s.payable_now.cancellation_compensation)}</span>
          </dd>
        </div>
      </dl>
      {s.cash_kept > 0 && (
        <p className="mt-2 text-xs text-[#6B7280]">
          {formatCurrency(s.cash_kept)} from cash trips is not included: {audience === 'rider' ? 'you kept it' : 'the rider kept it'} from the cash collected.
        </p>
      )}

      <h3 className="mt-4 text-sm font-bold text-[#17201B]">Cancellation compensation</h3>
      <p className="text-xs text-[#6B7280]">
        ₱50 from a tourist who cancelled more than 5 minutes after {audience === 'rider' ? 'you' : 'the rider'} accepted. Credited once the tourist's fee is received (or advanced by the Tourism Office).
      </p>
      {s.compensations.length === 0 ? (
        <p className="mt-2 text-xs text-[#6B7280]">No cancellation compensation yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[#EEF1EF]" aria-label="Compensation history">
          {s.compensations.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
              <div className="min-w-0">
                <p className="font-semibold text-[#17201B]">Cancelled booking {c.order_number ?? `#${c.cancelled_order_id}`}</p>
                <p className="text-[#6B7280]">
                  {c.funding === 'advance' ? 'Advanced by the Tourism Office' : `Tourist paid ${c.collection_method === 'cash' ? 'in cash' : 'online'}`}
                  {c.earned_at ? ` · ${formatDateTime(c.earned_at)}` : ''}
                  {c.recovered_at ? ' · advance recovered' : ''}
                </p>
                {c.resolution_reason && <p className="text-[#6B7280]">{c.resolution_reason}</p>}
              </div>
              <div className="text-right">
                <p className="font-bold text-[#17201B]">{formatCurrency(c.amount)}</p>
                <span className={`rounded-full px-2 py-0.5 font-semibold ${COMPENSATION_STATUS[c.status].tone}`}>{COMPENSATION_STATUS[c.status].label}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
