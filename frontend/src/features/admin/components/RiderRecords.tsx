import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Banknote, Bike, CalendarDays, ChevronRight, CircleDollarSign, HandCoins, Info, Package, Wallet } from 'lucide-react'
import { get } from '@/shared/services/api'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { EarningLedgerPanel } from './EarningLedgerPanel'

interface Counts {
  total: number
  cod: number
  online: number
  rides: number
}

interface EarningTotals {
  total: number
  delivery_fee_share: number
  tips: number
  from_cod: number
  from_online: number
  adjustments?: number
}

/** GET /admin/riders/{id}/records (RiderRecordsService::summary). */
export interface RiderRecordsData {
  date: string
  rider: {
    id: number
    name: string
    account_status: string
    rider_status: string
    current_service: string | null
    municipality: string | null
    active_delivery: { delivery_id: number; order_number: string | null; status: string; payment: 'cod' | 'online' } | null
  }
  deliveries: { all_time: Counts; on_date: Counts; cancelled: number }
  earnings: { all_time: EarningTotals; on_date: EarningTotals }
  cash_out: {
    available: number
    pending: number
    paid: number
    payouts: { payout_number: string; amount: number; status: string; requested_at: string | null; paid_at: string | null }[]
  }
  cod_cash:
    | { available: false; reason: string }
    | {
        available: true
        receipt_status: string
        policy_status: string
        cod_deliveries: number
        office_cash_issued: number
        office_cash_used: number
        office_cash_returned: number
        office_cash_with_rider: number
        cod_cash_collected: number
        rider_own_money_used: number
        delivery_fee_earned: number
        tips_earned: number
        net_cod_remittance: number | null
        payable_to_rider: number | null
      }
  recent_deliveries: {
    delivery_id: number
    order_number: string | null
    type: 'food' | 'ride'
    payment: 'cod' | 'online'
    status: string
    completed_at: string | null
    created_at: string
    order_total: number | null
    cod_cash_due: number | null
    earning: number
    earning_ids?: number[]
  }[]
}

function phToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

const STATUS_STYLE: Record<string, string> = {
  available: 'bg-[#EAF6ED] text-[#16803C]',
  online: 'bg-[#EAF6ED] text-[#16803C]',
  busy: 'bg-[#FEF3C7] text-[#92400E]',
  on_delivery: 'bg-[#FEF3C7] text-[#92400E]',
  offline: 'bg-[#F3F4F6] text-[#4B5563]',
}

const label = (value: string) => value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

