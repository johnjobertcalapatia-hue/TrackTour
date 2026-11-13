import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, HandCoins, Loader2 } from 'lucide-react'
import { Alert } from '@/shared/components/Alert'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { formatCurrency } from '@/shared/utils'

/** GET /admin/cash-advances (RiderCashFundService::advanceOverview), same data as the Rider Cash page. */
interface RiderCashRow {
  rider_id: number
  name: string
  rider_status: string | null
  advance_today: number
  cash_with_rider: number
  cod_deliveries_today: number
}

interface Overview {
  date: string
  riders: RiderCashRow[]
}

function phToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

/**
 * COD cash advance on the Riders page: the Tourism Office issues each rider
 * today's purchasing cash for COD orders (decision 2026-11-08: a daily advance,
 * not per delivery; a second advance the same day is a top-up). Uses the same API and query as the Rider Cash page
 * (POST /admin/riders/{id}/cash-fund/advances, idempotent per key), so both
 * pages always show the same records. Returns and remittances stay on the
 * rider's daily receipt.
 */
export function RiderCashAdvanceCard() {
  const today = phToday()
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-rider-cash', today],
    queryFn: () => get<Overview>('/admin/cash-advances', { params: { date: today } }),
    refetchInterval: 30000,
  })

  const riders = data?.riders ?? []
  const issuedToday = riders.reduce((sum, r) => sum + r.advance_today, 0)
  const withRiders = riders.reduce((sum, r) => sum + r.cash_with_rider, 0)

  return (
    <section aria-label="COD Cash Advance" className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism mb-8">
      <div className="px-4 py-3 border-b border-[#E2E8E3] flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 shrink-0 bg-[#EAF6ED] rounded-lg flex items-center justify-center">
            <HandCoins aria-hidden="true" className="w-4 h-4 text-[#16803C]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[#17201A]">COD Cash Advance</h2>
            <p className="text-xs text-[#6B7280]">Cash the Tourism Office gives riders today to buy COD orders</p>
          </div>
        </div>
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
          <div className="flex items-center gap-1.5">
            <dt className="text-[#6B7280]">Issued today</dt>
            <dd className="font-semibold text-[#17201A]">{formatCurrency(issuedToday)}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-[#6B7280]">Still with riders</dt>
            <dd className="font-semibold text-[#16803C]">{formatCurrency(withRiders)}</dd>
          </div>
          <Link to="/admin/rider-cash" className="inline-flex items-center gap-0.5 font-semibold text-[#16803C] hover:underline">
            Rider Cash <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </dl>
      </div>

      <div className="p-4">
        {notice && <Alert type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />}

        {isLoading ? (
          <p className="text-sm text-[#6B7280]">Loading riders…</p>
        ) : riders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#D7E8DB] p-6 text-center text-sm text-[#6B7280]">
            No riders in this municipality yet. A rider shows here once their account has this municipality: open the
            rider below and set it.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#E2E8E3]">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs text-[#6B7280]">
                  <th className="py-2 pl-3 pr-2 font-medium">Rider</th>
                  <th className="py-2 px-2 font-medium">COD today</th>
                  <th className="py-2 px-2 font-medium">Issued today</th>
                  <th className="py-2 px-2 font-medium">Cash with rider</th>
                  <th className="py-2 px-2 font-medium">Issue cash</th>
                  <th className="py-2 pl-2 pr-3">
                    <span className="sr-only">Daily receipt</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {riders.map((rider) => (
                  <AdvanceRow key={rider.rider_id} rider={rider} date={today} onNotice={setNotice} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-[#6B7280]">
          Usually issued once in the morning; issue again to top up. COD deliveries draw on it, and at the end of the day
          the rider returns unused cash and remits COD collections on the daily receipt.
        </p>
      </div>
    </section>
  )
}

function AdvanceRow({
  rider,
  date,
  onNotice,
}: {
  rider: RiderCashRow
  date: string
  onNotice: (n: { type: 'success' | 'error'; message: string }) => void
}) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  // One key per intended advance: a double tap or retry records it once.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const issue = useMutation({
    mutationFn: () =>
      post(`/admin/riders/${rider.rider_id}/cash-fund/advances`, {
        amount: Number(amount),
        note: note.trim() || null,
        idempotency_key: idempotencyKey,
      }),
    onSuccess: () => {
      onNotice({ type: 'success', message: `Issued ${formatCurrency(Number(amount))} COD cash to ${rider.name}.` })
      setAmount('')
      setNote('')
      setIdempotencyKey(crypto.randomUUID())
      void queryClient.invalidateQueries({ queryKey: ['admin-rider-cash'] })
    },
    onError: (error) => onNotice({ type: 'error', message: apiErrorMessage(error, 'Could not issue the cash advance.') }),
  })

  const valid = Number(amount) > 0
  const input =
    'bg-[#F6F8F4] border border-[#D7E8DB] rounded-lg text-sm text-[#17201A] py-1 focus:outline-none focus:ring-2 focus:ring-[#16803C]/30'

  return (
    <tr aria-label={rider.name}>
      <td className="py-1.5 pl-3 pr-2">
        <p className="font-medium text-[#17201A]">{rider.name}</p>
        {rider.rider_status && <p className="text-xs capitalize text-[#6B7280]">{rider.rider_status}</p>}
      </td>
      <td className="py-1.5 px-2 text-[#17201A]">{rider.cod_deliveries_today}</td>
      <td className="py-1.5 px-2 font-semibold text-[#17201A]">{formatCurrency(rider.advance_today)}</td>
      <td className="py-1.5 px-2 font-semibold text-[#16803C]">{formatCurrency(rider.cash_with_rider)}</td>
      <td className="py-1.5 px-2">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !issue.isPending) issue.mutate()
          }}
        >
          <div className="relative w-24 shrink-0">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-[#6B7280]">₱</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={`Cash advance for ${rider.name}`}
              className={`${input} w-full pl-5 pr-1.5`}
            />
          </div>
          <input
            type="text"
            maxLength={255}
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label={`Note for ${rider.name}`}
            className={`${input} w-36 px-2`}
          />
          <button
            type="submit"
            disabled={!valid || issue.isPending}
            className="inline-flex items-center gap-1 rounded-lg bg-[#16803C] px-3 py-1 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-50"
          >
            {issue.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            Issue
          </button>
        </form>
      </td>
      <td className="py-1.5 pl-2 pr-3 text-right">
        <Link
          to={`/admin/riders/${rider.rider_id}/cash-reconciliation?date=${date}`}
          className="whitespace-nowrap text-xs font-semibold text-[#16803C] hover:underline"
        >
          Daily receipt
        </Link>
      </td>
    </tr>
  )
}
