import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import axios from 'axios'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, Lock, Minus, Plus, ShieldCheck, Users, X } from 'lucide-react'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { createCheckoutSession } from '@/shared/services/payment'
import { browser } from '@/shared/services/browser'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { peso } from '@/shared/components/reservations/reservation-types'
import { PRICING_BASIS_LABEL, type ResortOfferingItem } from './ResortDetail'
import {
  addDays, availableFor, defaultChoice, manilaDate, maxQuantity, toLines, usesPeople,
  type AvailabilityCalendar, type Choices,
} from './reserve-helpers'

interface Quote {
  check_in: string
  check_out: string | null
  nights: number
  guests: number
  lines: { offering_id: number; name: string; amount: number; quantity: number; people: number; nights: number; slot: string | null }[]
  total: number
  policy: { summary: string }
}

interface Created { id: number; booking_number: string; payment_option?: string }

const input = 'w-full rounded-xl border border-[#D9E2DC] bg-white px-3.5 py-2.5 text-sm text-[#17201B] focus:border-[#087F3F] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/25'

function errorsOf(err: unknown): { message: string; fields: Record<string, string> } {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string; errors?: Record<string, string[]>; problems?: { message: string }[] } | undefined
    const fields = Object.fromEntries(Object.entries(data?.errors ?? {}).map(([k, v]) => [k, v[0] ?? '']))
    const message = data?.problems?.[0]?.message ?? Object.values(fields)[0] ?? data?.message ?? 'Something went wrong.'
    return { message, fields }
  }
  return { message: apiErrorMessage(err, 'Something went wrong.'), fields: {} }
}

/**
 * The resort reservation builder (Stage 7): dates and guests, the offerings
 * with what is still free on those dates (required ones included, add-ons only
 * with their partner), the server's price breakdown and the cancellation
 * policy, contact details and pay at the resort. The server checks everything
 * again when the reservation is sent.
 */
