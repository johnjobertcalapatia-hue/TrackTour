import { useState, type FormEvent } from 'react'
import axios from 'axios'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarOff, Plus, Trash2 } from 'lucide-react'
import { apiErrorMessage, del, get, post } from '@/shared/services/api'

/** GET/POST /business-owner/businesses/{id}/resort-blocked-dates (resort reservations Stage 6). */
export interface BlockedDate {
  id: number
  resort_offering_id: number | null
  offering_name: string | null
  start_date: string
  end_date: string
  reason: string | null
}

const input = 'w-full rounded-xl border border-[#E2E8E3] bg-white px-3 py-2 text-sm text-[#17201B] focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25'

/** Today in the Philippines, YYYY-MM-DD (the server checks dates in Manila time). */
export function manilaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

const fmt = (d: string) => new Date(`${d}T12:00:00+08:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })

/**
 * Closed & blocked dates: the owner closes the whole resort or one offering
 * for a date range (maintenance, private events). Tourists cannot reserve
 * those dates; reservations already made stay booked (the reply says how many).
 */
export default function BlockedDatesPanel({ businessId, offerings }: { businessId: number; offerings: { id: number; name: string }[] }) {
  const queryClient = useQueryClient()
  const key = ['bo-resort-blocked-dates', businessId]
  const today = manilaToday()
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [offeringId, setOfferingId] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => get<BlockedDate[]>(`/business-owner/businesses/${businessId}/resort-blocked-dates`),
  })
  const blocks = Array.isArray(data) ? data : []

  const add = useMutation({
    mutationFn: () => post<BlockedDate & { already_reserved: number }>(`/business-owner/businesses/${businessId}/resort-blocked-dates`, {
      start_date: start, end_date: end, resort_offering_id: offeringId ? Number(offeringId) : null, reason: reason.trim() || null,
    }),
    onSuccess: (block) => {
      setErrors({})
      setReason('')
      setNotice({
        type: 'success',
        text: block.already_reserved > 0
          ? `Dates blocked. ${block.already_reserved} already reserved on those dates stay booked; contact those guests if needed.`
          : 'Dates blocked.',
      })
      queryClient.invalidateQueries({ queryKey: key })
    },
    onError: (err) => {
      const fieldErrors = axios.isAxiosError(err) ? (err.response?.data as { errors?: Record<string, string[]> })?.errors : undefined
      if (fieldErrors) setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v[0] ?? ''])))
      else setNotice({ type: 'error', text: apiErrorMessage(err, 'Could not block those dates.') })
    },
  })

  const reopen = useMutation({
    mutationFn: (id: number) => del(`/business-owner/businesses/${businessId}/resort-blocked-dates/${id}`),
    onSuccess: () => { setNotice({ type: 'success', text: 'Dates reopened.' }); queryClient.invalidateQueries({ queryKey: key }) },
    onError: (err) => setNotice({ type: 'error', text: apiErrorMessage(err, 'Could not reopen those dates.') }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setNotice(null)
    if (end < start) { setErrors({ end_date: 'The last day cannot be before the first day.' }); return }
    add.mutate()
  }

  return (
    <section className="bg-white rounded-2xl border border-[#E2E8E3] p-5" aria-labelledby="blocked-dates-heading">
      <h2 id="blocked-dates-heading" className="flex items-center gap-2 text-lg font-semibold text-[#17201A]">
        <CalendarOff className="h-5 w-5 text-[#16803C]" aria-hidden="true" /> Closed &amp; blocked dates
      </h2>
      <p className="mt-1 text-sm text-[#647067]">Close the resort or one offering for repairs, private events or holidays. Tourists can't reserve those dates.</p>

      {notice && <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-sm ${notice.type === 'success' ? 'bg-[#EAF6ED] text-[#126B32]' : 'bg-[#FEF2F2] text-[#B91C1C]'}`}>{notice.text}</p>}

      <form onSubmit={submit} noValidate className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div>
          <label htmlFor="block-start" className="mb-1 block text-xs font-semibold text-[#4B5563]">First day</label>
          <input id="block-start" type="date" className={input} min={today} value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value) }} />
          {errors.start_date && <p className="mt-1 text-xs text-[#B91C1C]">{errors.start_date}</p>}
        </div>
        <div>
          <label htmlFor="block-end" className="mb-1 block text-xs font-semibold text-[#4B5563]">Last day</label>
          <input id="block-end" type="date" className={input} min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
          {errors.end_date && <p className="mt-1 text-xs text-[#B91C1C]">{errors.end_date}</p>}
        </div>
        <div>
          <label htmlFor="block-offering" className="mb-1 block text-xs font-semibold text-[#4B5563]">Applies to</label>
          <select id="block-offering" className={input} value={offeringId} onChange={(e) => setOfferingId(e.target.value)}>
            <option value="">Whole resort</option>
            {offerings.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          {errors.resort_offering_id && <p className="mt-1 text-xs text-[#B91C1C]">{errors.resort_offering_id}</p>}
        </div>
        <div>
          <label htmlFor="block-reason" className="mb-1 block text-xs font-semibold text-[#4B5563]">Reason <span className="font-normal text-[#9CA3AF]">(optional)</span></label>
          <input id="block-reason" className={input} maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Private event" />
        </div>
        <button type="submit" disabled={add.isPending} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#16803C] px-4 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-60">
          <Plus className="h-4 w-4" aria-hidden="true" /> {add.isPending ? 'Blocking…' : 'Block dates'}
        </button>
      </form>

      <div className="mt-5">
        {isLoading ? <p className="text-sm text-[#647067]">Loading…</p> : blocks.length === 0 ? (
          <p className="text-sm text-[#647067]">No closed or blocked dates coming up.</p>
        ) : (
          <ul className="divide-y divide-[#EEF2EF]" aria-label="Blocked dates">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#17201A]">
                    {b.start_date === b.end_date ? fmt(b.start_date) : `${fmt(b.start_date)} – ${fmt(b.end_date)}`}
                  </p>
                  <p className="text-xs text-[#647067]">{b.offering_name ?? 'Whole resort'}{b.reason ? ` · ${b.reason}` : ''}</p>
                </div>
                <button type="button" onClick={() => reopen.mutate(b.id)} disabled={reopen.isPending} aria-label={`Reopen ${b.start_date}`}
                  className="inline-flex shrink-0 items-center gap-1 h-8 px-3 rounded-lg border border-[#E2E8E3] text-xs font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Reopen
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
