import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, Banknote, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Clock, HandCoins, Info, Lock,
  ReceiptText, Users, Wallet, XCircle,
} from 'lucide-react'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { cn, formatCurrency, formatDateTime } from '@/shared/utils'

/** Read-only day figures from the rider's daily receipt (RiderCashFundService::daySummary). */
interface DaySummary {
  available: boolean
  error?: string
  cod_deliveries?: number
  cod_purchases?: number
  office_cash_used_for_purchases?: number
  cod_collections?: number
  unused_cash_returned?: number
  cod_remitted?: number
  cod_remittance_expected?: number | null
  cod_remittance_outstanding?: number | null
  outstanding_office_cash?: number
  reconciliation_status?: string
  remittance_submitted?: boolean
  has_discrepancy?: boolean
  needs_reconciliation?: boolean
}

/** GET /admin/cash-advances (RiderCashFundService::advanceOverview). */
interface RiderCashRow {
  rider_id: number
  name: string
  rider_status: string | null
  advance_today: number
  topups_today?: number
  issued_today?: number
  advances: Array<{ id: number; reference_number: string; amount: number; occurred_at: string; note: string | null }>
  cash_with_rider: number
  returned_to_date: number
  cod_deliveries_today: number
  day?: DaySummary
}

interface Overview {
  date: string
  riders: RiderCashRow[]
  policy: { enabled: boolean; mutations_enabled: boolean; effective_date: string | null; status: string }
}

type Notice = { type: 'success' | 'error'; message: string }

function phToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}
const shiftDay = (d: string, delta: number) => {
  const t = new Date(`${d}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + delta)
  return t.toISOString().slice(0, 10)
}
const longDate = (d: string) => new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${d}T00:00:00Z`))

const STATUS: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  verified: { label: 'Reconciled', tone: 'bg-[#E6F2EB] text-[#1E6B40]', icon: CheckCircle2 },
  closed: { label: 'Closed', tone: 'bg-[#E6F2EB] text-[#1E6B40]', icon: CheckCircle2 },
  submitted: { label: 'Submitted — verify', tone: 'bg-[#FFF6CC] text-[#5C4A00]', icon: Clock },
  disputed: { label: 'Disputed', tone: 'bg-red-50 text-red-700', icon: XCircle },
  calculated_preview: { label: 'Not yet submitted', tone: 'bg-[#F1EDE3] text-[#5B5446]', icon: Clock },
  legacy_policy_preview: { label: 'Legacy policy', tone: 'bg-[#F1EDE3] text-[#5B5446]', icon: Info },
}

/**
 * Rider Cash — the Tourism Office's daily cash accountability module.
 *
 * Every purpose is its own record (never netted together): office cash
 * issued (advances and top-ups), verified COD purchases, COD collected from
 * customers, unused cash returned, COD remitted, and what is outstanding.
 * Day figures come from each rider's daily receipt. Pick any date to review
 * history. Issuing cash is recorded once per intended advance (idempotency
 * key); returns and remittances are recorded on the daily receipt and follow
 * the daily COD cash policy.
 */
