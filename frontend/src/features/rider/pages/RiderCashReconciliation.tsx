import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote, CalendarDays, CircleAlert, LockKeyhole, ReceiptText } from 'lucide-react'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { formatCurrency, formatDateTime } from '@/shared/utils'

interface ReceiptDelivery {
  delivery_id: number
  completed_at: string
  cash_settled_at: string
  cash_due: number
  cash_collected: number
  cash_tendered: number
  change_given: number
  rider_delivery_fee_earnings: number
  rider_tip_entitlement: number
  verified_personal_purchase_contribution: number
  cod_settlement: {
    base: number
    restaurant_share: number
    tourism_office_share: number
  }
  purchases: {
    purchase_id: number
    business_name: string | null
    planned_purchase_amount: number
    expense_submissions: {
      revision: number
      actual_purchase_amount: number
      tourism_office_cash_used: number
      rider_personal_contribution: number
      status: string
      receipt_evidence_available: boolean
    }[]
  }[]
}

interface Reconciliation {
  id: number
  revision: number
  status: string
  submitted_cod_remittance: number
  submitted_office_cash_return: number
  remittance_reference: string
  rider_note: string | null
  submitted_at: string
  verified_cod_received: number | null
  verified_office_cash_return: number | null
  verified_rider_reimbursement: number | null
  rider_reimbursement_outstanding: number
  verification_note: string | null
  verified_at: string | null
  closed_at: string | null
  events: { action: string; actor: { name: string } | null; created_at: string }[]
}

interface DailyReceipt {
  working_date: string
  policy_status: string
  reconciliation_policy: { mutations_enabled: boolean; effective_date: string | null; status: string }
  deliveries: ReceiptDelivery[]
  excluded_deliveries: { delivery_id: number; reason: string }[]
  reconciliation: Reconciliation | null
  totals: {
    eligible_delivery_count: number
    cash_collected: number
    cash_tendered: number
    change_given: number
    rider_delivery_fee_entitlement: number
    rider_tip_entitlement: number
    verified_personal_purchase_reimbursement: number
    net_cod_remittance_expected: number | null
    additional_rider_payable: number | null
    tourism_office_cash_issued_to_date: number
    tourism_office_cash_used_to_date: number
    unreturned_tourism_office_cash_balance: number
  }
}

function phDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

