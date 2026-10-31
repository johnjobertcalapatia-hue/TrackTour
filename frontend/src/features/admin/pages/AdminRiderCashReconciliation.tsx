import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, CalendarDays, LockKeyhole } from 'lucide-react'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { formatCurrency, formatDateTime } from '@/shared/utils'

interface ReceiptRecord {
  id: number
  revision: number
  status: string
  expected_cod_remittance: number
  expected_office_cash_return: number
  expected_rider_payable: number
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
  corrected_result_status: string | null
  is_finally_reconciled: boolean
  corrections: {
    id: number
    cycle_number: number
    status: string
    balance_snapshot: Record<string, string> | null
    created_by: { id: number; name: string } | null
    created_at: string
    review_decision: string | null
    review_note: string | null
    reviewed_by: { id: number; name: string } | null
    reviewed_at: string | null
    closed_by: { id: number; name: string } | null
    closed_at: string | null
    movement_ids?: number[]
  }[]
  discrepancies: Record<string, number | null>
  events: { action: string; actor: { name: string } | null; created_at: string; details: Record<string, unknown> }[]
}

interface Receipt {
  working_date: string
  rider: { id: number; name: string }
  reconciliation_policy: { mutations_enabled: boolean; effective_date: string | null; status: string }
  deliveries: {
    delivery_id: number
    completed_at: string
    cash_settled_at: string
    cash_collected: number
    cash_tendered: number
    change_given: number
    rider_delivery_fee_earnings: number
    rider_tip_entitlement: number
    verified_personal_purchase_contribution: number
    cod_settlement: { base: number; restaurant_share: number; tourism_office_share: number }
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
    purchasing_cash: {
      transactions: { reference_number: string; type: string; amount: number }[]
    }
  }[]
  reconciliation: ReceiptRecord | null
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
    tourism_office_cash_returned_to_date: number
    unreturned_tourism_office_cash_balance: number
  }
  financial_movements: {
    id: number
    business_date: string
    reconciliation_id: number | null
    revision: number | null
    movement_type: string
    affects_type: string | null
    amount: number
    transaction_at: string
    reference: string | null
    reference_type: string | null
    reference_namespace: string | null
    reference_source?: string | null
    reference_issuer?: string | null
    reference_series?: string | null
    evidence_details?: string | null
    reverses_movement_id?: number | null
    recorded_by: { id: number; name: string } | null
    correction_cycle_id?: number | null
    correction_cycle_ids?: number[]
  }[]
  cash_movement_reference_namespaces: { key: string; type: string; label: string }[]
}

function phDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

function localDateTime(): string {
  const current = new Date()
  current.setMinutes(current.getMinutes() - current.getTimezoneOffset())
  return current.toISOString().slice(0, 16)
}

function MoneyRow({ label, value }: { label: string; value: number | null }) {
  return <div className="flex items-center justify-between gap-4 border-b border-[#EDF0EE] py-2 text-sm"><span className="text-[#59645D]">{label}</span><strong className="text-[#17201B]">{value === null ? '—' : formatCurrency(value)}</strong></div>
}

