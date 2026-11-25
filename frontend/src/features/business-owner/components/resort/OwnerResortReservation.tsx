import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Check, Mail, Phone, UserRound, Users, X } from 'lucide-react'
import { apiErrorMessage, patch } from '@/shared/services/api'
import { Modal } from '@/shared/components/Modal'
import { ReservationStatusBadge, ReservationSummary } from '@/shared/components/reservations/ReservationSummary'
import { stayLabel, type Reservation } from '@/shared/components/reservations/reservation-types'

const CARD = 'rounded-[20px] border border-[#E2E8E3] bg-white p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]'

type Action = NonNullable<Reservation['actions']>[number]

const ACTION: Record<Action, { label: string; status: string; style: string; needsReason?: boolean }> = {
  confirm: { label: 'Confirm reservation', status: 'confirmed', style: 'bg-[#16803C] text-white hover:bg-[#126B32]' },
  complete: { label: 'Mark completed', status: 'completed', style: 'bg-[#16803C] text-white hover:bg-[#126B32]' },
  no_show: { label: 'Mark no-show', status: 'no_show', style: 'border border-[#E2E8E3] text-[#3F4A43] hover:bg-[#F3F8F4]' },
  reject: { label: 'Reject', status: 'rejected', style: 'border border-[#E2E8E3] text-[#B91C1C] hover:bg-[#FEF2F2]', needsReason: true },
  cancel: { label: 'Cancel reservation', status: 'cancelled', style: 'border border-[#E2E8E3] text-[#B91C1C] hover:bg-[#FEF2F2]', needsReason: true },
}

/**
 * Owner view of a resort reservation (Stage 7): who, when, what was reserved,
 * the policy and history, and only the status changes allowed now (from the
 * server). Reject and cancel need a reason, which the guest sees.
 */
export default function OwnerResortReservation({ reservation: r }: { reservation: Reservation }) {
  const queryClient = useQueryClient()
  const [asking, setAsking] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const change = useMutation({
    mutationFn: ({ action, why }: { action: Action; why?: string }) =>
      patch<Reservation>(`/business-owner/bookings/${r.id}/status`, { status: ACTION[action].status, reason: why }),
    onSuccess: (_data, { action }) => {
      setAsking(null)
      setReason('')
      setError('')
      setNotice(action === 'confirm' ? 'Reservation confirmed. The guest was told.' : 'Reservation updated. The guest was told.')
      queryClient.invalidateQueries({ queryKey: ['bo-booking', String(r.id)] })
      queryClient.invalidateQueries({ queryKey: ['bo-bookings'] })
    },
    onError: (err) => setError(apiErrorMessage(err, 'Could not update the reservation.')),
  })

  const run = (action: Action) => {
    setError('')
    if (ACTION[action].needsReason) setAsking(action)
    else change.mutate({ action })
  }
  const actions = r.actions ?? []

  return (
    <div className="space-y-5">
      <Link to="/business-owner/bookings" className="inline-flex items-center gap-2 text-sm text-[#647067] transition hover:text-[#17201A]">
        <ArrowLeft className="h-4 w-4" /> Back to Reservations
      </Link>

      <section className={CARD}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">Reservation {r.booking_number}</p>
            <h1 className="mt-1 text-2xl font-bold text-[#17201B]">{r.customer_name}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-[#3F4A43]"><CalendarDays className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> {stayLabel(r)}</p>
          </div>
          <ReservationStatusBadge status={r.status} />
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div className="flex items-center gap-2"><Users className="h-4 w-4 text-[#16803C]" aria-hidden="true" /><dt className="sr-only">Guests</dt><dd>{r.number_of_guests} guest{r.number_of_guests === 1 ? '' : 's'}</dd></div>
          {r.customer_phone && <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-[#16803C]" aria-hidden="true" /><dt className="sr-only">Phone</dt><dd><a href={`tel:${r.customer_phone}`} className="text-[#16803C] hover:underline">{r.customer_phone}</a></dd></div>}
          {r.customer_email && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-[#16803C]" aria-hidden="true" /><dt className="sr-only">Email</dt><dd className="truncate">{r.customer_email}</dd></div>}
        </dl>
        {r.special_requests && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-[#F6F8F4] px-3 py-2 text-sm text-[#3F4A43]"><UserRound className="mt-0.5 h-4 w-4 shrink-0 text-[#16803C]" aria-hidden="true" /> “{r.special_requests}”</p>
        )}
        {r.cancellation_reason && ['rejected', 'cancelled'].includes(r.status) && (
          <p className="mt-3 text-sm text-[#B91C1C]">Reason: {r.cancellation_reason}</p>
        )}

        {notice && <p role="status" className="mt-4 rounded-xl bg-[#EAF6ED] px-3 py-2 text-sm text-[#126B32]">{notice}</p>}
        {error && !asking && <p role="alert" className="mt-4 rounded-xl bg-[#FEF2F2] px-3 py-2 text-sm text-[#B91C1C]">{error}</p>}

        {actions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Reservation actions">
            {actions.map((a) => (
              <button key={a} type="button" disabled={change.isPending} onClick={() => run(a)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${ACTION[a].style}`}>
                {a === 'confirm' && <Check className="h-4 w-4" aria-hidden="true" />}
                {ACTION[a].label}
              </button>
            ))}
          </div>
        )}
      </section>

      <ReservationSummary reservation={r} audience="owner" />

      <Modal show={asking !== null} onClose={() => setAsking(null)} maxWidth="md">
        {asking && (
          <form className="bg-white p-6" onSubmit={(e) => { e.preventDefault(); change.mutate({ action: asking, why: reason }) }}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-[#17201B]">{asking === 'reject' ? 'Reject this reservation?' : 'Cancel this reservation?'}</h2>
              <button type="button" aria-label="Close" onClick={() => setAsking(null)}><X className="h-5 w-5 text-[#647067]" /></button>
            </div>
            <label htmlFor="reservation-reason" className="mb-1.5 block text-sm font-medium text-[#4B5563]">Reason (the guest sees this)</label>
            <textarea id="reservation-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Fully booked for a private event"
              className="w-full rounded-xl border border-[#E2E8E3] px-3.5 py-2.5 text-sm focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25" />
            {error && <p role="alert" className="mt-2 text-sm text-[#B91C1C]">{error}</p>}
            <p className="mt-2 text-xs text-[#5E6B63]">The reserved cottages, rooms and places become free again.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setAsking(null)} className="rounded-xl px-4 py-2.5 text-sm font-medium text-[#647067] hover:bg-[#F3F8F4]">Keep it</button>
              <button type="submit" disabled={change.isPending || reason.trim().length < 3} className="rounded-xl bg-[#B91C1C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:opacity-50">
                {change.isPending ? 'Saving…' : asking === 'reject' ? 'Reject' : 'Cancel reservation'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