function Amount({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-[#E5E9E7] bg-[#F8FAF9] p-4">
      <p className="text-xs text-[#6B7280]">{label}</p>
      <p className="mt-1 text-lg font-semibold text-[#17201B]">{value === null ? '—' : formatCurrency(value)}</p>
    </div>
  )
}

export default function RiderCashReconciliation() {
  const [date, setDate] = useState(phDate)
  const [cashRemitted, setCashRemitted] = useState('')
  const [officeCashReturned, setOfficeCashReturned] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const queryClient = useQueryClient()

  const { data: receipt, isLoading, isError } = useQuery({
    queryKey: ['rider-daily-cash-receipt', date],
    queryFn: () => get<DailyReceipt>('/rider/cash-fund/daily-receipt', { params: { date } }),
  })

  const submitMutation = useMutation({
    mutationFn: () => post('/rider/cash-fund/daily-receipt/submissions', {
      date,
      cash_remitted: Number(cashRemitted),
      office_cash_returned: Number(officeCashReturned),
      remittance_reference: reference.trim(),
      note: note.trim() || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: async () => {
      setNotice({ type: 'success', message: 'Cash submission recorded.' })
      await queryClient.invalidateQueries({ queryKey: ['rider-daily-cash-receipt', date] })
    },
    onError: (error) => setNotice({ type: 'error', message: apiErrorMessage(error, 'Cash submission failed.') }),
  })

  const mutationsEnabled = receipt?.reconciliation_policy.mutations_enabled === true

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-[#087F3F]">
            <ReceiptText className="h-5 w-5" />
            <span className="text-sm font-semibold">Rider cash reconciliation</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-[#17201B]">Daily cash receipt</h1>
          <p className="mt-1 text-sm text-[#6B7280]">Review COD collections, rider earnings, verified purchase contributions, and cash advances.</p>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium text-[#374151]">
          Working date (Philippine time)
          <span className="flex items-center gap-2 rounded-xl border border-[#D7E8DB] bg-white px-3 py-2">
            <CalendarDays className="h-4 w-4 text-[#087F3F]" />
            <input
              aria-label="Working date"
              type="date"
              max={phDate()}
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="bg-transparent outline-none"
            />
          </span>
        </label>
      </header>

      {notice && <Alert type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />}
      {isLoading && <DashboardSkeleton />}
      {isError && <Alert type="error" message="Could not load the daily cash receipt. Please retry." />}

      {receipt && (
        <>
          {!mutationsEnabled && (
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900" role="status">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <p className="font-semibold">{receipt.policy_status === 'legacy_policy' ? 'Legacy policy date — historical preview only' : 'Policy inactive — read-only preview'}</p>
                <p className="mt-1 text-sm">{receipt.policy_status === 'legacy_policy'
                  ? 'The daily COD reconciliation policy does not apply to this historical date. No remittance amount is calculated under the future policy.'
                  : 'No cash submission or return is recorded. Reconciliation actions remain disabled until a separate policy activation is approved.'}</p>
              </div>
            </div>
          )}

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Amount label="Eligible COD amount due" value={receipt.totals.cash_collected} />
            <Amount label="Cash tendered" value={receipt.totals.cash_tendered} />
            <Amount label="Change given" value={receipt.totals.change_given} />
            <Amount label="Expected COD remittance" value={receipt.totals.net_cod_remittance_expected} />
            <Amount label="Delivery-fee earnings" value={receipt.totals.rider_delivery_fee_entitlement} />
            <Amount label="Tip entitlement" value={receipt.totals.rider_tip_entitlement} />
            <Amount label="Verified personal purchase contribution" value={receipt.totals.verified_personal_purchase_reimbursement} />
            <Amount label="Additional payable to rider" value={receipt.totals.additional_rider_payable} />
          </section>

          <section className="rounded-2xl border border-[#E5E9E7] bg-white p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[#17201B]">
              <Banknote className="h-5 w-5 text-[#087F3F]" />
              Tourism Office purchasing cash
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Amount label="Cash issued to date" value={receipt.totals.tourism_office_cash_issued_to_date} />
              <Amount label="Verified cash used" value={receipt.totals.tourism_office_cash_used_to_date} />
              <Amount label="Unreturned balance carried forward" value={receipt.totals.unreturned_tourism_office_cash_balance} />
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-[#E5E9E7] bg-white shadow-sm">
            <div className="border-b border-[#E5E9E7] p-5">
              <h2 className="text-lg font-semibold text-[#17201B]">Eligible deliveries ({receipt.totals.eligible_delivery_count})</h2>
            </div>
            {receipt.deliveries.length === 0 ? (
              <p className="p-5 text-sm text-[#6B7280]">No eligible COD deliveries for this date.</p>
            ) : (
              <div className="divide-y divide-[#E5E9E7]">
                {receipt.deliveries.map((delivery) => (
                  <article key={delivery.delivery_id} className="space-y-3 p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-[#17201B]">Delivery #{delivery.delivery_id}</h3>
                      <p className="text-xs text-[#6B7280]">
                        Completed {formatDateTime(delivery.completed_at)} · Cash settled {formatDateTime(delivery.cash_settled_at)}
                      </p>
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                      <p>Net COD due: <strong>{formatCurrency(delivery.cash_collected)}</strong></p>
                      <p>Fees earned: <strong>{formatCurrency(delivery.rider_delivery_fee_earnings)}</strong></p>
                      <p>Tips: <strong>{formatCurrency(delivery.rider_tip_entitlement)}</strong></p>
                      <p>Verified personal contribution: <strong>{formatCurrency(delivery.verified_personal_purchase_contribution)}</strong></p>
                    </div>
                    <p className="text-xs text-[#6B7280]">
                      Settlement allocation (separate): base {formatCurrency(delivery.cod_settlement.base)} · restaurant {formatCurrency(delivery.cod_settlement.restaurant_share)} · Tourism Office {formatCurrency(delivery.cod_settlement.tourism_office_share)}
                    </p>
                    {delivery.purchases.map((purchase) => (
                      <div key={purchase.purchase_id} className="rounded-lg bg-[#F8FAF9] p-3 text-sm">
                        <p className="font-medium">{purchase.business_name || `Purchase #${purchase.purchase_id}`} · planned {formatCurrency(purchase.planned_purchase_amount)}</p>
                        {purchase.expense_submissions.map((expense) => (
                          <p key={expense.revision} className="mt-1 text-xs text-[#6B7280]">
                            Revision {expense.revision}: {expense.status} · actual {formatCurrency(expense.actual_purchase_amount)} · office {formatCurrency(expense.tourism_office_cash_used)} · rider {formatCurrency(expense.rider_personal_contribution)} · {expense.receipt_evidence_available ? 'receipt evidence available' : 'receipt evidence unavailable'}
                          </p>
                        ))}
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            )}
          </section>

          {receipt.excluded_deliveries.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h2 className="flex items-center gap-2 font-semibold text-amber-900"><CircleAlert className="h-4 w-4" /> Excluded deliveries</h2>
              {receipt.excluded_deliveries.map((entry) => <p key={entry.delivery_id} className="mt-2 text-sm text-amber-900">Delivery #{entry.delivery_id}: {entry.reason}</p>)}
            </section>
          )}

          <section className="rounded-2xl border border-[#E5E9E7] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[#17201B]">Submit cash remittance and returned advance</h2>
            <p className="mt-1 text-sm text-[#6B7280]">
              Expected remittance {receipt.totals.net_cod_remittance_expected === null ? '—' : formatCurrency(receipt.totals.net_cod_remittance_expected)} · expected cash return {formatCurrency(receipt.totals.unreturned_tourism_office_cash_balance)} · payable to you {receipt.totals.additional_rider_payable === null ? '—' : formatCurrency(receipt.totals.additional_rider_payable)}
            </p>
            {receipt.reconciliation && (
              <div className="mt-4 rounded-xl bg-[#F8FAF9] p-4 text-sm">
                <p className="font-semibold capitalize">Submission {receipt.reconciliation.status.replaceAll('_', ' ')} · revision {receipt.reconciliation.revision}</p>
                <p className="mt-1">Reported remittance {formatCurrency(receipt.reconciliation.submitted_cod_remittance)} · returned advance {formatCurrency(receipt.reconciliation.submitted_office_cash_return)}</p>
                <p className="mt-1 text-xs text-[#6B7280]">Reference {receipt.reconciliation.remittance_reference} · submitted {formatDateTime(receipt.reconciliation.submitted_at)}</p>
                {receipt.reconciliation.rider_reimbursement_outstanding > 0 && <p className="mt-1">Rider payable outstanding: {formatCurrency(receipt.reconciliation.rider_reimbursement_outstanding)}</p>}
                {receipt.reconciliation.events.map((event, index) => <p key={`${event.action}-${index}`} className="mt-2 text-xs text-[#6B7280]">{event.action} by {event.actor?.name || 'account'} · {formatDateTime(event.created_at)}</p>)}
              </div>
            )}
            <form
              className="mt-4 grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => { event.preventDefault(); submitMutation.mutate() }}
            >
              <label className="text-sm">Cash remitted
                <input type="number" min="0" step="0.01" value={cashRemitted} onChange={(event) => setCashRemitted(event.target.value)} disabled={!mutationsEnabled || submitMutation.isPending} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
              </label>
              <label className="text-sm">Tourism Office cash returned
                <input type="number" min="0" step="0.01" value={officeCashReturned} onChange={(event) => setOfficeCashReturned(event.target.value)} disabled={!mutationsEnabled || submitMutation.isPending} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
              </label>
              <label className="text-sm sm:col-span-2">Remittance reference
                <input value={reference} onChange={(event) => setReference(event.target.value)} disabled={!mutationsEnabled || submitMutation.isPending} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
              </label>
              <label className="text-sm sm:col-span-2">Explanation (optional)
                <textarea value={note} onChange={(event) => setNote(event.target.value)} disabled={!mutationsEnabled || submitMutation.isPending} rows={3} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
              </label>
              <button type="submit" disabled={!mutationsEnabled || submitMutation.isPending || !cashRemitted || !officeCashReturned || !reference.trim()} className="rounded-xl bg-[#087F3F] px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-2">
                {submitMutation.isPending ? 'Submitting…' : 'Submit daily cash'}
              </button>
            </form>
          </section>
        </>
      )}
    </main>
  )
}
