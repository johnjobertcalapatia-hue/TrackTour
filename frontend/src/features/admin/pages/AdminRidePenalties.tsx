import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { cn, formatCurrency, formatDateTime } from '@/shared/utils'
import { COMPENSATION_STATUS, type Compensation } from '@/features/compensation/types'

/** Stage C2 (2026-11-18): ride cancellation penalties, for the Bansud Tourism Office. */
export interface AdminRidePenalty {
  id: number
  cancelled_order_id: number
  order_number: string | null
  tourist_name: string | null
  rider_name: string | null
  amount: number
  status: 'owed' | 'under_review' | 'disputed' | 'waived' | 'collected' | 'refunded'
  seconds_after_acceptance: number
  cancelled_at: string | null
  evidence: { fixes_since_acceptance?: number; pickup_arrival_confirmed_at?: string | null; latest_fix_distance_to_pickup_m?: number | null }
  review_reasons: string[]
  dispute_reason: string | null
  waiver_reason: string | null
  waived_at: string | null
  waived_by: string | null
  collected_at: string | null
  collection_method: 'cash' | 'online' | null
  can_waive: boolean
  // Stage D (2026-11-18): who collected cash, what the office received, refunds, the original rider's compensation.
  collected_by_name?: string | null
  received_amount?: number
  received_at?: string | null
  refunded_at?: string | null
  refund_reference?: string | null
  compensation?: Compensation | null
  can_advance?: boolean
  can_refund?: boolean
}

type Filter = 'all' | AdminRidePenalty['status']

const LABEL: Record<AdminRidePenalty['status'], string> = {
  owed: 'Owed', under_review: 'Under review', disputed: 'Disputed', waived: 'Waived', collected: 'Paid', refunded: 'Refunded',
}
const TONE: Record<AdminRidePenalty['status'], string> = {
  owed: 'bg-amber-100 text-amber-800 ring-amber-200',
  under_review: 'bg-blue-100 text-blue-800 ring-blue-200',
  disputed: 'bg-red-100 text-red-700 ring-red-200',
  waived: 'bg-[#F1EDE3] text-[#3F4B43] ring-[#E7E2D6]',
  collected: 'bg-[#E6F2EB] text-[#1E6B40] ring-[#CFE5D7]',
  refunded: 'bg-[#F1EDE3] text-[#3F4B43] ring-[#E7E2D6]',
}

export default function AdminRidePenalties() {
  const [filter, setFilter] = useState<Filter>('all')
  const { data, isLoading } = useQuery({
    queryKey: ['admin-ride-penalties', filter],
    queryFn: () => get<{ penalties: AdminRidePenalty[]; counts: Record<string, number> }>(`/admin/ride-penalties${filter === 'all' ? '' : `?status=${filter}`}`),
  })
  const counts = data?.counts ?? {}

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#66736B]">
        A tourist who cancels more than 5 minutes after the driver accepted owes ₱50 to that driver. Tourists can dispute a fee; the Tourism Office can waive one with a reason.
      </p>
      <CashToReceive />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
        {(['all', 'owed', 'disputed', 'under_review', 'waived', 'collected', 'refunded'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn('rounded-full px-3 py-1.5 text-sm font-medium', filter === f ? 'bg-[#2E8B57] text-white' : 'border border-[#E7E2D6] bg-white text-[#3F4B43] hover:bg-[#FAF7F0]')}
          >
            {f === 'all' ? 'All' : LABEL[f]}{f !== 'all' && counts[f] ? ` (${counts[f]})` : ''}
          </button>
        ))}
      </div>

      {isLoading ? <TableSkeleton rows={4} cols={4} /> : (data?.penalties ?? []).length === 0 ? (
        <p className="rounded-2xl border border-[#E7E2D6] bg-white p-10 text-center text-sm text-[#66736B]">No cancellation fees.</p>
      ) : (
        <ul className="space-y-3">
          {data!.penalties.map((p) => <li key={p.id}><PenaltyRow penalty={p} /></li>)}
        </ul>
      )}
    </div>
  )
}

