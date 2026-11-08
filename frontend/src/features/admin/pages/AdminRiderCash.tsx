import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, Banknote, CalendarDays, ChevronRight, HandCoins, Wallet } from 'lucide-react'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { formatCurrency, formatDateTime } from '@/shared/utils'

/** GET /admin/cash-advances (RiderCashFundService::advanceOverview). */
interface RiderCashRow {
  rider_id: number
  name: string
  rider_status: string | null
  advance_today: number
  advances: Array<{ id: number; reference_number: string; amount: number; occurred_at: string; note: string | null }>
  cash_with_rider: number
  returned_to_date: number
  cod_deliveries_today: number
}

interface Overview {
  date: string
  riders: RiderCashRow[]
  policy: { enabled: boolean; mutations_enabled: boolean; effective_date: string | null; status: string }
}

function phToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
}

/**
 * Tourism Office "Rider Cash" board (decision 2026-11-08). The office hands
 * each rider purchasing cash for the day and records it here ONCE (no
 * per-delivery cash issue). COD deliveries draw on that advance. At the end
 * of the day the rider remits: unused cash comes back as a cash-fund return
 * and the COD collections through the daily receipt (both on the rider's
 * daily receipt page, linked from each row).
 */
export default function AdminRiderCash() {
  const [date, setDate] = useState(phToday)
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const isToday = date === phToday()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-rider-cash', date],
    queryFn: () => get<Overview>('/admin/cash-advances', { params: { date } }),
    refetchInterval: 30000,
  })

  if (isLoading) return <DashboardSkeleton />

  const riders = data?.riders ?? []
  const totalAdvanced = riders.reduce((sum, r) => sum + r.advance_today, 0)
  const totalWithRiders = riders.reduce((sum, r) => sum + r.cash_with_rider, 0)
  const ridersWithAdvance = riders.filter((r) => r.advance_today > 0).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#17201B]">Rider Cash</h1>
          <p className="mt-1 text-sm text-[#59645D]">
            Record each rider's cash advance for the day. Riders use it to buy COD food; they remit at the end of the day.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-[#17201B]">
          <CalendarDays className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> Date
          <input
            type="date"
            value={date}
            max={phToday()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-lg border border-[#D7E8DB] px-3 py-2 text-sm"
          />
        </label>
      </div>

      {notice && <Alert type={notice.type} message={notice.message} onDismiss={() => setNotice(null)} />}

      {data && !data.policy.mutations_enabled && (
        <div role="status" className="flex gap-3 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-4 text-sm text-[#92400E]">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <p>
            <strong>Remittance recording is off.</strong> Advances can be recorded, but cash returns and COD remittances
            can only be recorded once the daily COD cash policy has an approved effective date
            {data.policy.effective_date ? ` (set: ${data.policy.effective_date}, status: ${data.policy.status})` : ''}.
          </p>
        </div>
      )}

      <dl className="grid gap-4 sm:grid-cols-3">
        <Tile icon={<HandCoins className="h-5 w-5" />} label={isToday ? 'Advanced today' : `Advanced on ${date}`} value={formatCurrency(totalAdvanced)} />
        <Tile icon={<Wallet className="h-5 w-5" />} label="Office cash still with riders" value={formatCurrency(totalWithRiders)} />
        <Tile icon={<Banknote className="h-5 w-5" />} label="Riders with an advance" value={`${ridersWithAdvance} of ${riders.length}`} />
      </dl>

      {riders.length === 0 ? (
        <p className="rounded-2xl border border-[#E5E9E7] bg-white p-8 text-center text-[#59645D]">No riders in this municipality yet.</p>
      ) : (
        <ul className="space-y-3" aria-label="Riders">
          {riders.map((rider) => (
            <RiderCashCard
              key={rider.rider_id}
              rider={rider}
              date={date}
              canRecord={isToday}
              onNotice={setNotice}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function RiderCashCard({ rider, date, canRecord, onNotice }: {
  rider: RiderCashRow
  date: string
  canRecord: boolean
  onNotice: (n: { type: 'success' | 'error'; message: string }) => void
}) {
  const queryClient = useQueryClient()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
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
      setIdempotencyKey(crypto.randomUUID())
      void queryClient.invalidateQueries({ queryKey: ['admin-rider-cash'] })
    },
    onError: (error) => onNotice({ type: 'error', message: apiErrorMessage(error, 'Could not record the advance.') }),
  })

  const valid = Number(amount) > 0

  return (
    <li className="rounded-2xl border border-[#E5E9E7] bg-white p-4" aria-label={rider.name}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[#17201B]">{rider.name}</p>
          <p className="text-xs text-[#59645D]">
            {rider.cod_deliveries_today} COD {rider.cod_deliveries_today === 1 ? 'delivery' : 'deliveries'} on {date}
            {rider.rider_status ? ` · ${rider.rider_status}` : ''}
          </p>
        </div>
        <Link
          to={`/admin/riders/${rider.rider_id}/cash-reconciliation?date=${date}`}
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#16803C] hover:underline"
        >
          Daily receipt &amp; remittance <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
        <Figure label="Advanced" value={rider.advance_today} />
        <Figure label="Cash with rider" value={rider.cash_with_rider} strong />
        <Figure label="Returned to date" value={rider.returned_to_date} />
      </dl>

      {rider.advances.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-[#EDF0EE] pt-3 text-xs text-[#59645D]" aria-label={`Advances for ${rider.name}`}>
          {rider.advances.map((a) => (
            <li key={a.id} className="flex justify-between gap-3">
              <span>{formatDateTime(a.occurred_at)} · {a.reference_number}{a.note ? ` · ${a.note}` : ''}</span>
              <span className="font-semibold text-[#17201B]">{formatCurrency(a.amount)}</span>
            </li>
          ))}
        </ul>
      )}

      {canRecord && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-[#EDF0EE] pt-3"
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
              className="mt-1 block w-32 rounded-lg border border-[#D7E8DB] px-3 py-2 text-sm text-[#17201B]"
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
              className="mt-1 block w-full rounded-lg border border-[#D7E8DB] px-3 py-2 text-sm text-[#17201B]"
            />
          </label>
          <button
            type="submit"
            disabled={!valid || record.isPending}
            className="rounded-lg bg-[#16803C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {record.isPending ? 'Recording…' : 'Record advance'}
          </button>
        </form>
      )}
    </li>
  )
}

function Figure({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-[#59645D]">{label}</dt>
      <dd className={strong ? 'font-bold text-[#16803C]' : 'font-semibold text-[#17201B]'}>{formatCurrency(value)}</dd>
    </div>
  )
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-[#E5E9E7] bg-white p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EAF6ED] text-[#16803C]" aria-hidden="true">{icon}</span>
      <div>
        <dt className="text-xs text-[#59645D]">{label}</dt>
        <dd className="text-lg font-bold text-[#17201B]">{value}</dd>
      </div>
    </div>
  )
}