export default function AdminRiderCashReconciliation() {
  const { id } = useParams<{ id: string }>()
  const [date, setDate] = useState(phDate)
  const [cashReceived, setCashReceived] = useState('')
  const [cashReturned, setCashReturned] = useState('')
  const [reimbursement, setReimbursement] = useState('')
  const [movementType, setMovementType] = useState('cod_remittance_received')
  const [movementAmount, setMovementAmount] = useState('')
  const [movementReference, setMovementReference] = useState('')
  const [movementReferenceNamespace, setMovementReferenceNamespace] = useState('')
  const [movementEvidence, setMovementEvidence] = useState('')
  const [returnAmount, setReturnAmount] = useState('')
  const [returnTransactionAt, setReturnTransactionAt] = useState(localDateTime)
  const [returnReference, setReturnReference] = useState('')
  const [returnReferenceNamespace, setReturnReferenceNamespace] = useState('')
  const [returnEvidence, setReturnEvidence] = useState('')
  const [correctionNote, setCorrectionNote] = useState('')
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const queryClient = useQueryClient()
  const queryKey = ['admin-rider-daily-cash-receipt', id, date]

  const { data: receipt, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => get<Receipt>(`/admin/riders/${id}/cash-fund/daily-receipt`, { params: { date } }),
    enabled: !!id,
  })

  useEffect(() => {
    if (!movementReferenceNamespace && receipt?.cash_movement_reference_namespaces[0]) {
      setMovementReferenceNamespace(receipt.cash_movement_reference_namespaces[0].key)
    }
    if (!returnReferenceNamespace && receipt?.cash_movement_reference_namespaces[0]) {
      setReturnReferenceNamespace(receipt.cash_movement_reference_namespaces[0].key)
    }
    const record = receipt?.reconciliation
    if (record) {
      const currentMovements = (receipt?.financial_movements ?? [])
        .filter((movement) => movement.reconciliation_id === record.id)
      const amountFor = (type: string) => currentMovements
        .filter((movement) => (movement.affects_type ?? movement.movement_type) === type)
        .reduce((total, movement) => total + movement.amount, 0)
      setCashReceived(amountFor('cod_remittance_received').toFixed(2))
      setCashReturned(amountFor('office_cash_returned').toFixed(2))
      setReimbursement(amountFor('rider_reimbursement_paid').toFixed(2))
      setNote(record.verification_note ?? '')
    } else {
      setCashReceived('')
      setCashReturned('')
      setReimbursement('')
      setNote('')
    }
  }, [receipt])

  const verifyMutation = useMutation({
    mutationFn: () => post(`/admin/riders/${id}/cash-fund/daily-receipt/${receipt?.reconciliation?.id}/verify`, {
      cash_received: Number(cashReceived),
      office_cash_returned: Number(cashReturned),
      rider_reimbursement_paid: Number(reimbursement),
      note: note.trim() || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: async () => {
      setNotice({ type: 'success', message: 'Cash review recorded.' })
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (error) => setNotice({ type: 'error', message: apiErrorMessage(error, 'Could not verify the cash reconciliation.') }),
  })

  const movementMutation = useMutation({
    mutationFn: () => post(`/admin/riders/${id}/cash-fund/daily-receipt/${receipt?.reconciliation?.id}/movements`, {
      movement_type: movementType,
      amount: Number(movementAmount),
      reference: movementReference.trim(),
      reference_namespace: movementReferenceNamespace,
      evidence_details: movementEvidence.trim() || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: async () => {
      setNotice({ type: 'success', message: 'Physical cash movement recorded in the append-only ledger.' })
      setMovementAmount('')
      setMovementReference('')
      setMovementEvidence('')
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (error) => setNotice({ type: 'error', message: apiErrorMessage(error, 'Could not record the physical cash movement.') }),
  })

  const returnMutation = useMutation({
    mutationFn: () => post(`/admin/riders/${id}/cash-fund/returns`, {
      amount: Number(returnAmount),
      transaction_at: returnTransactionAt,
      reference: returnReference.trim(),
      reference_namespace: returnReferenceNamespace,
      evidence_details: returnEvidence.trim(),
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: async () => {
      setNotice({ type: 'success', message: 'Cash-fund return recorded independently of daily COD reconciliation.' })
      setReturnAmount('')
      setReturnReference('')
      setReturnEvidence('')
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (error) => setNotice({ type: 'error', message: apiErrorMessage(error, 'Could not record the cash-fund return.') }),
  })

  const closeMutation = useMutation({
    mutationFn: () => post(`/admin/riders/${id}/cash-fund/daily-receipt/${receipt?.reconciliation?.id}/close`, {
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: async () => {
      setNotice({ type: 'success', message: 'Daily cash reconciliation closed and locked.' })
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (error) => setNotice({ type: 'error', message: apiErrorMessage(error, 'Could not close the reconciliation.') }),
  })

  const record = receipt?.reconciliation
  const latestCorrection = record?.corrections?.[record.corrections.length - 1]
  const mutationsEnabled = receipt?.reconciliation_policy.mutations_enabled === true
  const correctionReviewMutation = useMutation({
    mutationFn: () => post(`/admin/riders/${id}/cash-fund/daily-receipt/${record?.id}/corrections/${latestCorrection?.id}/review`, {
      decision: 'approve',
      note: correctionNote.trim() || undefined,
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: async () => {
      setNotice({ type: 'success', message: 'Corrected balances reviewed. Explicit corrected closure is still required.' })
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (error) => setNotice({ type: 'error', message: apiErrorMessage(error, 'Could not review the corrected balances.') }),
  })
  const correctionCloseMutation = useMutation({
    mutationFn: () => post(`/admin/riders/${id}/cash-fund/daily-receipt/${record?.id}/corrections/${latestCorrection?.id}/close`, {
      idempotency_key: crypto.randomUUID(),
    }),
    onSuccess: async () => {
      setNotice({ type: 'success', message: 'Corrected financial result closed after review.' })
      await queryClient.invalidateQueries({ queryKey })
    },
    onError: (error) => setNotice({ type: 'error', message: apiErrorMessage(error, 'Could not close the corrected result.') }),
  })

  if (isLoading) return <DashboardSkeleton />

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Link to={`/admin/riders/${id}`} className="inline-flex items-center gap-2 text-sm text-[#59645D] hover:text-[#087F3F]">
        <ArrowLeft className="h-4 w-4" /> Back to rider
      </Link>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[#087F3F]">Tourism Office · cash reconciliation</p>
          <h1 className="mt-1 text-2xl font-bold text-[#17201B]">{receipt?.rider.name ?? 'Rider daily receipt'}</h1>
          <p className="mt-1 text-sm text-[#6B7280]">Review actual cash received, advance returned, rider reimbursement, and audit history.</p>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Working date (Philippine time)
          <span className="flex items-center gap-2 rounded-xl border border-[#D7E8DB] bg-white px-3 py-2">
            <CalendarDays className="h-4 w-4 text-[#087F3F]" />
            <input aria-label="Working date" type="date" max={phDate()} value={date} onChange={(event) => setDate(event.target.value)} />
          </span>
        </label>
      </header>

      {notice && <Alert type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />}
      {isError && <Alert type="error" message="Could not load this rider's daily receipt. Confirm municipality access and retry." />}
      {receipt && (
        <>
          {!mutationsEnabled && (
            <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900" role="status">
              <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
              <div><p className="font-semibold">{receipt.reconciliation_policy.status === 'legacy_policy' ? 'Legacy policy date — historical preview only' : 'Policy inactive — verification and closing disabled'}</p><p className="mt-1 text-sm">{receipt.reconciliation_policy.status === 'legacy_policy' ? 'The daily COD reconciliation policy does not apply to this historical date. No remittance amount is calculated under the future policy.' : 'This screen is a review preview only. It cannot record cash received, cash returned, reimbursement, or closure.'}</p></div>
            </div>
          )}

          <section className="rounded-2xl border border-[#E5E9E7] bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">Daily receipt totals · {receipt.working_date}</h2>
            <MoneyRow label="Eligible COD amount due" value={receipt.totals.cash_collected} />
            <MoneyRow label="Tourist cash tendered" value={receipt.totals.cash_tendered} />
            <MoneyRow label="Change given" value={receipt.totals.change_given} />
            <MoneyRow label="Expected COD remittance" value={receipt.totals.net_cod_remittance_expected} />
            <MoneyRow label="Delivery-fee earnings" value={receipt.totals.rider_delivery_fee_entitlement} />
            <MoneyRow label="Tips" value={receipt.totals.rider_tip_entitlement} />
            <MoneyRow label="Verified personal purchase contribution" value={receipt.totals.verified_personal_purchase_reimbursement} />
            <MoneyRow label="Additional payable to rider" value={receipt.totals.additional_rider_payable} />
            <MoneyRow label="Purchasing cash issued to date" value={receipt.totals.tourism_office_cash_issued_to_date} />
            <MoneyRow label="Verified office cash used" value={receipt.totals.tourism_office_cash_used_to_date} />
            <MoneyRow label="Cash physically returned through this date" value={receipt.totals.tourism_office_cash_returned_to_date} />
            <MoneyRow label="Unreturned advance carried forward" value={receipt.totals.unreturned_tourism_office_cash_balance} />
          </section>

          <section className="space-y-3 rounded-2xl border border-[#D7E8DB] bg-white p-5 shadow-sm">
            <div>
              <h2 className="text-lg font-semibold">Record a purchasing-cash return</h2>
              <p className="mt-1 text-sm text-[#59645D]">This return is a separate cash-fund movement and does not require a COD delivery or reconciliation. Available balance: {formatCurrency(receipt.totals.unreturned_tourism_office_cash_balance)}.</p>
            </div>
            {receipt.cash_movement_reference_namespaces.length === 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No cash reference namespaces are configured. Physical returns remain blocked until an authorized issuer/source and reference series are configured.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">Amount returned
                    <input aria-label="Cash-fund return amount" type="number" min="0.01" step="0.01" value={returnAmount} onChange={(event) => setReturnAmount(event.target.value)} disabled={!mutationsEnabled} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                  </label>
                  <label className="text-sm">Actual transaction time (Philippine time)
                    <input aria-label="Cash-fund return transaction time" type="datetime-local" value={returnTransactionAt} onChange={(event) => setReturnTransactionAt(event.target.value)} disabled={!mutationsEnabled} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                  </label>
                  <label className="text-sm">Reference namespace
                    <select aria-label="Cash-fund return reference namespace" value={returnReferenceNamespace} onChange={(event) => setReturnReferenceNamespace(event.target.value)} disabled={!mutationsEnabled} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100">
                      {receipt.cash_movement_reference_namespaces.map((namespace) => <option key={namespace.key} value={namespace.key}>{namespace.label}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Physical reference
                    <input aria-label="Cash-fund return reference" value={returnReference} onChange={(event) => setReturnReference(event.target.value)} disabled={!mutationsEnabled} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                  </label>
                  <label className="text-sm sm:col-span-2">Evidence details (required)
                    <input aria-label="Cash-fund return evidence" value={returnEvidence} onChange={(event) => setReturnEvidence(event.target.value)} disabled={!mutationsEnabled} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                  </label>
                </div>
                <button type="button" onClick={() => returnMutation.mutate()} disabled={!mutationsEnabled || returnMutation.isPending || !returnAmount || !returnReference.trim() || !returnEvidence.trim() || !returnReferenceNamespace} className="rounded-xl bg-[#087F3F] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {returnMutation.isPending ? 'Recording…' : 'Record cash-fund return'}
                </button>
              </>
            )}
            {receipt.financial_movements
              .filter((movement) => movement.business_date === receipt.working_date
                && (movement.affects_type ?? movement.movement_type) === 'office_cash_returned')
              .map((movement) => (
                <p key={movement.id} className="border-t border-[#E5E9E7] pt-2 text-sm text-[#59645D]">
                  {movement.movement_type === 'reversal' ? 'Audited reversal' : 'Cash returned'} · {formatCurrency(movement.amount)} · {movement.reference_type?.replaceAll('_', ' ') ?? 'unclassified reference'} · {movement.reference || 'no reference'} · {formatDateTime(movement.transaction_at)} · {movement.recorded_by?.name || 'account'}
                  {(movement.correction_cycle_ids?.length ?? 0) > 0 ? ` · correction cycles ${movement.correction_cycle_ids?.map((cycleId) => `#${cycleId}`).join(', ')}` : movement.correction_cycle_id ? ` · correction cycle #${movement.correction_cycle_id}` : ''}
                  {movement.evidence_details ? ` · ${movement.evidence_details}` : ''}
                </p>
              ))}
          </section>

          <section className="overflow-hidden rounded-2xl border border-[#E5E9E7] bg-white shadow-sm">
            <div className="border-b border-[#E5E9E7] p-5">
              <h2 className="text-lg font-semibold">Delivery and purchase details ({receipt.totals.eligible_delivery_count})</h2>
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
                      <p>Net COD collected: <strong>{formatCurrency(delivery.cash_collected)}</strong></p>
                      <p>Tourist cash tendered: <strong>{formatCurrency(delivery.cash_tendered)}</strong></p>
                      <p>Change given: <strong>{formatCurrency(delivery.change_given)}</strong></p>
                      <p>Delivery fees: <strong>{formatCurrency(delivery.rider_delivery_fee_earnings)}</strong></p>
                      <p>Tips: <strong>{formatCurrency(delivery.rider_tip_entitlement)}</strong></p>
                      <p>Verified rider contribution: <strong>{formatCurrency(delivery.verified_personal_purchase_contribution)}</strong></p>
                    </div>
                    <p className="text-xs text-[#6B7280]">
                      Existing COD allocation (separate): base {formatCurrency(delivery.cod_settlement.base)} · restaurant {formatCurrency(delivery.cod_settlement.restaurant_share)} · Tourism Office {formatCurrency(delivery.cod_settlement.tourism_office_share)}
                    </p>
                    {delivery.purchasing_cash.transactions.map((transaction) => (
                      <p key={transaction.reference_number} className="text-xs text-[#59645D]">
                        Purchasing cash · {transaction.type.replaceAll('_', ' ')} · {transaction.reference_number} · {formatCurrency(transaction.amount)}
                      </p>
                    ))}
                    {delivery.purchases.map((purchase) => (
                      <div key={purchase.purchase_id} className="rounded-lg bg-[#F8FAF9] p-3 text-sm">
                        <p className="font-medium">{purchase.business_name || `Purchase #${purchase.purchase_id}`} · planned {formatCurrency(purchase.planned_purchase_amount)}</p>
                        {purchase.expense_submissions.map((expense) => (
                          <p key={expense.revision} className="mt-1 text-xs text-[#6B7280]">
                            Revision {expense.revision}: {expense.status} · actual {formatCurrency(expense.actual_purchase_amount)} · office cash {formatCurrency(expense.tourism_office_cash_used)} · rider contribution {formatCurrency(expense.rider_personal_contribution)} · {expense.receipt_evidence_available ? 'receipt evidence available' : 'receipt evidence unavailable'}
                          </p>
                        ))}
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            )}
          </section>

          {record ? (
            <section className="space-y-4 rounded-2xl border border-[#E5E9E7] bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Reconciliation revision {record.revision}</h2>
                  <p className="mt-1 text-sm capitalize text-[#59645D]">Original status: {record.status.replaceAll('_', ' ')} · submitted {formatDateTime(record.submitted_at)}</p>
                  <p className="mt-1 text-sm font-semibold text-[#59645D]">Financial result: {(record.corrected_result_status ?? record.status).replaceAll('_', ' ')}{!record.is_finally_reconciled ? ' · review/closure required' : ''}</p>
                </div>
                {latestCorrection && (
                  <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Correction review lifecycle">
                    <h3 className="font-semibold text-amber-950">Original closure preserved · correction cycle {latestCorrection.cycle_number}: {latestCorrection.status.replaceAll('_', ' ')}</h3>
                    <p className="text-sm text-amber-900">{latestCorrection.status === 'closed' ? 'The corrected result has been reviewed and explicitly closed.' : 'The original reconciliation remains closed, but the corrected cumulative result is not finally reconciled until review and a separate closure are completed.'}</p>
                    {(latestCorrection.movement_ids?.length ?? 0) > 0 && <p className="text-sm text-amber-900">Linked ledger movements: {latestCorrection.movement_ids?.map((movementId) => `#${movementId}`).join(', ')}</p>}
                    {latestCorrection.balance_snapshot && Object.entries(latestCorrection.balance_snapshot).filter(([key]) => key !== 'calculated_at').map(([key, value]) => (
                      <p key={key} className="text-sm capitalize text-amber-950">{key.replaceAll('_', ' ')}: <strong>{formatCurrency(Number(value))}</strong></p>
                    ))}
                    {latestCorrection.review_note && <p className="text-sm text-amber-900">Review note: {latestCorrection.review_note}</p>}
                    {latestCorrection.status === 'pending_review' && (
                      <>
                        <label className="block text-sm">Correction review note
                          <textarea aria-label="Correction review note" rows={2} value={correctionNote} onChange={(event) => setCorrectionNote(event.target.value)} disabled={!mutationsEnabled} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                        </label>
                        <button type="button" onClick={() => correctionReviewMutation.mutate()} disabled={!mutationsEnabled || correctionReviewMutation.isPending} className="rounded-xl bg-[#087F3F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                          {correctionReviewMutation.isPending ? 'Reviewing…' : 'Approve corrected balances'}
                        </button>
                      </>
                    )}
                    {latestCorrection.status === 'reviewed' && (
                      <button type="button" onClick={() => correctionCloseMutation.mutate()} disabled={!mutationsEnabled || correctionCloseMutation.isPending} className="rounded-xl border border-[#087F3F] px-4 py-2 text-sm font-semibold text-[#087F3F] disabled:opacity-50">
                        {correctionCloseMutation.isPending ? 'Closing…' : 'Close corrected result'}
                      </button>
                    )}
                  </section>
                )}
                <p className="rounded-full bg-[#F0F6F2] px-3 py-1 text-sm font-medium">{record.remittance_reference}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-[#F8FAF9] p-4">
                  <h3 className="font-semibold">Rider submission</h3>
                  <MoneyRow label="COD remitted" value={record.submitted_cod_remittance} />
                  <MoneyRow label="Advance returned" value={record.submitted_office_cash_return} />
                  <p className="mt-2 text-sm text-[#59645D]">{record.rider_note || 'No rider explanation provided.'}</p>
                </div>
                <div className="rounded-xl bg-[#F8FAF9] p-4">
                  <h3 className="font-semibold">Officer verification amounts</h3>
                  <MoneyRow label="COD received" value={record.verified_cod_received ?? 0} />
                  <MoneyRow label="Advance returned" value={record.verified_office_cash_return ?? 0} />
                  <MoneyRow label="Reimbursement paid" value={record.verified_rider_reimbursement ?? 0} />
                  <MoneyRow label="Rider payable outstanding" value={record.rider_reimbursement_outstanding} />
                </div>
              </div>

              <section className="space-y-3 rounded-xl border border-[#D7E8DB] bg-[#F8FAF9] p-4">
                <div>
                  <h3 className="font-semibold">Record a physical cash movement</h3>
                  <p className="mt-1 text-sm text-[#59645D]">This append-only ledger entry is separate from rider claims and the verification decision. Use the transaction reference for each physical transfer.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">Movement type
                    <select aria-label="Movement type" value={movementType} onChange={(event) => setMovementType(event.target.value)} disabled={!mutationsEnabled || record.status !== 'submitted'} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100">
                      <option value="cod_remittance_received">COD remittance received</option>
                      <option value="office_cash_returned">Tourism Office purchasing cash returned</option>
                      <option value="rider_reimbursement_paid">Rider reimbursement paid</option>
                    </select>
                  </label>
                  <label className="text-sm">Amount physically transferred
                    <input aria-label="Movement amount" type="number" min="0.01" step="0.01" value={movementAmount} onChange={(event) => setMovementAmount(event.target.value)} disabled={!mutationsEnabled || record.status !== 'submitted'} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                  </label>
                  <label className="text-sm">Physical transaction reference
                    <input aria-label="Physical transaction reference" value={movementReference} onChange={(event) => setMovementReference(event.target.value)} disabled={!mutationsEnabled || record.status !== 'submitted'} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                  </label>
                  <label className="text-sm">Reference namespace
                    <select aria-label="Movement reference namespace" value={movementReferenceNamespace} onChange={(event) => setMovementReferenceNamespace(event.target.value)} disabled={!mutationsEnabled || record.status !== 'submitted' || receipt.cash_movement_reference_namespaces.length === 0} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100">
                      {receipt.cash_movement_reference_namespaces.map((namespace) => <option key={namespace.key} value={namespace.key}>{namespace.label}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">Evidence details (required for manual references)
                    <input aria-label="Movement evidence details" value={movementEvidence} onChange={(event) => setMovementEvidence(event.target.value)} disabled={!mutationsEnabled || record.status !== 'submitted'} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                  </label>
                </div>
                <button type="button" onClick={() => movementMutation.mutate()} disabled={!mutationsEnabled || record.status !== 'submitted' || movementMutation.isPending || !movementAmount || !movementReference.trim() || !movementReferenceNamespace || receipt.cash_movement_reference_namespaces.length === 0} className="rounded-xl border border-[#087F3F] px-4 py-2 text-sm font-semibold text-[#087F3F] disabled:cursor-not-allowed disabled:opacity-50">
                  {movementMutation.isPending ? 'Recording…' : 'Record physical movement'}
                </button>
                {receipt.financial_movements.filter((movement) => movement.reconciliation_id === record.id).length > 0 && (
                  <div className="border-t border-[#D7E8DB] pt-3">
                    <h4 className="text-sm font-semibold">Ledger movements for this revision</h4>
                    {receipt.financial_movements.filter((movement) => movement.reconciliation_id === record.id).map((movement) => (
                      <p key={movement.id} className="mt-1 text-sm text-[#59645D]">
                        {movement.movement_type.replaceAll('_', ' ')} · {formatCurrency(movement.amount)} · {movement.reference || 'no reference'} · {formatDateTime(movement.transaction_at)} · {movement.recorded_by?.name || 'account'}
                        {(movement.correction_cycle_ids?.length ?? 0) > 0 ? ` · correction cycles ${movement.correction_cycle_ids?.map((cycleId) => `#${cycleId}`).join(', ')}` : movement.correction_cycle_id ? ` · correction cycle #${movement.correction_cycle_id}` : ''}
                      </p>
                    ))}
                  </div>
                )}
              </section>

              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h3 className="flex items-center gap-2 font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" /> Expected vs reported differences</h3>
                <p className="mt-2 text-sm">COD remitted vs expected: {formatCurrency(record.discrepancies.cod_remittance_vs_expected ?? 0)}</p>
                <p className="text-sm">Advance returned vs expected: {formatCurrency(record.discrepancies.cash_return_vs_expected ?? 0)}</p>
                {record.discrepancies.office_cod_received_vs_rider_submission !== null && <p className="text-sm">Office COD count vs rider: {formatCurrency(record.discrepancies.office_cod_received_vs_rider_submission)}</p>}
                {record.discrepancies.office_cash_return_vs_rider_submission !== null && <p className="text-sm">Office return count vs rider: {formatCurrency(record.discrepancies.office_cash_return_vs_rider_submission)}</p>}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="text-sm">Cash physically received
                  <input type="number" min="0" step="0.01" value={cashReceived} onChange={(event) => setCashReceived(event.target.value)} disabled={!mutationsEnabled || record.status !== 'submitted'} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                </label>
                <label className="text-sm">Advance physically returned
                  <input type="number" min="0" step="0.01" value={cashReturned} onChange={(event) => setCashReturned(event.target.value)} disabled={!mutationsEnabled || record.status !== 'submitted'} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                </label>
                <label className="text-sm">Reimbursement actually paid
                  <input type="number" min="0" step="0.01" max={record.expected_rider_payable} value={reimbursement} onChange={(event) => setReimbursement(event.target.value)} disabled={!mutationsEnabled || record.status !== 'submitted'} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
                </label>
              </div>
              <label className="block text-sm">Verification note
                <textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} disabled={!mutationsEnabled || record.status !== 'submitted'} className="mt-1 w-full rounded-lg border p-2 disabled:bg-gray-100" />
              </label>
              <p className="text-sm text-[#59645D]">Verification compares the officer's count to the separate ledger and the server-calculated balances. It does not create physical movement records.</p>
              <div className="flex flex-wrap gap-3">
                <button type="button" onClick={() => verifyMutation.mutate()} disabled={!mutationsEnabled || record.status !== 'submitted' || verifyMutation.isPending || cashReceived === '' || cashReturned === '' || reimbursement === ''} className="rounded-xl bg-[#087F3F] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {verifyMutation.isPending ? 'Saving…' : 'Record Tourism Office verification'}
                </button>
                <button type="button" onClick={() => closeMutation.mutate()} disabled={!mutationsEnabled || record.status !== 'verified' || closeMutation.isPending} className="rounded-xl border border-[#087F3F] px-4 py-2 text-sm font-semibold text-[#087F3F] disabled:cursor-not-allowed disabled:opacity-50">
                  {closeMutation.isPending ? 'Closing…' : 'Close and lock daily receipt'}
                </button>
              </div>

              <div className="border-t border-[#E5E9E7] pt-3">
                <h3 className="font-semibold">Audit history</h3>
                {record.events.map((event, index) => (
                  <p key={`${event.action}-${index}`} className="mt-2 text-sm text-[#59645D]">
                    {event.action} by {event.actor?.name || 'account'} · {formatDateTime(event.created_at)}
                  </p>
                ))}
              </div>
              {record.closed_at && <p className="text-sm font-semibold text-[#087F3F]">Locked {formatDateTime(record.closed_at)}</p>}
            </section>
          ) : (
            <section className="rounded-2xl border border-[#E5E9E7] bg-white p-5 text-sm text-[#6B7280]">No rider submission exists for this date. This preview does not indicate that cash was received.</section>
          )}
        </>
      )}
    </main>
  )
}
