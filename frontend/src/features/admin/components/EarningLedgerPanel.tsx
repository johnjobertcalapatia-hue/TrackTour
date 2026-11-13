import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { formatCurrency, formatDateTime } from '@/shared/utils'

/** GET /admin/rider-earnings/{id}/ledger (AdminRiderEarningController). */
export interface EarningLedger {
  earning_id: number
  recorded_total: number
  earned: number
  in_cashout: number
  paid_out: number
  available: number
  two_person_threshold: number
  entries: {
    id: number
    type: string
    bucket: string
    amount: number
    channel: string | null
    reason: string | null
    by: string
    approved_by: string | null
    payout_id: number | null
    at: string
  }[]
}

const TYPE_LABEL: Record<string, string> = {
  earning_posted: 'Commission posted',
  tip_posted: 'Tip posted',
  adjustment: 'Adjustment',
  cashout_reserved: 'Reserved for cashout',
  reservation_released: 'Reservation released',
  payout_completed: 'Paid out',
}

const field = 'mt-1 w-full rounded-lg border border-[#D7E2DC] bg-[#F6F8F4] px-3 py-2 text-sm text-[#17201B]'

/**
 * Stage 5: one earning's permanent ledger (entries are never edited) and the
 * only way to correct it — a compensating adjustment with a reason and the
 * staff password; a second staff member confirms at or above the threshold.
 */
export function EarningLedgerPanel({ earningId }: { earningId: number }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-earning-ledger', earningId],
    queryFn: () => get<EarningLedger>(`/admin/rider-earnings/${earningId}/ledger`),
  })
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [secondEmail, setSecondEmail] = useState('')
  const [secondPassword, setSecondPassword] = useState('')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const value = Number(amount)
  const needsSecond = data ? Math.abs(value) >= data.two_person_threshold : false
  const adjust = useMutation({
    mutationFn: () =>
      post(`/admin/rider-earnings/${earningId}/adjust`, {
        amount: value,
        reason: reason.trim(),
        password,
        ...(needsSecond ? { second_staff_email: secondEmail.trim(), second_staff_password: secondPassword } : {}),
      }),
    onSuccess: () => {
      setNotice({ ok: true, text: 'Adjustment recorded.' })
      setAmount('')
      setReason('')
      setPassword('')
      setSecondPassword('')
      void queryClient.invalidateQueries({ queryKey: ['admin-earning-ledger', earningId] })
      void queryClient.invalidateQueries({ queryKey: ['admin-rider-records'] })
    },
    onError: (e) => setNotice({ ok: false, text: apiErrorMessage(e, 'Could not record the adjustment.') }),
  })

  if (isLoading || !data) return <p className="text-xs text-[#6B7280]">Loading ledger…</p>

  const ready = Number.isFinite(value) && value !== 0 && reason.trim().length >= 5 && password !== '' && (!needsSecond || (secondEmail.trim() !== '' && secondPassword !== ''))

  return (
    <div className="space-y-3 text-xs" role="region" aria-label={`Earning ${earningId} ledger`}>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          ['Earned', data.earned],
          ['In a cashout', data.in_cashout],
          ['Paid out', data.paid_out],
          ['Available', data.available],
        ] as const).map(([name, v]) => (
          <div key={name} className="rounded-lg bg-[#F6F8F4] px-2 py-1.5">
            <dt className="text-[#6B7280]">{name}</dt>
            <dd className="font-semibold text-[#17201A]">{formatCurrency(v)}</dd>
          </div>
        ))}
      </dl>

      <ol className="space-y-1" aria-label="Ledger entries">
        {data.entries.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-2 border-b border-[#EDF0EE] pb-1">
            <span>
              <span className="font-medium text-[#17201A]">{TYPE_LABEL[e.type] ?? e.type}</span>
              {e.reason ? <span className="text-[#6B7280]"> — {e.reason}</span> : null}
              <span className="block text-[11px] text-[#9CA3AF]">
                {formatDateTime(e.at)} · {e.by}{e.approved_by ? `, confirmed by ${e.approved_by}` : ''}{e.channel === 'cod' ? ' · COD' : ''}
              </span>
            </span>
            <span className={`shrink-0 font-semibold ${e.amount < 0 ? 'text-[#B91C1C]' : 'text-[#17201A]'}`}>
              {e.amount < 0 ? '−' : '+'}{formatCurrency(Math.abs(e.amount))}
            </span>
          </li>
        ))}
      </ol>

      <form
        aria-label="Adjust earning"
        className="rounded-xl border border-[#E2E8E3] p-3"
        onSubmit={(ev) => { ev.preventDefault(); setNotice(null); adjust.mutate() }}
      >
        <p className="font-semibold text-[#17201A]">Record an adjustment</p>
        <p className="text-[11px] text-[#6B7280]">
          Entries are permanent. A correction is a new entry: positive adds, negative deducts.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="font-medium text-[#4B5563]">Amount (₱)<input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Adjustment amount" className={field} /></label>
          <label className="font-medium text-[#4B5563]">Your password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Staff password" className={field} /></label>
          <label className="font-medium text-[#4B5563] sm:col-span-2">Reason<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="Adjustment reason" className={field} /></label>
          {needsSecond && (
            <>
              <p className="text-[11px] font-medium text-[#B45309] sm:col-span-2">
                {formatCurrency(data.two_person_threshold)} or more: a second Tourism Office staff member confirms with their own password.
              </p>
              <label className="font-medium text-[#4B5563]">Second staff email<input type="email" value={secondEmail} onChange={(e) => setSecondEmail(e.target.value)} aria-label="Second staff email" className={field} /></label>
              <label className="font-medium text-[#4B5563]">Second staff password<input type="password" value={secondPassword} onChange={(e) => setSecondPassword(e.target.value)} aria-label="Second staff password" className={field} /></label>
            </>
          )}
        </div>
        <button type="submit" disabled={!ready || adjust.isPending} className="mt-2 rounded-lg bg-[#16803C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {adjust.isPending ? 'Recording…' : 'Record adjustment'}
        </button>
        {notice && <p role={notice.ok ? 'status' : 'alert'} className={`mt-2 ${notice.ok ? 'text-[#166534]' : 'text-[#B91C1C]'}`}>{notice.text}</p>}
      </form>
    </div>
  )
}