function PenaltyRow({ penalty: p }: { penalty: AdminRidePenalty }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const waive = useMutation({
    mutationFn: () => post(`/admin/ride-penalties/${p.id}/waive`, { reason: reason.trim() }),
    onSuccess: () => {
      setOpen(false)
      setReason('')
      queryClient.invalidateQueries({ queryKey: ['admin-ride-penalties'] })
    },
  })
  const minutes = Math.max(1, Math.round(p.seconds_after_acceptance / 60))

  return (
    <article aria-label={`Cancellation fee ${p.order_number ?? p.id}`} className="rounded-2xl border border-[#E7E2D6] bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold ring-1', TONE[p.status])}>{LABEL[p.status]}</span>
        <span className="font-semibold text-[#1C2B22]">Ride {p.order_number ?? `#${p.cancelled_order_id}`}</span>
        <span className="ml-auto font-bold text-[#1C2B22]">{formatCurrency(p.amount)}</span>
      </div>
      <p className="mt-2 text-[#3F4B43]">
        {p.tourist_name ?? 'The tourist'} cancelled {minutes} min after {p.rider_name ?? 'the driver'} accepted
        {p.cancelled_at ? ` (${formatDateTime(p.cancelled_at)})` : ''}. Owed to {p.rider_name ?? 'that driver'}.
      </p>
      <p className="mt-1 text-xs text-[#66736B]">
        Evidence (for reference): {p.evidence.fixes_since_acceptance ?? 0} GPS fix(es) since acceptance
        {p.evidence.pickup_arrival_confirmed_at ? ', arrival at pickup confirmed' : ', no confirmed arrival'}
        {p.evidence.latest_fix_distance_to_pickup_m != null ? `, last fix ${p.evidence.latest_fix_distance_to_pickup_m} m from the pickup` : ''}.
      </p>
      {p.review_reasons.length > 0 && <p className="mt-1 text-xs text-[#66736B]">Earlier review note: {p.review_reasons.join(' ')}</p>}
      {p.dispute_reason && <p className="mt-1 text-xs text-red-700">Tourist's dispute: {p.dispute_reason}</p>}
      {p.status === 'waived' && (
        <p className="mt-1 text-xs text-[#3F4B43]">Waived by {p.waived_by ?? 'the Tourism Office'}{p.waived_at ? ` · ${formatDateTime(p.waived_at)}` : ''}: {p.waiver_reason}</p>
      )}
      {(p.status === 'collected' || p.status === 'refunded') && (
        <p className="mt-1 text-xs text-[#1E6B40]" data-testid="penalty-collection">
          {p.collection_method === 'online'
            ? 'Paid online (PayMongo-verified, received)'
            : `Collected in cash by ${p.collected_by_name ?? 'a rider'} · ${p.received_at ? 'received by the office' : `${formatCurrency(p.received_amount ?? 0)} of ${formatCurrency(p.amount)} received so far`}`}
          {p.collected_at ? ` · ${formatDateTime(p.collected_at)}` : ''}.
        </p>
      )}
      {p.status === 'refunded' && <p className="mt-1 text-xs text-[#3F4B43]">Refunded to the tourist · reference {p.refund_reference}{p.refunded_at ? ` · ${formatDateTime(p.refunded_at)}` : ''}.</p>}
      {p.compensation && (
        <p className="mt-1 text-xs text-[#3F4B43]" data-testid="penalty-compensation">
          Compensation to {p.rider_name ?? 'the original rider'}: {formatCurrency(p.compensation.amount)} ·{' '}
          <span className={cn('rounded-full px-1.5 py-0.5 font-semibold', COMPENSATION_STATUS[p.compensation.status].tone)}>{COMPENSATION_STATUS[p.compensation.status].label}</span>
          {p.compensation.funding === 'advance' ? ` · advanced (${p.compensation.advance_reference ?? ''})${p.compensation.recovered_at ? ', recovered' : ''}` : ' · from the tourist\'s payment'}
        </p>
      )}

      {!open && (p.can_waive || p.can_advance || p.can_refund || p.compensation?.status === 'pending_approval') && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          {p.compensation?.status === 'pending_approval' && <ApproveAdvance compensationId={p.compensation.id} />}
          {p.can_advance && <ReasonReferenceAction label="Advance compensation" path={`/admin/ride-penalties/${p.id}/advance`} reasonLabel="Why advance it before the tourist pays?" referenceLabel="Advance reference" note="Exceptional: the rider is credited now; it is recovered when the tourist's fee is received." />}
          {p.can_refund && <ReasonReferenceAction label="Record refund" path={`/admin/ride-penalties/${p.id}/refund`} reasonLabel="Why was it refunded?" referenceLabel="Refund reference" note="The original rider's compensation is voided, or written off if already paid." />}
          {p.can_waive && <button type="button" onClick={() => setOpen(true)} className="rounded-xl border border-[#E7E2D6] px-3 py-1.5 text-sm font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">Waive</button>}
        </div>
      )}
      {open && (
        <form className="mt-3 space-y-2 rounded-xl border border-[#E7E2D6] p-3" onSubmit={(e) => { e.preventDefault(); waive.mutate() }}>
          <label className="block text-sm font-semibold text-[#1C2B22]">
            Why is this fee waived?
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required minLength={5} maxLength={500}
              placeholder="e.g. The driver reported a breakdown; the tourist waited 20 minutes."
              className="mt-1 w-full rounded-lg border border-[#E7E2D6] px-3 py-2 text-sm font-normal outline-none focus:border-[#2E8B57]" />
          </label>
          <p className="text-xs text-[#66736B]">This is recorded permanently and the tourist is notified.</p>
          {waive.isError && <p role="alert" className="text-sm text-red-600">{apiErrorMessage(waive.error, 'Could not waive.')}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-[#E7E2D6] px-3 py-1.5 text-sm">Cancel</button>
            <button type="submit" disabled={waive.isPending || reason.trim().length < 5} className="inline-flex items-center gap-1.5 rounded-xl bg-[#2E8B57] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
              {waive.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Waive fee
            </button>
          </div>
        </form>
      )}
    </article>
  )
}

function ReasonReferenceAction({ label, path, reasonLabel, referenceLabel, note }: { label: string; path: string; reasonLabel: string; referenceLabel: string; note: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const m = useMutation({
    mutationFn: () => post(path, { reason: reason.trim(), reference: reference.trim() }),
    onSuccess: () => { setOpen(false); setReason(''); setReference(''); queryClient.invalidateQueries({ queryKey: ['admin-ride-penalties'] }) },
  })
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-xl border border-[#E7E2D6] px-3 py-1.5 text-sm font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">{label}</button>
  return (
    <form className="w-full space-y-2 rounded-xl border border-[#E7E2D6] p-3 text-left" aria-label={label} onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <label className="block text-sm font-semibold text-[#1C2B22]">{reasonLabel}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} minLength={5} maxLength={500} className="mt-1 w-full rounded-lg border border-[#E7E2D6] px-3 py-2 text-sm font-normal" />
      </label>
      <label className="block text-sm font-semibold text-[#1C2B22]">{referenceLabel}
        <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className="mt-1 w-full rounded-lg border border-[#E7E2D6] px-3 py-2 text-sm font-normal" />
      </label>
      <p className="text-xs text-[#66736B]">{note}</p>
      {m.isError && <p role="alert" className="text-sm text-red-600">{apiErrorMessage(m.error, 'Could not save.')}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-[#E7E2D6] px-3 py-1.5 text-sm">Cancel</button>
        <button type="submit" disabled={m.isPending || reason.trim().length < 5 || !reference.trim()} className="rounded-xl bg-[#2E8B57] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{label}</button>
      </div>
    </form>
  )
}

function ApproveAdvance({ compensationId }: { compensationId: number }) {
  const queryClient = useQueryClient()
  const m = useMutation({
    mutationFn: () => post(`/admin/ride-compensations/${compensationId}/approve-advance`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-ride-penalties'] }),
  })
  return (
    <span className="flex flex-col items-end">
      <button type="button" onClick={() => m.mutate()} disabled={m.isPending} className="rounded-xl bg-[#2E8B57] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Approve advance (second staff member)</button>
      {m.isError && <span role="alert" className="text-xs text-red-600">{apiErrorMessage(m.error, 'Could not approve.')}</span>}
    </span>
  )
}

interface CashRider {
  rider_id: number
  rider_name: string | null
  outstanding: number
  penalties: { id: number; order_number: string | null; amount: number; received_amount: number; remaining: number; collected_at: string | null }[]
}

/**
 * Stage D (2026-11-18): cash cancellation fees riders collected and have not
 * handed in yet. Staff record ONE numbered receipt per remittance, one line
 * per fee; a fee counts only when fully received.
 */
function CashToReceive() {
  const { data } = useQuery({ queryKey: ['admin-ride-penalties', 'cash-to-receive'], queryFn: () => get<{ riders: CashRider[] }>('/admin/ride-penalties/cash-to-receive') })
  const riders = data?.riders ?? []
  if (riders.length === 0) return null
  return (
    <section aria-label="Cash to receive" className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-bold text-[#7C4A03]">Cash cancellation fees to receive</h2>
      <p className="text-xs text-[#7C4A03]">Riders collected these from tourists. The original riders are compensated only after you record the cash as received.</p>
      <ul className="mt-2 space-y-2">{riders.map((r) => <li key={r.rider_id}><ReceiptForm rider={r} /></li>)}</ul>
    </section>
  )
}

function ReceiptForm({ rider }: { rider: CashRider }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [receipt, setReceipt] = useState('')
  const [note, setNote] = useState('')
  const [amounts, setAmounts] = useState<Record<number, string>>(() => Object.fromEntries(rider.penalties.map((p) => [p.id, String(p.remaining)])))
  const lines = rider.penalties.map((p) => ({ penalty_id: p.id, amount: Number(amounts[p.id] || 0) })).filter((l) => l.amount > 0)
  const total = Math.round(lines.reduce((sum, l) => sum + l.amount, 0) * 100) / 100
  const m = useMutation({
    mutationFn: () => post('/admin/ride-penalties/cash-receipts', { collecting_rider_id: rider.rider_id, receipt_number: receipt.trim(), received_amount: total, allocations: lines, note: note.trim() || undefined }),
    onSuccess: () => { setOpen(false); queryClient.invalidateQueries({ queryKey: ['admin-ride-penalties'] }) },
  })
  return (
    <article aria-label={`Cash from ${rider.rider_name ?? `rider #${rider.rider_id}`}`} className="rounded-xl bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-[#1C2B22]">{rider.rider_name ?? `Rider #${rider.rider_id}`} · {rider.penalties.length} {rider.penalties.length === 1 ? 'fee' : 'fees'}</span>
        <span className="font-bold text-[#7C4A03]">{formatCurrency(rider.outstanding)} to hand in</span>
      </div>
      {!open ? (
        <div className="mt-2 flex justify-end"><button type="button" onClick={() => setOpen(true)} className="rounded-xl bg-[#2E8B57] px-3 py-1.5 text-sm font-semibold text-white">Record receipt</button></div>
      ) : (
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
          <ul className="space-y-1">
            {rider.penalties.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="text-xs">Ride {p.order_number ?? `#${p.id}`} · {formatCurrency(p.remaining)} outstanding</span>
                <input type="number" min="0" max={p.remaining} step="0.01" value={amounts[p.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [p.id]: e.target.value })}
                  aria-label={`Amount received for ride ${p.order_number ?? p.id}`} className="w-24 rounded-lg border border-[#E7E2D6] px-2 py-1 text-right text-sm" />
              </li>
            ))}
          </ul>
          <label className="block text-xs font-semibold text-[#1C2B22]">Receipt number
            <input value={receipt} onChange={(e) => setReceipt(e.target.value)} maxLength={60} className="mt-1 w-full rounded-lg border border-[#E7E2D6] px-3 py-1.5 text-sm font-normal" />
          </label>
          <label className="block text-xs font-semibold text-[#1C2B22]">Note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1 w-full rounded-lg border border-[#E7E2D6] px-3 py-1.5 text-sm font-normal" />
          </label>
          <p className="text-xs font-semibold text-[#1C2B22]" data-testid="receipt-total">Total received: {formatCurrency(total)}</p>
          {m.isError && <p role="alert" className="text-sm text-red-600">{apiErrorMessage(m.error, 'Could not record the receipt.')}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-[#E7E2D6] px-3 py-1.5 text-sm">Cancel</button>
            <button type="submit" disabled={m.isPending || !receipt.trim() || total <= 0} className="rounded-xl bg-[#2E8B57] px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Record receipt</button>
          </div>
        </form>
      )}
    </article>
  )
}