export default function AdminRiderCash() {
  const [date, setDate] = useState(phToday)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [showLegend, setShowLegend] = useState(false)
  const today = phToday()
  const isToday = date === today

  const { data, isLoading } = useQuery({
    queryKey: ['admin-rider-cash', date],
    queryFn: () => get<Overview>('/admin/cash-advances', { params: { date } }),
    refetchInterval: isToday ? 30000 : false,
  })

  if (isLoading) return <DashboardSkeleton />

  const riders = data?.riders ?? []
  const issued = (r: RiderCashRow) => r.issued_today ?? r.advance_today
  const outstanding = (r: RiderCashRow) => r.day?.available ? r.day.outstanding_office_cash ?? r.cash_with_rider : r.cash_with_rider
  const totalIssued = riders.reduce((sum, r) => sum + issued(r), 0)
  const totalOutstanding = riders.reduce((sum, r) => sum + outstanding(r), 0)
  const activeAdvances = riders.filter((r) => outstanding(r) > 0).length
  const pendingReconciliation = riders.filter((r) => r.day?.needs_reconciliation).length
  const ridersWithAdvance = riders.filter((r) => r.advance_today > 0).length
  const policy = data?.policy

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#17201B]">Rider Cash</h1>
          <p className="mt-1 text-sm text-[#59645D]">Daily cash advances and reconciliation: what the office issued, what riders spent and collected, and what is still outstanding.</p>
        </div>
        <div className="flex items-center gap-2" aria-label="Date">
          <button type="button" onClick={() => setDate((d) => shiftDay(d, -1))} aria-label="Previous day" className="rounded-lg border border-[#D7E8DB] bg-white p-2 hover:bg-[#F6F8F4]"><ChevronLeft className="h-4 w-4" /></button>
          <label className="flex items-center gap-2 rounded-lg border border-[#D7E8DB] bg-white px-3 py-1.5 text-sm font-medium text-[#17201B]">
            <CalendarDays className="h-4 w-4 text-[#16803C]" aria-hidden="true" />
            <span className="sr-only">Date</span>
            <input type="date" aria-label="Date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="outline-none" />
          </label>
          <button type="button" disabled={isToday} onClick={() => setDate((d) => shiftDay(d, 1))} aria-label="Next day" className="rounded-lg border border-[#D7E8DB] bg-white p-2 hover:bg-[#F6F8F4] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          {!isToday && <button type="button" onClick={() => setDate(today)} className="rounded-lg border border-[#D7E8DB] bg-white px-3 py-2 text-sm font-medium hover:bg-[#F6F8F4]">Today</button>}
        </div>
      </header>

      {!isToday && (
        <p className="rounded-xl bg-[#F6F8F4] px-4 py-2 text-sm text-[#59645D]" role="status">
          Viewing the record for <strong className="text-[#17201B]">{longDate(date)}</strong>. Cash can be issued only for today.
        </p>
      )}

      {notice && <Alert type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />}

      {policy && <PolicyPanel policy={policy} date={date} />}

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Daily overview">
        <Tile icon={<HandCoins className="h-5 w-5" />} label={isToday ? 'Advanced today' : `Advanced on ${date}`} value={formatCurrency(totalIssued)} hint="Advances and top-ups issued" />
        <Tile icon={<Wallet className="h-5 w-5" />} label="Outstanding cash" value={formatCurrency(totalOutstanding)} hint="Office cash still with riders" emphasis />
        <Tile icon={<Users className="h-5 w-5" />} label="Active advances" value={`${activeAdvances} ${activeAdvances === 1 ? 'rider' : 'riders'}`} hint={`${ridersWithAdvance} of ${riders.length} advanced on this date`} />
        <Tile icon={<ClipboardList className="h-5 w-5" />} label="Pending reconciliation" value={`${pendingReconciliation} ${pendingReconciliation === 1 ? 'rider' : 'riders'}`} hint="Cash or COD not yet reconciled" warn={pendingReconciliation > 0} />
      </dl>

      <section className="rounded-2xl border border-[#E5E9E7] bg-white" aria-label="Rider Cash Records">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EDF0EE] px-4 py-3">
          <h2 className="font-semibold text-[#17201B]">Rider Cash Records</h2>
          <button type="button" onClick={() => setShowLegend((v) => !v)} aria-expanded={showLegend} className="inline-flex items-center gap-1 text-sm font-medium text-[#16803C] hover:underline">
            <Info className="h-4 w-4" /> What these figures mean <ChevronDown className={cn('h-4 w-4 transition', showLegend && 'rotate-180')} />
          </button>
        </div>
        {showLegend && <Legend />}
        {riders.length === 0 ? (
          <p className="p-8 text-center text-[#59645D]">No riders in this municipality yet.</p>
        ) : (
          <ul className="divide-y divide-[#EDF0EE]" aria-label="Riders">
            {riders.map((rider) => (
              <RiderCashRecord key={rider.rider_id} rider={rider} date={date} canRecord={isToday} onNotice={setNotice} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Exactly what is available and what is not, and why. */
function PolicyPanel({ policy, date }: { policy: Overview['policy']; date: string }) {
  if (policy.mutations_enabled) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-2xl border border-[#CFE5D7] bg-[#F3FAF6] p-4 text-sm text-[#1E6B40]">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p>Daily COD cash policy is active{policy.effective_date ? ` (since ${policy.effective_date})` : ''}: cash returns and COD remittances can be recorded on each rider's daily receipt.</p>
      </div>
    )
  }
  const reason = policy.status === 'legacy_policy'
    ? `${date} is before the policy's effective date (${policy.effective_date}), so the legacy cash policy applies to this day.`
    : policy.status === 'invalid_effective_date'
      ? 'The configured effective date is not valid. Ask the system administrator to correct it.'
      : 'The daily COD cash policy does not have an approved effective date yet.'
  return (
    <div role="status" className="rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-sm text-[#92400E]">
      <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" /> Remittance recording is off</p>
      <p className="mt-1">{reason}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ul className="space-y-1" aria-label="Available now">
          <li className="text-xs font-semibold uppercase tracking-wider text-[#1E6B40]">Available now</li>
          {['Issue cash advances and top-ups', 'View daily receipts and COD collections', 'Verify riders’ COD purchase expenses'].map((t) => (
            <li key={t} className="flex items-center gap-1.5 text-[#1E6B40]"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t}</li>
          ))}
        </ul>
        <ul className="space-y-1" aria-label="Not available yet">
          <li className="text-xs font-semibold uppercase tracking-wider">Not available yet</li>
          {['Record unused cash returned', 'Record COD remittances', 'Verify and close daily reconciliations'].map((t) => (
            <li key={t} className="flex items-center gap-1.5"><Lock className="h-4 w-4" aria-hidden="true" />{t}</li>
          ))}
        </ul>
      </div>
      {policy.effective_date && policy.status !== 'legacy_policy' && <p className="mt-2 text-xs">Configured effective date: {policy.effective_date} · status: {policy.status}</p>}
    </div>
  )
}

function RiderCashRecord({ rider, date, canRecord, onNotice }: {
  rider: RiderCashRow
  date: string
  canRecord: boolean
  onNotice: (n: Notice) => void
}) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [open, setOpen] = useState(false)
  // One key per intended advance: a double tap or retry records it once.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const record = useMutation({
    mutationFn: () => post(`/admin/riders/${rider.rider_id}/cash-fund/advances`, {
      amount: Number(amount),
      note: note.trim() || null,
      idempotency_key: idempotencyKey,
    }),
    onSuccess: () => {
      onNotice({ type: 'success', message: `Recorded a ${formatCurrency(Number(amount))} advance for ${rider.name}.` })
      setAmount('')
      setNote('')
      setOpen(false)
      setIdempotencyKey(crypto.randomUUID())
      void queryClient.invalidateQueries({ queryKey: ['admin-rider-cash'] })
    },
    onError: (error) => onNotice({ type: 'error', message: apiErrorMessage(error, 'Could not record the advance.') }),
  })

  const valid = Number(amount) > 0
  const day = rider.day
  const status = day?.available ? (day.has_discrepancy ? { label: 'Discrepancy', tone: 'bg-red-50 text-red-700', icon: AlertTriangle } : STATUS[day.reconciliation_status ?? ''] ?? STATUS.calculated_preview!) : null
  const outstanding = day?.available ? day.outstanding_office_cash ?? rider.cash_with_rider : rider.cash_with_rider

  const figures: { label: string; value: number | null; strong?: boolean; sub?: string }[] = [
    { label: 'Cash issued', value: rider.issued_today ?? rider.advance_today, sub: rider.topups_today ? `incl. ${formatCurrency(rider.topups_today)} top-up` : undefined },
    { label: 'COD purchases', value: day?.available ? day.cod_purchases ?? 0 : null, sub: 'verified' },
    { label: 'COD collected', value: day?.available ? day.cod_collections ?? 0 : null, sub: day?.cod_deliveries ? `${day.cod_deliveries} COD ${day.cod_deliveries === 1 ? 'delivery' : 'deliveries'}` : undefined },
    { label: 'Unused cash returned', value: day?.available ? day.unused_cash_returned ?? 0 : null },
    { label: 'COD remitted', value: day?.available ? day.cod_remitted ?? 0 : null, sub: day?.cod_remittance_outstanding ? `${formatCurrency(day.cod_remittance_outstanding)} still due` : undefined },
    { label: 'Outstanding cash', value: outstanding, strong: true, sub: 'office cash with rider' },
  ]

  return (
    <li className="px-4 py-4" aria-label={rider.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#17201B]">{rider.name}</p>
          <p className="text-xs text-[#59645D]">
            {rider.cod_deliveries_today} COD {rider.cod_deliveries_today === 1 ? 'delivery' : 'deliveries'} on {date}
            {rider.rider_status ? ` · ${rider.rider_status}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status && (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold', status.tone)}>
              <status.icon className="h-3.5 w-3.5" aria-hidden="true" /> {status.label}
            </span>
          )}
          {canRecord && (
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1 rounded-lg bg-[#16803C] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#126B32]">
              <Banknote className="h-4 w-4" aria-hidden="true" /> Issue cash
            </button>
          )}
          <Link
            to={`/admin/riders/${rider.rider_id}/cash-reconciliation?date=${date}`}
            className="inline-flex items-center gap-1 rounded-lg border border-[#D7E8DB] px-3 py-1.5 text-sm font-semibold text-[#16803C] hover:bg-[#F6F8F4]"
          >
            <ReceiptText className="h-4 w-4" aria-hidden="true" /> Daily receipt &amp; remittance
          </Link>
        </div>
      </div>

      {day && !day.available ? (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">The daily receipt could not be calculated: {day.error}</p>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-[#EDF0EE] bg-[#EDF0EE] sm:grid-cols-3 lg:grid-cols-6">
          {figures.map((f) => (
            <div key={f.label} className="bg-white px-3 py-2">
              <dt className="text-xs text-[#59645D]">{f.label}</dt>
              <dd className={f.strong ? 'font-bold text-[#16803C]' : 'font-semibold text-[#17201B]'}>{f.value === null ? '—' : formatCurrency(f.value)}</dd>
              {f.sub && <dd className="text-[11px] text-[#7A867F]">{f.sub}</dd>}
            </div>
          ))}
        </dl>
      )}

      {rider.advances.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-[#59645D]" aria-label={`Advances for ${rider.name}`}>
          {rider.advances.map((a) => (
            <li key={a.id} className="flex justify-between gap-3">
              <span>{formatDateTime(a.occurred_at)} · {a.reference_number}{a.note ? ` · ${a.note}` : ''}</span>
              <span className="font-semibold text-[#17201B]">{formatCurrency(a.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {canRecord && open && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-[#F6F8F4] p-3"
          onSubmit={(e) => { e.preventDefault(); if (valid) record.mutate() }}
        >
          <label className="text-xs font-medium text-[#59645D]">
            Cash advance (₱)
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={`Cash advance for ${rider.name}`}
              className="mt-1 block w-32 rounded-lg border border-[#D7E8DB] bg-white px-3 py-2 text-sm text-[#17201B]"
            />
          </label>
          <label className="min-w-[10rem] flex-1 text-xs font-medium text-[#59645D]">
            Note (optional)
            <input
              type="text"
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              aria-label={`Note for ${rider.name}`}
              placeholder="e.g. Morning float or afternoon top-up"
              className="mt-1 block w-full rounded-lg border border-[#D7E8DB] bg-white px-3 py-2 text-sm text-[#17201B]"
            />
          </label>
          <button type="submit" disabled={!valid || record.isPending} className="rounded-lg bg-[#16803C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {record.isPending ? 'Recording…' : 'Record advance'}
          </button>
        </form>
      )}
    </li>
  )
}

/** The separate financial records — never netted against each other. */
function Legend() {
  const rows = [
    ['Cash issued', 'Money the office gave the rider (advance and top-ups).'],
    ['COD purchases', 'Money the rider spent buying restaurant orders (verified receipts).'],
    ['COD collected', 'Money collected from customers on delivery.'],
    ['Unused cash returned', 'Remaining office cash the rider returned.'],
    ['COD remitted', 'Customer collections the rider handed to the office.'],
    ['Outstanding cash', 'Office cash still with the rider, awaiting return or reconciliation.'],
  ]
  return (
    <dl className="grid gap-2 border-b border-[#EDF0EE] bg-[#FAFBF9] px-4 py-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {rows.map(([term, meaning]) => (
        <div key={term}>
          <dt className="font-semibold text-[#17201B]">{term}</dt>
          <dd className="text-[#59645D]">{meaning}</dd>
        </div>
      ))}
      <p className="text-xs text-[#7A867F] sm:col-span-2 lg:col-span-3">Each is its own record: COD purchases are never subtracted from customer collections here. Daily operations — returns, remittances and purchase verification — are recorded on each rider's daily receipt.</p>
    </dl>
  )
}

function Tile({ icon, label, value, hint, emphasis = false, warn = false }: { icon: React.ReactNode; label: string; value: string; hint?: string; emphasis?: boolean; warn?: boolean }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border bg-white p-4', emphasis ? 'border-[#B7D9C3]' : warn ? 'border-[#F5D78A]' : 'border-[#E5E9E7]')}>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', warn ? 'bg-[#FFF6CC] text-[#8A6A00]' : 'bg-[#EAF6ED] text-[#16803C]')} aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-[#59645D]">{label}</dt>
        <dd className="text-lg font-bold text-[#17201B]">{value}</dd>
        {hint && <dd className="truncate text-[11px] text-[#7A867F]">{hint}</dd>}
      </div>
    </div>
  )
}
