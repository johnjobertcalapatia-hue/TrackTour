import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, HandCoins } from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import type { CompensationPayout } from '@/features/compensation/types'

const card = 'rounded-2xl border border-[#E7E3D4] bg-white p-4'
const field = 'mt-1 w-full rounded-lg border border-[#D7E2DC] bg-white px-3 py-2 text-sm'

/**
 * Stage D2/D3 (2026-11-18): cancellation compensation paid on its own (the
 * rider had no online earnings to cash out). Same steps as a cashout: review,
 * approve (password), send the GCash transfer, record it with proof.
 */
export default function AdminCompensationPayout() {
  const id = Number(useParams().id)
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const { data: p, isLoading } = useQuery({ queryKey: ['admin-compensation-payout', id], queryFn: () => get<CompensationPayout>(`/admin/compensation-payouts/${id}`) })
  const done = (text: string) => {
    setNotice({ type: 'success', text })
    void queryClient.invalidateQueries({ queryKey: ['admin-compensation-payout', id] })
    void queryClient.invalidateQueries({ queryKey: ['admin-compensation-payouts'] })
  }
  const failed = (e: unknown, f: string) => setNotice({ type: 'error', text: apiErrorMessage(e, f) })

  if (isLoading || !p) return <div className={`${card} text-sm text-[#6B7280]`}>Loading…</div>
  const blocked = p.validation?.result === 'block'

  return (
    <section aria-label={`Compensation payout ${p.payout_number}`} className="space-y-4">
      <Link to="/admin/cashouts" className="inline-flex items-center gap-1 text-sm font-semibold text-[#16803C]"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Cashouts</Link>
      <header className={card}>
        <p className="text-xs font-semibold uppercase tracking-wider text-[#B8860B]">Cancellation compensation payout</p>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[#17201B]">{p.payout_number}</h1>
            <p className="text-xs text-[#6B7280]">{p.rider_name ?? `Rider #${p.rider_id}`}{p.requested_at ? ` · requested ${formatDateTime(p.requested_at)}` : ''}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-[#17201B]">{formatCurrency(p.amount)}</p>
            <p className="text-xs font-semibold text-[#4B5563]" data-testid="comp-payout-status">{p.status.replace('_', ' ')}</p>
          </div>
        </div>
      </header>

      {notice && <p role={notice.type === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${notice.type === 'error' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#F0FDF4] text-[#166534]'}`}>{notice.text}</p>}

      <div className={card}>
        <h2 className="mb-2 flex items-center gap-1 text-sm font-bold text-[#17201B]"><HandCoins className="h-4 w-4 text-[#B8860B]" aria-hidden="true" /> Compensations in this payout</h2>
        <ul className="divide-y divide-[#EEF1EF] text-sm">
          {p.items.map((i) => (
            <li key={i.compensation_id} className="flex justify-between gap-2 py-1.5">
              <span>Cancelled booking {i.order_number ?? `#${i.compensation_id}`} · {i.funding === 'advance' ? 'office advance' : 'tourist paid'}</span>
              <span className="font-semibold">{formatCurrency(i.amount)}</span>
            </li>
          ))}
        </ul>
        {p.validation && (
          <ul className="mt-3 space-y-1 text-xs" aria-label="Checks">
            {p.validation.checks.map((c) => (
              <li key={c.key} className={c.ok ? 'text-[#166534]' : 'text-[#B91C1C]'}>{c.ok ? '✓' : '✗'} {c.label}{c.ok ? '' : ` — ${c.detail ?? ''}`}</li>
            ))}
          </ul>
        )}
        {p.payment_reference && <p className="mt-2 text-xs text-[#166534]">Paid · GCash ref {p.payment_reference}{p.paid_at ? ` · ${formatDateTime(p.paid_at)}` : ''}</p>}
        {p.rejection_reason && <p className="mt-2 text-xs text-[#B91C1C]">Rejected: {p.rejection_reason}</p>}
        {p.failure_reason && <p className="mt-2 text-xs text-[#B91C1C]">Transfer failed: {p.failure_reason}</p>}
      </div>

      <div className={`${card} space-y-3`} aria-label="Decision" role="region">
        {p.status === 'pending' && <Action label="Start review" run={() => post(`/admin/compensation-payouts/${id}/start-review`)} onDone={() => done('Review started.')} onError={(e) => failed(e, 'Could not start the review.')} />}
        {(p.status === 'pending' || p.status === 'under_review') && (
          <PasswordAction label="Approve" disabled={blocked} run={(password) => post(`/admin/compensation-payouts/${id}/approve`, { password })} onDone={() => done('Approved. Send the GCash transfer, then confirm the payment.')} onError={(e) => failed(e, 'Could not approve.')} />
        )}
        {p.status === 'approved' && <PayForm payout={p} onDone={() => done('Payment confirmed.')} onError={(e) => failed(e, 'Could not confirm the payment.')} />}
        {['pending', 'under_review', 'approved'].includes(p.status) && (
          <ReasonAction label="Reject" run={(reason) => post(`/admin/compensation-payouts/${id}/reject`, { reason })} onDone={() => done('Rejected. The compensation is available again.')} onError={(e) => failed(e, 'Could not reject.')} />
        )}
        {p.status === 'approved' && (
          <ReasonAction label="Transfer failed" withPassword run={(reason, password) => post(`/admin/compensation-payouts/${id}/mark-failed`, { reason, password })} onDone={() => done('Marked failed. The compensation is available again.')} onError={(e) => failed(e, 'Could not mark it failed.')} />
        )}
      </div>
    </section>
  )
}

function Action({ label, run, onDone, onError }: { label: string; run: () => Promise<unknown>; onDone: () => void; onError: (e: unknown) => void }) {
  const m = useMutation({ mutationFn: run, onSuccess: onDone, onError })
  return <button type="button" onClick={() => m.mutate()} disabled={m.isPending} className="rounded-lg border border-[#D7E2DC] px-3 py-1.5 text-sm font-semibold">{label}</button>
}

function PasswordAction({ label, disabled, run, onDone, onError }: { label: string; disabled: boolean; run: (password: string) => Promise<unknown>; onDone: () => void; onError: (e: unknown) => void }) {
  const [password, setPassword] = useState('')
  const m = useMutation({ mutationFn: () => run(password), onSuccess: onDone, onError })
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <label className="text-xs font-medium text-[#4B5563]">Your password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Approver password" className={field} /></label>
      <button type="submit" disabled={disabled || !password || m.isPending} className="rounded-lg bg-[#16803C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{label}</button>
    </form>
  )
}

function ReasonAction({ label, withPassword = false, run, onDone, onError }: { label: string; withPassword?: boolean; run: (reason: string, password: string) => Promise<unknown>; onDone: () => void; onError: (e: unknown) => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const m = useMutation({ mutationFn: () => run(reason, password), onSuccess: onDone, onError })
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-[#FCA5A5] px-3 py-1.5 text-sm font-semibold text-[#B91C1C]">{label}…</button>
  return (
    <form className="rounded-xl border border-[#FCA5A5] p-3" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <label className="text-xs font-medium text-[#4B5563]">Reason<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} aria-label={`${label} reason`} className={field} /></label>
      {withPassword && <label className="mt-2 block text-xs font-medium text-[#4B5563]">Your password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label={`${label} password`} className={field} /></label>}
      <button type="submit" disabled={reason.trim().length < 3 || (withPassword && !password) || m.isPending} className="mt-2 rounded-lg bg-[#B91C1C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{label}</button>
    </form>
  )
}

function PayForm({ payout, onDone, onError }: { payout: CompensationPayout; onDone: () => void; onError: (e: unknown) => void }) {
  const [reference, setReference] = useState('')
  const [amount, setAmount] = useState(String(payout.amount))
  const [number, setNumber] = useState('')
  const [name, setName] = useState('')
  const [paidAt, setPaidAt] = useState(() => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16))
  const [proof, setProof] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const m = useMutation({
    mutationFn: () => {
      const body = new FormData()
      body.append('reference', reference.trim())
      body.append('amount', amount)
      body.append('recipient_number', number.trim())
      body.append('recipient_name', name.trim())
      body.append('paid_at', paidAt.replace('T', ' ') + ':00')
      if (proof) body.append('proof', proof)
      body.append('password', password)
      return post(`/admin/compensation-payouts/${payout.id}/mark-paid`, body)
    },
    onSuccess: onDone,
    onError,
  })
  const ready = reference.trim() && amount && number.trim() && name.trim() && paidAt && proof && password
  return (
    <form className="rounded-xl border-2 border-[#16803C] p-3" aria-label="Confirm GCash payment" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <p className="text-sm font-bold text-[#17201B]">Confirm GCash payment</p>
      <p className="text-[11px] text-[#6B7280]">Send {formatCurrency(payout.amount)} from the Tourism Office GCash, then record the transfer.</p>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="text-xs font-medium text-[#4B5563]">GCash reference no.<input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={64} aria-label="GCash reference number" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563]">Amount sent (₱)<input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount sent" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563]">Recipient GCash no.<input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={11} aria-label="Recipient GCash number" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563]">Recipient name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Recipient name" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563]">Date and time sent<input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} aria-label="Date sent" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563]">Proof of transfer<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setProof(e.target.files?.[0] ?? null)} aria-label="Proof of transfer" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563] sm:col-span-2">Your password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Payer password" className={field} /></label>
      </div>
      <button type="submit" disabled={!ready || m.isPending} className="mt-2 w-full rounded-lg bg-[#16803C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{m.isPending ? 'Confirming…' : 'Mark as paid'}</button>
    </form>
  )
}