export default function ReserveBuilder({ businessId, businessName, offerings, policySummary, onClose }: {
  businessId: number
  businessName: string
  offerings: ResortOfferingItem[]
  policySummary?: string | null
  onClose: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const location = useLocation()
  const [checkIn, setCheckIn] = useState(manilaDate(1))
  const [checkOut, setCheckOut] = useState(manilaDate(2))
  const [guests, setGuests] = useState(2)
  const [choices, setChoices] = useState<Choices>({})
  const [name, setName] = useState(user?.name ?? '')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [reference] = useState(() => `rsv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`)
  const [created, setCreated] = useState<Created | null>(null)
  const [payWith, setPayWith] = useState<'pay_at_resort' | 'gcash'>('pay_at_resort')
  const [checkoutFailed, setCheckoutFailed] = useState(false)
  const [submitError, setSubmitError] = useState<{ message: string; fields: Record<string, string> } | null>(null)

  // Required offerings are always in the reservation.
  useEffect(() => {
    setChoices((cur) => {
      const next = { ...cur }
      for (const o of offerings) {
        if (o.is_required && !next[o.id]) next[o.id] = defaultChoice(o, guests)
        // Per-person required items (entrance) follow the party size.
        if (o.is_required && usesPeople(o)) next[o.id] = { ...next[o.id]!, quantity: guests }
      }
      return next
    })
  }, [offerings, guests])

  const chosen = offerings.filter((o) => (choices[o.id]?.quantity ?? 0) > 0)
  const overnight = chosen.some((o) => o.booking_mode === 'overnight')
  const lastDay = overnight && checkOut > checkIn ? addDays(checkOut, -1) : checkIn

  const calendar = useQuery({
    queryKey: ['resort-availability', businessId, checkIn, lastDay],
    queryFn: () => get<AvailabilityCalendar>(`/tourist/resorts/${businessId}/availability?from=${checkIn}&to=${lastDay}`),
    enabled: user?.role === 'tourist' && checkIn >= manilaDate(0),
  })

  const lines = useMemo(() => toLines(choices, offerings), [choices, offerings])
  const stay = { check_in: checkIn, ...(overnight ? { check_out: checkOut } : {}), guests, lines }
  const quote = useQuery({
    queryKey: ['resort-quote', businessId, JSON.stringify(stay)],
    queryFn: () => post<Quote>(`/tourist/resorts/${businessId}/quote`, stay),
    enabled: user?.role === 'tourist' && lines.length > 0 && checkIn >= manilaDate(0) && (!overnight || checkOut > checkIn),
    retry: false,
  })

  const reserve = useMutation({
    mutationFn: () => post<Created>(`/tourist/resorts/${businessId}/reservations`, {
      ...stay, customer_name: name.trim(), customer_phone: phone.trim(), notes: notes.trim() || null,
      payment_option: payWith, client_reference: reference,
    }),
    onSuccess: async (r) => {
      setCreated(r)
      if (payWith !== 'gcash') return
      // GCash: straight to PayMongo; the units are held for 30 minutes meanwhile.
      try {
        const session = await createCheckoutSession('booking', r.id, 'gcash')
        browser.go(session.checkout_url)
      } catch {
        setCheckoutFailed(true)
      }
    },
    onError: (err) => setSubmitError(errorsOf(err)),
  })

  const setQty = (o: ResortOfferingItem, quantity: number) => {
    setChoices((cur) => {
      const next = { ...cur }
      if (quantity <= 0) {
        delete next[o.id]
        // Add-ons go with their partner.
        for (const dep of offerings) if (dep.requires_offering_id === o.id) delete next[dep.id]
      } else {
        next[o.id] = { ...(next[o.id] ?? defaultChoice(o, guests)), quantity }
      }
      return next
    })
  }

  if (!user || user.role !== 'tourist') {
    return (
      <Shell onClose={onClose} title={`Reserve at ${businessName}`}>
        <div className="p-6 text-center">
          <Lock className="mx-auto mb-3 h-10 w-10 text-[#087F3F]" aria-hidden="true" />
          <p className="font-semibold text-[#17201B]">Log in to reserve</p>
          <p className="mt-1 text-sm text-[#56615B]">Reservations are made from a tourist account so the resort can confirm them.</p>
          <Link to={`/login?redirect=${encodeURIComponent(location.pathname)}`} className="mt-4 inline-flex rounded-xl bg-[#087F3F] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#066C35]">Log in</Link>
        </div>
      </Shell>
    )
  }

  if (created && payWith === 'gcash') {
    return (
      <Shell onClose={onClose} title="Pay with GCash">
        <div className="p-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-[#087F3F]" aria-hidden="true" />
          <p className="text-lg font-bold text-[#17201B]">Reservation {created.booking_number} is held for 30 minutes</p>
          <p className="mt-1 text-sm text-[#56615B]">{checkoutFailed ? 'We could not open GCash. Pay from your reservation page within 30 minutes, or the cottages and rooms are released.' : 'Opening GCash…'}</p>
          <Link to={`/tourist/reservations/${created.id}`} className="mt-5 inline-flex rounded-xl bg-[#087F3F] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#066C35]">{checkoutFailed ? 'Pay now' : 'View my reservation'}</Link>
        </div>
      </Shell>
    )
  }

  if (created) {
    return (
      <Shell onClose={onClose} title="Reservation sent">
        <div className="p-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-[#087F3F]" aria-hidden="true" />
          <p className="text-lg font-bold text-[#17201B]">Reservation {created.booking_number} sent</p>
          <p className="mt-1 text-sm text-[#56615B]">{businessName} will confirm it soon. We'll notify you. Pay when you arrive.</p>
          <Link to={`/tourist/reservations/${created.id}`} className="mt-5 inline-flex rounded-xl bg-[#087F3F] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#066C35]">View my reservation</Link>
        </div>
      </Shell>
    )
  }

  const quoteError = quote.isError ? errorsOf(quote.error).message : null
  const canSubmit = Boolean(quote.data) && name.trim().length >= 2 && phone.trim().length >= 7 && !reserve.isPending

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    if (canSubmit) reserve.mutate()
  }

  return (
    <Shell onClose={onClose} title={`Reserve at ${businessName}`}>
      <form onSubmit={submit} noValidate className="space-y-5 p-5 sm:p-6">
        {/* Dates & guests */}
        <fieldset className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <legend className="sr-only">Dates and guests</legend>
          <div>
            <label htmlFor="rsv-check-in" className="mb-1 flex items-center gap-1 text-xs font-semibold text-[#3B4540]"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> {overnight ? 'Check-in' : 'Date'}</label>
            <input id="rsv-check-in" type="date" className={input} min={manilaDate(0)} value={checkIn}
              onChange={(e) => { setCheckIn(e.target.value); if (checkOut <= e.target.value) setCheckOut(addDays(e.target.value, 1)) }} />
          </div>
          {overnight && (
            <div>
              <label htmlFor="rsv-check-out" className="mb-1 flex items-center gap-1 text-xs font-semibold text-[#3B4540]"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Check-out</label>
              <input id="rsv-check-out" type="date" className={input} min={addDays(checkIn, 1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          )}
          <div>
            <label htmlFor="rsv-guests" className="mb-1 flex items-center gap-1 text-xs font-semibold text-[#3B4540]"><Users className="h-3.5 w-3.5" aria-hidden="true" /> Guests</label>
            <input id="rsv-guests" type="number" min={1} max={200} className={input} value={guests} onChange={(e) => setGuests(Math.max(1, Number(e.target.value) || 1))} />
          </div>
        </fieldset>

        {/* Offerings */}
        <section aria-labelledby="rsv-offerings-heading">
          <h3 id="rsv-offerings-heading" className="mb-2 text-sm font-bold text-[#17201B]">What would you like?</h3>
          <ul className="divide-y divide-[#EEF2EF] rounded-2xl border border-[#E5E9E7]" aria-label="Offerings to reserve">
            {offerings.map((o) => {
              const c = choices[o.id]
              const qty = c?.quantity ?? 0
              const partner = o.requires_offering_id ? offerings.find((x) => x.id === o.requires_offering_id) : undefined
              const locked = Boolean(partner && !(choices[partner.id]?.quantity))
              const available = availableFor(calendar.data, o.id, c?.slot)
              const max = maxQuantity(o, available)
              const soldOut = available === 0 && qty === 0
              const day = calendar.data?.offerings.find((x) => x.id === o.id)?.dates[0]
              return (
                <li key={o.id} className="p-3.5" data-testid={`rsv-offering-${o.id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#17201B]">{o.name}{o.is_required && <span className="ml-1.5 rounded-full bg-[#F3F8F4] px-1.5 py-0.5 text-[10px] font-semibold text-[#087F3F]">Required</span>}</p>
                      <p className="text-xs text-[#56615B]">
                        {peso(o.price)} {PRICING_BASIS_LABEL[o.pricing_basis]}
                        {available != null && (soldOut ? ' · Fully booked' : ` · ${available} left`)}
                        {locked && partner && ` · Only with ${partner.name}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2" role="group" aria-label={`${o.name} ${usesPeople(o) ? 'people' : 'quantity'}`}>
                      <button type="button" aria-label={`Fewer ${o.name}`} disabled={qty === 0 || (o.is_required && qty <= 1) || locked}
                        onClick={() => setQty(o, qty - 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-[#D9E2DC] text-[#3B4540] disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                      <span className="w-6 text-center text-sm font-semibold tabular-nums" data-testid={`rsv-qty-${o.id}`}>{qty}</span>
                      <button type="button" aria-label={`More ${o.name}`} disabled={locked || soldOut || qty >= max || (o.is_required && usesPeople(o))}
                        onClick={() => setQty(o, qty + 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-[#087F3F] text-[#087F3F] disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                    </div>
                  </div>
                  {qty > 0 && !usesPeople(o) && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-[#3B4540]">
                      Guests staying
                      <input type="number" min={1} max={(o.max_guests ?? 50) * qty} value={c?.guests ?? 1} aria-label={`Guests in ${o.name}`}
                        onChange={(e) => setChoices((cur) => ({ ...cur, [o.id]: { ...cur[o.id]!, guests: Math.max(1, Number(e.target.value) || 1) } }))}
                        className="w-20 rounded-lg border border-[#D9E2DC] px-2 py-1 text-sm" />
                      {o.max_guests && <span className="text-[#8A948E]">up to {o.max_guests * qty}</span>}
                    </label>
                  )}
                  {qty > 0 && o.booking_mode === 'time_slot' && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-[#3B4540]">
                      Time
                      <select value={c?.slot ?? ''} aria-label={`Time for ${o.name}`} onChange={(e) => setChoices((cur) => ({ ...cur, [o.id]: { ...cur[o.id]!, slot: e.target.value } }))}
                        className="rounded-lg border border-[#D9E2DC] px-2 py-1 text-sm">
                        <option value="">Choose a time</option>
                        {(day?.slots ?? []).map((s) => <option key={s.slot} value={s.slot} disabled={s.available === 0}>{s.slot}{s.available === 0 ? ' (full)' : ` (${s.available} left)`}</option>)}
                      </select>
                    </label>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        {/* Price */}
        <section aria-labelledby="rsv-summary-heading" className="rounded-2xl bg-[#F6F8F4] p-4">
          <h3 id="rsv-summary-heading" className="mb-2 text-sm font-bold text-[#17201B]">Summary</h3>
          {lines.length === 0 ? <p className="text-sm text-[#56615B]">Choose what you'd like to reserve.</p>
            : quote.isFetching && !quote.data ? <p className="text-sm text-[#56615B]">Checking availability and price…</p>
              : quoteError ? <p role="alert" className="text-sm text-[#B91C1C]">{quoteError}</p>
                : quote.data && (
                  <>
                    <ul className="space-y-1 text-sm" aria-label="Price breakdown">
                      {quote.data.lines.map((l) => (
                        <li key={l.offering_id} className="flex justify-between gap-3"><span className="text-[#3B4540]">{l.name}{l.nights > 1 ? ` · ${l.nights} nights` : ''}</span><span className="tabular-nums">{peso(l.amount)}</span></li>
                      ))}
                    </ul>
                    <p className="mt-2 flex justify-between border-t border-[#E2E8E3] pt-2 text-base font-bold text-[#17201B]"><span>Total</span><span className="tabular-nums" data-testid="rsv-total">{peso(quote.data.total)}</span></p>
                  </>
                )}
        </section>

        {/* Contact & payment */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="rsv-name" className="mb-1 block text-xs font-semibold text-[#3B4540]">Name</label>
            <input id="rsv-name" className={input} value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
            {submitError?.fields.customer_name && <p className="mt-1 text-xs text-[#B91C1C]">{submitError.fields.customer_name}</p>}
          </div>
          <div>
            <label htmlFor="rsv-phone" className="mb-1 block text-xs font-semibold text-[#3B4540]">Mobile number</label>
            <input id="rsv-phone" className={input} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} placeholder="09XXXXXXXXX" />
            {submitError?.fields.customer_phone && <p className="mt-1 text-xs text-[#B91C1C]">{submitError.fields.customer_phone}</p>}
          </div>
        </div>
        <div>
          <label htmlFor="rsv-notes" className="mb-1 block text-xs font-semibold text-[#3B4540]">Notes for the resort <span className="font-normal text-[#8A948E]">(optional)</span></label>
          <textarea id="rsv-notes" rows={2} className={input} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} placeholder="e.g. Arriving around 9 AM" />
        </div>

        <fieldset>
          <legend className="mb-1.5 text-xs font-semibold text-[#3B4540]">Payment</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {([['pay_at_resort', 'Pay at the resort', 'Pay when you arrive'], ['gcash', 'GCash online', 'Pay now; held 30 minutes while you pay']] as const).map(([value, label, hint]) => (
              <label key={value} className={`flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${payWith === value ? 'border-[#087F3F] bg-[#F3FAF5]' : 'border-[#E5E9E7]'}`}>
                <input type="radio" name="rsv-payment" value={value} checked={payWith === value} onChange={() => setPayWith(value)} className="mt-0.5 accent-[#087F3F]" />
                <span><span className="block font-medium text-[#17201B]">{label}</span><span className="block text-xs text-[#56615B]">{hint}</span></span>
              </label>
            ))}
          </div>
        </fieldset>

        {(quote.data?.policy.summary ?? policySummary) && (
          <p className="flex items-start gap-2 text-xs text-[#3B4540]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#087F3F]" aria-hidden="true" /> {quote.data?.policy.summary ?? policySummary}</p>
        )}
        {submitError && !Object.keys(submitError.fields).some((k) => k.startsWith('customer')) && <p role="alert" className="text-sm text-[#B91C1C]">{submitError.message}</p>}

        <button type="submit" disabled={!canSubmit} className="w-full rounded-xl bg-[#087F3F] py-3 text-sm font-bold text-white hover:bg-[#066C35] disabled:opacity-50">
          {reserve.isPending ? 'Sending…' : quote.data ? `${payWith === 'gcash' ? 'Reserve & pay' : 'Reserve'} · ${peso(quote.data.total)}` : 'Reserve'}
        </button>
        <p className="text-center text-xs text-[#8A948E]">The resort confirms your reservation. You can cancel any time before check-in{payWith === 'gcash' ? '; refunds follow the cancellation policy' : ''}.</p>
      </form>
    </Shell>
  )
}

/**
 * The pop-up, attached to <body> and layered above the tourist header, sidebar
 * and bottom bar (z 2000–2001), so nothing on the page can cover it.
 */
function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    document.body.classList.add('overflow-hidden')
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => { document.body.classList.remove('overflow-hidden'); document.removeEventListener('keydown', esc) }
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[2100] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white sm:rounded-3xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#EEF2EF] bg-white px-5 py-4">
          <h2 className="text-lg font-bold text-[#17201B]">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 text-[#56615B] hover:bg-[#F3F8F4]"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