function PaymentBadge({ payment }: { payment: 'cod' | 'online' }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
        payment === 'cod' ? 'bg-[#FFF7D6] text-[#92400E]' : 'bg-[#E0F2FE] text-[#075985]'
      }`}
    >
      {payment === 'cod' ? 'COD' : 'Online'}
    </span>
  )
}

function Card({ title, icon, children, aside }: { title: string; icon: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-2xl border border-[#E2E8E3] bg-white p-4 shadow-tourism">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-base font-semibold text-[#17201A]">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#EAF6ED] text-[#16803C]" aria-hidden="true">
            {icon}
          </span>
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Figure({ name, value, strong = false, hint }: { name: string; value: string | number; strong?: boolean; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-[#6B7280]">{name}</dt>
      <dd className={strong ? 'text-lg font-bold text-[#16803C]' : 'text-base font-semibold text-[#17201A]'}>{value}</dd>
      {hint && <p className="text-[11px] leading-tight text-[#6B7280]">{hint}</p>}
    </div>
  )
}

/**
 * Rider records for the Tourism Office: status, deliveries (COD vs online),
 * earnings, the day's COD cash (office cash, COD collected, the rider's own
 * money used and what is remitted or reimbursed), and cash out online.
 * Read-only: money is recorded on the daily receipt and payout pages.
 */
export function RiderRecords({ riderId }: { riderId: number | string }) {
  const today = phToday()
  const [date, setDate] = useState(today)
  const [openLedger, setOpenLedger] = useState<number | null>(null)
  const isToday = date === today
  const dayLabel = isToday ? 'Today' : date

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-rider-records', String(riderId), date],
    queryFn: () => get<RiderRecordsData>(`/admin/riders/${riderId}/records`, { params: { date } }),
    refetchInterval: isToday ? 30000 : false,
  })

  return (
    <div className="mb-8 space-y-4" data-testid="rider-records">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[#17201A]">Rider records</h2>
          <p className="text-sm text-[#6B7280]">Deliveries, earnings, COD cash and cash out</p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-[#17201A]">
          <CalendarDays className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> Day
          <input
            type="date"
            aria-label="Records day"
            value={date}
            max={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-lg border border-[#D7E8DB] px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      {isLoading && <p className="text-sm text-[#6B7280]">Loading rider records…</p>}
      {isError && <p role="alert" className="text-sm text-[#B91C1C]">Could not load the rider records.</p>}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card title="Status" icon={<Bike className="h-4 w-4" />}>
              <dl className="space-y-2">
                <div>
                  <dt className="text-xs text-[#6B7280]">Now</dt>
                  <dd>
                    <span
                      data-testid="rider-status"
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-sm font-semibold ${STATUS_STYLE[data.rider.rider_status] ?? STATUS_STYLE.offline}`}
                    >
                      {label(data.rider.rider_status)}
                    </span>
                    {data.rider.current_service && (
                      <span className="ml-2 text-xs text-[#6B7280]">
                        {data.rider.current_service === 'transport' ? 'Ride hailing' : 'Food delivery'}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[#6B7280]">Current delivery</dt>
                  <dd className="text-sm text-[#17201A]">
                    {data.rider.active_delivery ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{data.rider.active_delivery.order_number ?? `#${data.rider.active_delivery.delivery_id}`}</span>
                        <span>{label(data.rider.active_delivery.status)}</span>
                        <PaymentBadge payment={data.rider.active_delivery.payment} />
                      </span>
                    ) : (
                      'None'
                    )}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card title="Deliveries" icon={<Package className="h-4 w-4" />}>
              <dl className="grid grid-cols-3 gap-3">
                <Figure name={`${dayLabel}`} value={data.deliveries.on_date.total} strong />
                <Figure name="COD" value={data.deliveries.on_date.cod} />
                <Figure name="Online" value={data.deliveries.on_date.online} />
              </dl>
              <p className="mt-3 border-t border-[#EDF0EE] pt-2 text-xs text-[#6B7280]">
                All time: <strong className="text-[#17201A]">{data.deliveries.all_time.total}</strong> completed ·{' '}
                {data.deliveries.all_time.cod} COD · {data.deliveries.all_time.online} online
                {data.deliveries.all_time.rides > 0 ? ` · ${data.deliveries.all_time.rides} rides` : ''} ·{' '}
                {data.deliveries.cancelled} cancelled
              </p>
            </Card>

            <Card title="Earnings" icon={<CircleDollarSign className="h-4 w-4" />}>
              <dl className="grid grid-cols-3 gap-3">
                <Figure name={dayLabel} value={formatCurrency(data.earnings.on_date.total)} strong />
                <Figure name="From COD" value={formatCurrency(data.earnings.on_date.from_cod)} />
                <Figure name="From online" value={formatCurrency(data.earnings.on_date.from_online)} />
              </dl>
              <p className="mt-3 border-t border-[#EDF0EE] pt-2 text-xs text-[#6B7280]">
                All time: <strong className="text-[#17201A]">{formatCurrency(data.earnings.all_time.total)}</strong> (delivery fee{' '}
                {formatCurrency(data.earnings.all_time.delivery_fee_share)} + tips {formatCurrency(data.earnings.all_time.tips)}
                {data.earnings.all_time.adjustments ? ` ${data.earnings.all_time.adjustments < 0 ? '−' : '+'} adjustments ${formatCurrency(Math.abs(data.earnings.all_time.adjustments))}` : ''})
              </p>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card
              title={`COD cash · ${dayLabel}`}
              icon={<HandCoins className="h-4 w-4" />}
              aside={
                <Link
                  to={`/admin/riders/${data.rider.id}/cash-reconciliation?date=${date}`}
                  className="inline-flex items-center gap-0.5 text-sm font-semibold text-[#16803C] hover:underline"
                >
                  Daily receipt &amp; remittance <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              }
            >
              {data.cod_cash.available ? (
                <>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                    <Figure name="Office cash issued" value={formatCurrency(data.cod_cash.office_cash_issued)} />
                    <Figure name="Office cash used" value={formatCurrency(data.cod_cash.office_cash_used)} />
                    <Figure
                      name="Office cash still with rider"
                      value={formatCurrency(data.cod_cash.office_cash_with_rider)}
                      hint="Returned at the end of the day"
                    />
                    <Figure
                      name="COD cash collected"
                      value={formatCurrency(data.cod_cash.cod_cash_collected)}
                      strong
                      hint={`From ${data.cod_cash.cod_deliveries} COD ${data.cod_cash.cod_deliveries === 1 ? 'delivery' : 'deliveries'}`}
                    />
                    <Figure
                      name="Rider's own money used"
                      value={formatCurrency(data.cod_cash.rider_own_money_used)}
                      hint="Verified; reimbursed at remittance"
                    />
                    <Figure
                      name="Rider keeps (fee + tips)"
                      value={formatCurrency(data.cod_cash.delivery_fee_earned + data.cod_cash.tips_earned)}
                    />
                    <Figure
                      name="To remit to the office"
                      value={data.cod_cash.net_cod_remittance === null ? '—' : formatCurrency(data.cod_cash.net_cod_remittance)}
                      strong
                    />
                    <Figure
                      name="Office pays the rider"
                      value={data.cod_cash.payable_to_rider === null ? '—' : formatCurrency(data.cod_cash.payable_to_rider)}
                      hint="When their costs exceed the COD cash"
                    />
                  </dl>
                  {data.cod_cash.policy_status !== 'active' && (
                    <p className="mt-3 flex gap-2 rounded-lg bg-[#FFFBEB] p-2 text-xs text-[#92400E]">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      The daily COD remittance policy is not active yet, so the remittance figures are a preview.
                    </p>
                  )}
                </>
              ) : (
                <p className="rounded-lg bg-[#FFFBEB] p-3 text-sm text-[#92400E]">
                  {data.cod_cash.reason} Set the rider&apos;s municipality below to see their COD cash.
                </p>
              )}
            </Card>

            <Card title="Cash out online" icon={<Wallet className="h-4 w-4" />}>
              <dl className="grid grid-cols-3 gap-3">
                <Figure name="Available to cash out" value={formatCurrency(data.cash_out.available)} strong />
                <Figure name="In cashout requests" value={formatCurrency(data.cash_out.pending)} hint="Reserved, not yet paid" />
                <Figure name="Paid out" value={formatCurrency(data.cash_out.paid)} />
              </dl>
              {data.cash_out.payouts.length > 0 ? (
                <ul aria-label="Payouts" className="mt-3 space-y-1 border-t border-[#EDF0EE] pt-2 text-xs text-[#6B7280]">
                  {data.cash_out.payouts.map((p) => (
                    <li key={p.payout_number} className="flex justify-between gap-3">
                      <span>
                        {p.payout_number} · {label(p.status)}
                        {p.paid_at ? ` · paid ${formatDateTime(p.paid_at)}` : p.requested_at ? ` · ${formatDateTime(p.requested_at)}` : ''}
                      </span>
                      <span className="font-semibold text-[#17201A]">{formatCurrency(p.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 border-t border-[#EDF0EE] pt-2 text-xs text-[#6B7280]">No cash-out requests yet.</p>
              )}
            </Card>
          </div>

          <Card title="Recent deliveries" icon={<Banknote className="h-4 w-4" />}>
            {data.recent_deliveries.length === 0 ? (
              <p className="text-sm text-[#6B7280]">No deliveries yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[#E2E8E3]">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[#6B7280]">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Order</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Payment</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 text-right font-medium">COD cash</th>
                      <th className="px-3 py-2 text-right font-medium">Earned</th>
                      <th className="px-3 py-2 text-right font-medium"><span className="sr-only">Ledger</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_deliveries.map((d) => (
                      <Fragment key={d.delivery_id}>
                      <tr>
                        <td className="px-3 py-2 text-[#6B7280]">{formatDateTime(d.completed_at ?? d.created_at)}</td>
                        <td className="px-3 py-2 font-medium text-[#17201A]">{d.order_number ?? `#${d.delivery_id}`}</td>
                        <td className="px-3 py-2">{d.type === 'ride' ? 'Ride' : 'Food'}</td>
                        <td className="px-3 py-2">
                          <PaymentBadge payment={d.payment} />
                        </td>
                        <td className="px-3 py-2">{label(d.status)}</td>
                        <td className="px-3 py-2 text-right">{d.cod_cash_due === null ? '—' : formatCurrency(d.cod_cash_due)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-[#17201A]">{formatCurrency(d.earning)}</td>
                        <td className="px-3 py-2 text-right">
                          {(d.earning_ids?.length ?? 0) > 0 && (
                            <button
                              type="button"
                              onClick={() => setOpenLedger(openLedger === d.delivery_id ? null : d.delivery_id)}
                              aria-expanded={openLedger === d.delivery_id}
                              className="text-xs font-semibold text-[#16803C] hover:underline"
                            >
                              {openLedger === d.delivery_id ? 'Hide ledger' : 'Ledger'}
                            </button>
                          )}
                        </td>
                      </tr>
                      {openLedger === d.delivery_id && (
                        <tr>
                          <td colSpan={8} className="bg-[#FAFBFA] px-3 py-3">
                            {(d.earning_ids ?? []).map((id) => <EarningLedgerPanel key={id} earningId={id} />)}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
