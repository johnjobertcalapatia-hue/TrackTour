import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, Users, X } from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { ReservationStatusBadge, ReservationSummary } from '@/shared/components/reservations/ReservationSummary'
import { peso, stayLabel, type Reservation } from '@/shared/components/reservations/reservation-types'
import { createCheckoutSession } from '@/shared/services/payment'
import { browser } from '@/shared/services/browser'

const CARD = 'rounded-[20px] border border-[#E5E9E7] bg-white p-5'

const NEXT_STEP: Record<string, string> = {
  pending: 'The resort will confirm your reservation. We’ll notify you.',
  confirmed: 'You’re all set. Pay at the resort when you arrive.',
  rejected: 'The resort could not accept this reservation.',
  cancelled: 'This reservation was cancelled.',
  completed: 'Thanks for staying! You can now rate your visit.',
  no_show: 'The resort marked this reservation as a no-show.',
  expired: 'This reservation was not paid in time, so it was released. You can reserve again.',
}

const minutesLeft = (iso: string | null | undefined) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000)) : 0)

/**
 * A tourist's resort reservation (Stage 7): status and next step, dates and
 * guests, what was reserved and its price, the cancellation policy, history,
 * and Cancel while it is still allowed (any time before the check-in date).
 */
export default function TouristReservationShow() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')

  const { data: r, isLoading, error } = useQuery({
    queryKey: ['tourist-reservation', id],
    queryFn: () => get<Reservation>(`/tourist/reservations/${id}`),
  })

  const pay = useMutation({
    mutationFn: () => createCheckoutSession('booking', Number(id), 'gcash'),
    onSuccess: (session) => browser.go(session.checkout_url),
  })

  const cancel = useMutation({
    mutationFn: () => post<Reservation>(`/tourist/reservations/${id}/cancel`, { reason: reason.trim() || null }),
    onSuccess: () => {
      setConfirming(false)
      queryClient.invalidateQueries({ queryKey: ['tourist-reservation', id] })
      queryClient.invalidateQueries({ queryKey: ['tourist-history'] })
    },
  })

  if (isLoading) return <DashboardSkeleton />
  if (!r) return <div className="py-20 text-center text-[#56615B]">{apiErrorMessage(error, 'Reservation not found.')}</div>

  const resortName = r.business?.business_name ?? r.business?.name ?? 'Resort'

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 pb-24 sm:px-6">
      <Link to="/tourist/activities" className="inline-flex items-center gap-2 pt-2 text-sm font-medium text-[#56615B] hover:text-[#17201B]">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> My activities
      </Link>

      <section className={CARD}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#56615B]">Reservation {r.booking_number}</p>
            <h1 className="mt-1 text-2xl font-bold text-[#17201B]">{resortName}</h1>
          </div>
          <ReservationStatusBadge status={r.status} />
        </div>
        <p className="mt-3 flex items-center gap-2 text-sm text-[#3B4540]"><CalendarDays className="h-4 w-4 text-[#087F3F]" aria-hidden="true" /> {stayLabel(r)}</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-[#3B4540]"><Users className="h-4 w-4 text-[#087F3F]" aria-hidden="true" /> {r.number_of_guests} guest{r.number_of_guests === 1 ? '' : 's'}</p>
        {r.awaiting_payment ? (
          <div className="mt-3 rounded-xl bg-[#FFF6DB] px-3 py-3 text-sm text-[#7A5A00]" data-testid="awaiting-payment">
            <p className="font-semibold">Pay {peso(r.total_amount)} with GCash within {minutesLeft(r.payment_due_at)} minute{minutesLeft(r.payment_due_at) === 1 ? '' : 's'}.</p>
            <p className="mt-0.5">Your cottages and rooms are held until then; the resort sees your reservation once it is paid.</p>
            <button type="button" onClick={() => pay.mutate()} disabled={pay.isPending} className="mt-2 rounded-xl bg-[#087F3F] px-4 py-2 text-sm font-semibold text-white hover:bg-[#066C35] disabled:opacity-60">
              {pay.isPending ? 'Opening GCash…' : 'Pay with GCash'}
            </button>
            {pay.isError && <p role="alert" className="mt-2 text-[#B91C1C]">{apiErrorMessage(pay.error, 'Could not open GCash. Please try again.')}</p>}
          </div>
        ) : (
          <p className="mt-3 rounded-xl bg-[#F6F8F4] px-3 py-2 text-sm text-[#3B4540]">{NEXT_STEP[r.status] ?? ''}</p>
        )}
        {r.cancellation_reason && ['rejected', 'cancelled'].includes(r.status) && <p className="mt-2 text-sm text-[#B91C1C]">Reason: {r.cancellation_reason}</p>}

        {r.can_cancel && (
          <button type="button" onClick={() => setConfirming(true)} className="mt-4 rounded-xl border border-[#E5E9E7] px-4 py-2.5 text-sm font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]">
            Cancel reservation
          </button>
        )}
      </section>

      <ReservationSummary reservation={r} audience="tourist" />

      <Modal show={confirming} onClose={() => setConfirming(false)} maxWidth="md">
        <form className="bg-white p-6" onSubmit={(e) => { e.preventDefault(); cancel.mutate() }}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#17201B]">Cancel this reservation?</h2>
            <button type="button" aria-label="Close" onClick={() => setConfirming(false)}><X className="h-5 w-5 text-[#56615B]" /></button>
          </div>
          <p className="text-sm text-[#3B4540]" data-testid="cancel-refund">
            {r.cancel_refund
              ? (r.cancel_refund.percent === 100
                ? `You get the full ${peso(r.cancel_refund.amount)} back to your GCash.`
                : `You get ${peso(r.cancel_refund.amount)} back (${r.cancel_refund.percent}%); the resort keeps the rest under its cancellation policy.`)
              : 'Nothing was paid online, so cancelling costs nothing.'}
          </p>
          <label htmlFor="cancel-reason" className="mb-1.5 mt-4 block text-sm font-medium text-[#3B4540]">Reason <span className="font-normal text-[#8A948E]">(optional)</span></label>
          <textarea id="cancel-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)}
            className="w-full rounded-xl border border-[#D9E2DC] px-3.5 py-2.5 text-sm focus:border-[#087F3F] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/25" />
          {cancel.isError && <p role="alert" className="mt-2 text-sm text-[#B91C1C]">{apiErrorMessage(cancel.error, 'Could not cancel the reservation.')}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="rounded-xl px-4 py-2.5 text-sm font-medium text-[#56615B] hover:bg-[#F3F8F4]">Keep it</button>
            <button type="submit" disabled={cancel.isPending} className="rounded-xl bg-[#B91C1C] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#991B1B] disabled:opacity-50">
              {cancel.isPending ? 'Cancelling…' : 'Cancel reservation'}
            </button>
          </div>
        </form>
      </Modal>
    </main>
  )
}
