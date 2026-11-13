import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, Clock, ShieldCheck, Wallet } from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { formatCurrency, formatDateTime } from '@/shared/utils'

interface Available {
  earnings: { earning_id: number; reference: string | null; type: 'food' | 'ride'; amount: number }[]
  total: number
  payable: boolean
  cash_total: number
  held_total: number
}

interface CashoutRow {
  id: number
  payout_number: string
  status: 'pending' | 'under_review' | 'approved' | 'paid' | 'rejected' | 'failed' | 'cancelled'
  amount: number
  items_count: number
  destination_gcash_number: string | null
  destination_account_name: string | null
  requested_at: string
  paid_at: string | null
  payment_reference: string | null
  rejection_reason: string | null
  failure_reason: string | null
}

export const CASHOUT_STATUS: Record<CashoutRow['status'], { label: string; tone: string }> = {
  pending: { label: 'Waiting for review', tone: 'bg-[#FEF3C7] text-[#92400E]' },
  under_review: { label: 'Under review', tone: 'bg-[#E0E7FF] text-[#3730A3]' },
  approved: { label: 'Approved · sending to GCash', tone: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  paid: { label: 'Paid', tone: 'bg-[#DCFCE7] text-[#166534]' },
  rejected: { label: 'Rejected', tone: 'bg-[#FEE2E2] text-[#B91C1C]' },
  failed: { label: 'Transfer failed', tone: 'bg-[#FEE2E2] text-[#B91C1C]' },
  cancelled: { label: 'Cancelled', tone: 'bg-[#F3F4F6] text-[#4B5563]' },
}

const OPEN: CashoutRow['status'][] = ['pending', 'under_review', 'approved']

const input = 'mt-1 w-full rounded-lg border border-[#D7E2DC] bg-[#F6F8F4] px-3 py-2 text-sm text-[#17201B]'

/**
 * Rider cashout (decision 2026-11-11): request a cashout of verified ONLINE
 * earnings to GCash. The Tourism Office reviews every request, sends the
 * transfer itself and records the GCash reference.
 */
export function RiderCashoutCard() {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [gcash, setGcash] = useState('')
  const [name, setName] = useState('')
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const available = useQuery({ queryKey: ['rider-cashout-available'], queryFn: () => get<Available>('/rider/payouts/available') })
  const history = useQuery({ queryKey: ['rider-cashouts'], queryFn: () => get<{ data: CashoutRow[] }>('/rider/payouts') })

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['rider-cashout-available'] })
    void queryClient.invalidateQueries({ queryKey: ['rider-cashouts'] })
  }

  const request = useMutation({
    mutationFn: () =>
      post('/rider/payouts/request', {
        amount: amount.trim() === '' ? undefined : Number(amount),
        gcash_number: gcash.trim(),
        account_name: name.trim(),
      }),
    onSuccess: () => {
      setNotice({ type: 'success', text: 'Cashout requested. The Tourism Office will review it and send it to your GCash.' })
      setAmount('')
      refresh()
    },
    onError: (e) => setNotice({ type: 'error', text: apiErrorMessage(e, 'Could not request the cashout.') }),
  })

  const cancel = useMutation({
    mutationFn: (id: number) => post(`/rider/payouts/${id}/cancel`),
    onSuccess: () => {
      setNotice({ type: 'success', text: 'Cashout cancelled. The earnings are available again.' })
      refresh()
    },
    onError: (e) => setNotice({ type: 'error', text: apiErrorMessage(e, 'Could not cancel the cashout.') }),
  })

  const rows = history.data?.data ?? []
  const open = rows.find((r) => OPEN.includes(r.status))
  const total = available.data?.total ?? 0

  return (
    <section aria-label="Cash out" className="mb-6 rounded-2xl border border-[#CFE8D6] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EAF6ED] text-[#16803C]" aria-hidden="true">
            <Wallet className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-base font-bold text-[#17201B]">Cash out online earnings</h2>
            <p className="text-xs text-[#6B7280]">Reviewed by the Tourism Office and sent to your GCash</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">Available</p>
          <p className="text-xl font-bold text-[#16803C]" data-testid="cashout-available">{formatCurrency(total)}</p>
        </div>
      </div>

      <ul className="mt-3 space-y-1 text-xs text-[#4B5563]">
        <li className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-[#16803C]" aria-hidden="true" />
          {available.data?.earnings.length ?? 0} verified online {available.data?.earnings.length === 1 ? 'earning' : 'earnings'}: paid by the customer
          online and trip completed.
        </li>
        {(available.data?.cash_total ?? 0) > 0 && (
          <li className="flex items-center gap-1.5">
            <Banknote className="h-3.5 w-3.5 text-[#92400E]" aria-hidden="true" />
            {formatCurrency(available.data!.cash_total)} from cash trips: you keep it from the cash you collected, so it is not cashed out
            online.
          </li>
        )}
        {(available.data?.held_total ?? 0) > 0 && (
          <li className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-[#6B7280]" aria-hidden="true" />
            {formatCurrency(available.data!.held_total)} waiting for payment confirmation or trip completion.
          </li>
        )}
      </ul>

      {notice && (
        <p role={notice.type === 'error' ? 'alert' : 'status'} className={`mt-3 rounded-lg px-3 py-2 text-sm ${notice.type === 'error' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#F0FDF4] text-[#166534]'}`}>
          {notice.text}
        </p>
      )}

      {open ? (
        <div className="mt-3 rounded-xl border border-[#E5E9E7] bg-[#F6F8F4] p-3" data-testid="cashout-open">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-[#17201B]">
              {open.payout_number} · {formatCurrency(open.amount)}
            </p>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${CASHOUT_STATUS[open.status].tone}`}>{CASHOUT_STATUS[open.status].label}</span>
          </div>
          <p className="mt-1 text-xs text-[#6B7280]">
            To GCash {open.destination_gcash_number} ({open.destination_account_name}) · requested {formatDateTime(open.requested_at)}
          </p>
          {open.status === 'pending' && (
            <button
              type="button"
              onClick={() => cancel.mutate(open.id)}
              disabled={cancel.isPending}
              className="mt-2 rounded-lg border border-[#D7E2DC] px-3 py-1.5 text-xs font-semibold text-[#17201B] hover:bg-white disabled:opacity-50"
            >
              Cancel request
            </button>
          )}
        </div>
      ) : (
        <form
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault()
            setNotice(null)
            request.mutate()
          }}
        >
          <label className="text-xs font-medium text-[#4B5563]">
            Amount (optional)
            <input
              type="number"
              min="1"
              step="0.01"
              inputMode="decimal"
              placeholder={`All ${formatCurrency(total)}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Cashout amount"
              className={input}
            />
          </label>
          <label className="text-xs font-medium text-[#4B5563]">
            GCash number
            <input
              inputMode="numeric"
              placeholder="09XXXXXXXXX"
              value={gcash}
              onChange={(e) => setGcash(e.target.value)}
              aria-label="GCash number"
              maxLength={11}
              className={input}
            />
          </label>
          <label className="text-xs font-medium text-[#4B5563]">
            GCash account name
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="GCash account name" maxLength={120} className={input} />
          </label>
          <button
            type="submit"
            disabled={!available.data?.payable || request.isPending || gcash.trim() === '' || name.trim() === ''}
            className="rounded-lg bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-50 sm:col-span-3"
          >
            {request.isPending ? 'Requesting…' : 'Request cashout'}
          </button>
          <p className="text-[11px] text-[#6B7280] sm:col-span-3">
            The request takes your oldest earnings up to the amount (whole earnings only). The Tourism Office checks each one against its
            order and payment before sending the money.
          </p>
        </form>
      )}

      {rows.filter((r) => r.id !== open?.id).length > 0 && (
        <ul className="mt-3 divide-y divide-[#EEF1EF] border-t border-[#EEF1EF] text-xs" aria-label="Cashout history">
          {rows
            .filter((r) => r.id !== open?.id)
            .slice(0, 5)
            .map((r) => (
              <li key={r.id} className="py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[#17201B]">
                    {r.payout_number} · {formatCurrency(r.amount)}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${CASHOUT_STATUS[r.status].tone}`}>{CASHOUT_STATUS[r.status].label}</span>
                </div>
                {r.status === 'paid' && r.payment_reference && (
                  <p className="mt-0.5 text-[#166534]">
                    GCash ref {r.payment_reference}
                    {r.paid_at ? ` · ${formatDateTime(r.paid_at)}` : ''}
                  </p>
                )}
                {r.status === 'rejected' && r.rejection_reason && <p className="mt-0.5 text-[#B91C1C]">Reason: {r.rejection_reason}</p>}
                {r.status === 'failed' && r.failure_reason && <p className="mt-0.5 text-[#B91C1C]">{r.failure_reason}</p>}
              </li>
            ))}
        </ul>
      )}
    </section>
  )
}
