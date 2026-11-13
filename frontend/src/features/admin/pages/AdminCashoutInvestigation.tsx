import { useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Bike,
  CheckCircle2,
  CircleX,
  FileImage,
  HandCoins,
  History,
  Search,
  ShieldAlert,
  ShieldCheck,
  Store,
  User,
  Wallet,
  XCircle,
} from 'lucide-react'
import { apiErrorMessage, get, openAuthenticatedDocument, post } from '@/shared/services/api'
import { formatCurrency, formatDateTime } from '@/shared/utils'

export type CashoutStatus = 'pending' | 'under_review' | 'approved' | 'paid' | 'rejected' | 'failed' | 'cancelled'

interface Check {
  key: string
  label: string
  ok: boolean
  detail?: string | null
}

interface Item {
  earning_id: number
  type: 'food' | 'ride'
  reference: string | null
  customer_name: string | null
  restaurant: string | null
  payment_method: string | null
  payment_reference: string | null
  payment_provider: string | null
  paid_at: string | null
  completed_at: string | null
  amount: number
  customer_paid?: number | null
  gateway_amount?: number | null
  checks: Check[]
  verified: boolean | null
}

interface Staff {
  id: number
  name: string
}

/** GET /admin/payouts/{id} (AdminPayoutController::detail). */
export interface CashoutDetail {
  id: number
  payout_number: string
  status: CashoutStatus
  amount: number
  requested_at: string
  rider: {
    id: number
    name: string | null
    email: string | null
    phone: string | null
    account_status: string | null
    municipality: string | null
    member_since?: string | null
    email_verified?: boolean
  }
  destination: { gcash_number: string | null; account_name: string | null }
  gcash_history?: { gcash_number: string; account_name: string | null; requests: number; paid: number; first_used_at: string; last_used_at: string }[]
  new_destination?: boolean
  financial?: {
    customer_paid: number
    gateway_confirmed: number
    earnings_in_request: number
    paid_out_before: number
    other_open_requests: number
    lifetime_online_earnings: number
    remaining_unpaid: number
    checks: Check[]
  }
  items: Item[]
  items_total: number
  all_verified: boolean | null
  two_person_threshold: number
  two_person_required: boolean
  review: { started_by: Staff | null; started_at: string | null; approved_by: Staff | null; approved_at: string | null; note: string | null; rejection_reason: string | null }
  payment: { paid_by: Staff | null; paid_at: string | null; reference: string; amount: number; recipient_number: string; recipient_name: string; has_proof: boolean } | null
  failure: { failed_by: Staff | null; failed_at: string | null; reason: string } | null
  history: { action: string; description: string; by: string | null; at: string }[]
  /** Stage 6: latest validation against the earnings ledger (stored, append-only). */
  validation?: {
    result: 'pass' | 'flag' | 'block'
    context: string
    checks: { key: string; label: string; ok: boolean; severity: 'flag' | 'block'; detail: string | null }[]
    decision_note: string | null
    checked_by: string | null
    at: string
  } | null
  decision_note_min?: number
}

/** GET /admin/payouts/{id}/earnings/{earning} (AdminPayoutController::investigate). */
export interface OriginalRecords {
  type: 'food' | 'ride'
  verification: Check[]
  tourist: { name: string | null; email: string | null; phone: string | null; account_id: number | null; account_status: string | null; email_verified: boolean; member_since: string | null }
  order: {
    id: number
    number: string
    status: string
    placed_at: string | null
    payment_method: string | null
    payment_status: string | null
    subtotal: number
    delivery_fee: number
    system_fee: number
    tip: number
    total: number
    delivery_address: string | null
  }
  restaurants: { id: number; name: string; status: string | null; address: string | null }[]
  items: { name: string; quantity: number; cancelled_quantity: number; unit_price: number; subtotal: number; status: string | null; business_id: number | null }[]
  ride: { vehicle_type: string | null; passenger_count: number | null; fare: number; distance_km: number | null; duration_minutes: number | null; pickup_address: string | null; dropoff_address: string | null } | null
  payments: { number: string; method: string | null; provider: string | null; provider_reference: string | null; status: string; amount: number; paid_at: string | null; refunded_at: string | null }[]
  assignment: {
    delivery_id: number
    rider: { id: number; name: string } | null
    status: string | null
    assigned_at: string | null
    dispatch: { rider: string; is_this_rider: boolean; attempt: number | null; response: string | null; offered_at: string | null; responded_at: string | null }[]
  } | null
  pickups: { restaurant: string | null; arrived_at: string | null; confirmed_at: string | null; status: string | null }[]
  completion: {
    picked_up_at: string | null
    arrived_destination_at: string | null
    delivered_at: string | null
    confirmed_at: string | null
    confirmed_by: string | null
    proof_photo: boolean
    proof_distance_m: number | null
    cash_settled_at: string | null
  } | null
  earning: { id: number; status: string; earned_at: string | null; delivery_fee_charged: number; rider_commission: number; tip: number; total: number; formula: string; matches_formula: boolean }
}

export const CASHOUT_STATUS: Record<CashoutStatus, { label: string; tone: string }> = {
  pending: { label: 'Pending', tone: 'bg-[#FFF4D6] text-[#8A5A00]' },
  under_review: { label: 'Under review', tone: 'bg-[#E0E7FF] text-[#3730A3]' },
  approved: { label: 'Approved · send GCash', tone: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  paid: { label: 'Paid', tone: 'bg-[#DCFCE7] text-[#166534]' },
  rejected: { label: 'Rejected', tone: 'bg-[#FEE2E2] text-[#B91C1C]' },
  failed: { label: 'Payout failed', tone: 'bg-[#FEE2E2] text-[#B91C1C]' },
  cancelled: { label: 'Cancelled by rider', tone: 'bg-[#F3F4F6] text-[#4B5563]' },
}

// Heritage Banana Gold accents, Verdant Leaf for verified, red for suspicious.
const GOLD = 'text-[#A8780A]'
const field = 'mt-1 w-full rounded-lg border border-[#D7E2DC] bg-[#F6F8F4] px-3 py-2 text-sm text-[#17201B]'
const card = 'rounded-2xl border border-[#E7E3D4] bg-white p-4'
const dt = 'text-[#6B7280]'
const money = (n: number | null | undefined) => (n === null || n === undefined ? '—' : formatCurrency(n))
const when = (s: string | null | undefined) => (s ? formatDateTime(s) : '—')

export function CashoutStatusChip({ status }: { status: CashoutStatus }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${CASHOUT_STATUS[status].tone}`}>{CASHOUT_STATUS[status].label}</span>
}

function SectionTitle({ letter, title, icon, aside }: { letter: string; title: string; icon: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-bold text-[#17201B]">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-[#FFF4D6] text-[11px] font-bold text-[#8A5A00]" aria-hidden="true">{letter}</span>
        <span className={GOLD} aria-hidden="true">{icon}</span>
        {title}
      </h2>
      {aside}
    </div>
  )
}

function Tick({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-start gap-1.5 ${ok ? 'text-[#166534]' : 'text-[#B91C1C]'}`}>
      {ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span>
        <span className="sr-only">{ok ? 'Passed: ' : 'Failed: '}</span>
        {children}
      </span>
    </li>
  )
}

/** Route /admin/cashouts/:id. */
export default function AdminCashoutInvestigation() {
  const { id } = useParams<{ id: string }>()
  return (
    <div className="space-y-4">
      <Link to="/admin/cashouts" className="inline-flex items-center gap-1 text-sm font-semibold text-[#16803C] hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> All cashout requests
      </Link>
      {id ? <CashoutInvestigation id={Number(id)} /> : null}
    </div>
  )
}

/**
 * Tourism Office cashout investigation (decision 2026-11-11). The screen that
 * protects the Tourism Office's money: who is asking (A), what the request is
 * made of (B), the original order / ride records behind each earning (C), the
 * money cross-checks (D), and the decision — approval and payout kept apart (E).
 */
export function CashoutInvestigation({ id }: { id: number }) {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [selected, setSelected] = useState<number | null>(null)

  const { data: d, isLoading, isError } = useQuery({
    queryKey: ['admin-cashout', id],
    queryFn: () => get<CashoutDetail>(`/admin/payouts/${id}`),
  })

  const done = (text: string) => {
    setNotice({ type: 'success', text })
    void queryClient.invalidateQueries({ queryKey: ['admin-cashout', id] })
    void queryClient.invalidateQueries({ queryKey: ['admin-cashouts'] })
    void queryClient.invalidateQueries({ queryKey: ['admin-cashouts-summary'] })
  }
  const failed = (e: unknown, fallback: string) => setNotice({ type: 'error', text: apiErrorMessage(e, fallback) })

  if (isError) return <div className={`${card} text-sm text-[#B91C1C]`}>This cashout request could not be loaded.</div>
  if (isLoading || !d) return <div className={`${card} text-sm text-[#6B7280]`}>Loading request…</div>

  const reviewable = d.status === 'pending' || d.status === 'under_review'
  const nameMismatch = !!d.destination.account_name && !!d.rider.name && d.destination.account_name.trim().toLowerCase() !== d.rider.name.trim().toLowerCase()
  const financialFailures = d.financial?.checks.filter((c) => !c.ok) ?? []
  const flags = [
    d.all_verified === false && { danger: true, text: 'One or more earnings failed verification.' },
    financialFailures.length > 0 && { danger: true, text: `${financialFailures.length} financial ${financialFailures.length === 1 ? 'check fails' : 'checks fail'}.` },
    d.new_destination && { danger: false, text: 'No earlier cashout was paid to this GCash number.' },
    nameMismatch && { danger: false, text: "The GCash account name differs from the rider's name." },
  ].filter(Boolean) as { danger: boolean; text: string }[]
  const current = selected ?? d.items[0]?.earning_id ?? null

  return (
    <section aria-label={`Cashout ${d.payout_number}`} className="space-y-4">
      <header className="overflow-hidden rounded-2xl border border-[#E7E3D4] bg-white">
        <div className="h-1.5 bg-gradient-to-r from-[#E9B949] via-[#F3D27A] to-[#16803C]" aria-hidden="true" />
        <div className="flex flex-wrap items-start justify-between gap-4 p-4">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-wider ${GOLD}`}>Cashout investigation</p>
            <h1 className="text-xl font-bold text-[#17201B] lg:text-2xl">{d.payout_number}</h1>
            <p className="text-xs text-[#6B7280]">
              {d.rider.name ?? `Rider #${d.rider.id}`} · requested {when(d.requested_at)} · {d.items.length} {d.items.length === 1 ? 'earning' : 'earnings'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-[#17201B]">{formatCurrency(d.amount)}</p>
            <CashoutStatusChip status={d.status} />
          </div>
        </div>
        <div className="border-t border-[#F1EEE3] px-4 py-2" data-testid="risk-summary">
          {flags.length === 0 ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-[#166534]"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> No warning signs found. Still open the original records before approving.</p>
          ) : (
            <ul className="flex flex-wrap gap-2" aria-label="Warning signs">
              {flags.map((f) => (
                <li key={f.text} className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${f.danger ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#FFF4D6] text-[#8A5A00]'}`}>
                  {f.danger ? <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
                  {f.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      {notice && (
        <p role={notice.type === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${notice.type === 'error' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#F0FDF4] text-[#166534]'}`}>
          {notice.text}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          <Breakdown detail={d} current={current} onSelect={setSelected} />
          {current !== null && <OriginalRecordsPanel payoutId={d.id} earningId={current} reference={d.items.find((i) => i.earning_id === current)?.reference ?? null} />}
          {d.financial && <FinancialVerification detail={d} />}
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
          <RiderIdentity detail={d} nameMismatch={nameMismatch} />

          <div className={card} role="region" aria-label="Decision">
            <SectionTitle letter="E" title="Approval and payout" icon={<HandCoins className="h-4 w-4" />} />
            <ol className="mb-3 grid grid-cols-3 gap-1 text-center text-[11px] font-semibold" aria-label="Steps">
              <Step label="Review" done={['under_review', 'approved', 'paid'].includes(d.status)} active={d.status === 'pending'} />
              <Step label="Approve" done={d.status === 'approved' || d.status === 'paid'} active={d.status === 'under_review'} />
              <Step label="Pay in GCash" done={d.status === 'paid'} active={d.status === 'approved'} />
            </ol>
            <div className="space-y-3">
              {d.status === 'pending' && (
                <ActionButton
                  label="Start review"
                  hint="Holds the request while you investigate (the rider can no longer cancel)."
                  onRun={() => post(`/admin/payouts/${d.id}/start-review`)}
                  onDone={() => done('Review started.')}
                  onError={(e) => failed(e, 'Could not start the review.')}
                />
              )}
              <LedgerValidation detail={d} onDone={done} onError={failed} />
              {reviewable && (
                <ApproveForm
                  id={d.id}
                  disabled={d.all_verified === false || d.validation?.result === 'block'}
                  flagged={d.validation?.result === 'flag'}
                  noteMin={d.decision_note_min ?? 10}
                  onDone={done}
                  onError={failed}
                />
              )}
              {d.status === 'approved' && <PaymentForm detail={d} onDone={done} onError={failed} />}
              <Outcome detail={d} onError={failed} />
              {(reviewable || d.status === 'approved') && (
                <div className="flex flex-wrap gap-2">
                  <ReasonForm id={d.id} kind="reject" onDone={done} onError={failed} />
                  {d.status === 'approved' && <ReasonForm id={d.id} kind="fail" onDone={done} onError={failed} />}
                </div>
              )}
            </div>
          </div>

          {d.history.length > 0 && (
            <div className={card}>
              <h2 className="mb-2 flex items-center gap-1 text-sm font-bold text-[#17201B]"><History className={`h-4 w-4 ${GOLD}`} aria-hidden="true" /> Audit trail</h2>
              <ol className="space-y-1.5 border-l-2 border-[#F3D27A] pl-3 text-xs text-[#374151]" aria-label="Audit trail">
                {d.history.map((h, i) => (
                  <li key={i}>
                    <span className="block text-[11px] text-[#9CA3AF]">{formatDateTime(h.at)}</span>
                    {h.description}
                    {h.by ? <span className="text-[#6B7280]"> ({h.by})</span> : null}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}

function Step({ label, done, active }: { label: string; done: boolean; active: boolean }) {
  const tone = done ? 'bg-[#EAF6ED] text-[#166534]' : active ? 'bg-[#FFF4D6] text-[#8A5A00]' : 'bg-[#F3F4F6] text-[#9CA3AF]'
  return <li className={`rounded-lg px-2 py-1 ${tone}`} aria-current={active ? 'step' : undefined}>{done ? '✓ ' : ''}{label}</li>
}

// ---------------- A. Rider identity ----------------

function RiderIdentity({ detail: d, nameMismatch }: { detail: CashoutDetail; nameMismatch: boolean }) {
  const history = d.gcash_history ?? []
  return (
    <div className={card} role="region" aria-label="Rider identity">
      <SectionTitle letter="A" title="Rider identity" icon={<User className="h-4 w-4" />} />
      <Link to={`/admin/riders/${d.rider.id}`} className="font-semibold text-[#17201B] hover:underline">{d.rider.name ?? `Rider #${d.rider.id}`}</Link>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        <dt className={dt}>Account</dt><dd className="capitalize">{d.rider.account_status ?? '—'}</dd>
        <dt className={dt}>Email</dt><dd className="break-all">{d.rider.email ?? '—'}{d.rider.email_verified === false ? <span className="text-[#B45309]"> (not verified)</span> : null}</dd>
        <dt className={dt}>Mobile</dt><dd>{d.rider.phone ?? '—'}</dd>
        <dt className={dt}>Municipality</dt><dd>{d.rider.municipality ?? '—'}</dd>
        <dt className={dt}>Member since</dt><dd>{when(d.rider.member_since)}</dd>
      </dl>

      <div className={`mt-3 rounded-xl border p-3 ${d.new_destination || nameMismatch ? 'border-[#F2D27A] bg-[#FFFBEB]' : 'border-[#CFE8D6] bg-[#F4FBF6]'}`} data-testid="gcash-destination">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">Send to GCash</p>
        <p className="text-lg font-bold tracking-wide text-[#17201B]">{d.destination.gcash_number ?? '—'}</p>
        <p className="text-xs text-[#374151]">{d.destination.account_name ?? '—'}</p>
        {nameMismatch && <p className="mt-1 flex items-center gap-1 text-xs font-medium text-[#B45309]"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Name differs from the rider. Check before paying.</p>}
        {d.new_destination && <p className="mt-1 flex items-center gap-1 text-xs font-medium text-[#B45309]"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> First cashout to this number. Confirm it belongs to the rider.</p>}
      </div>

      <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">GCash numbers used before</p>
      {history.length === 0 ? (
        <p className="text-xs text-[#6B7280]">No earlier cashout requests.</p>
      ) : (
        <ul className="mt-1 space-y-1 text-xs" aria-label="GCash history">
          {history.map((g) => (
            <li key={g.gcash_number} className="flex items-center justify-between gap-2 rounded-lg bg-[#F9F8F3] px-2 py-1">
              <span>
                <span className="font-semibold text-[#17201B]">{g.gcash_number}</span>
                {g.gcash_number === d.destination.gcash_number && <span className="ml-1 text-[#166534]">(this request)</span>}
                <span className="block text-[11px] text-[#6B7280]">{g.account_name ?? '—'} · last {when(g.last_used_at)}</span>
              </span>
              <span className="shrink-0 text-right text-[11px] text-[#6B7280]">{g.paid} paid<br />{g.requests} asked</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------------- B. Earnings breakdown ----------------

function Breakdown({ detail: d, current, onSelect }: { detail: CashoutDetail; current: number | null; onSelect: (id: number) => void }) {
  return (
    <div className={card} role="region" aria-label="Earnings breakdown">
      <SectionTitle
        letter="B"
        title="Earnings breakdown"
        icon={<Wallet className="h-4 w-4" />}
        aside={
          d.all_verified === true ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-[#166534]"><ShieldCheck className="h-4 w-4" aria-hidden="true" /> Every earning verified</span>
          ) : d.all_verified === false ? (
            <span className="flex items-center gap-1 text-xs font-semibold text-[#B91C1C]"><CircleX className="h-4 w-4" aria-hidden="true" /> Some earnings failed verification</span>
          ) : (
            <span className="text-xs text-[#6B7280]">Released request: references as recorded</span>
          )
        }
      />
      <div className="overflow-x-auto rounded-xl border border-[#EEEBE0]">
        <table className="w-full min-w-[640px] text-xs" aria-label="Transaction breakdown">
          <thead>
            <tr className="bg-[#FBF8EF] text-left text-[11px] uppercase tracking-wider text-[#6B7280]">
              <th className="px-3 py-2 font-semibold">Source</th>
              <th className="px-3 py-2 font-semibold">Customer paid</th>
              <th className="px-3 py-2 font-semibold">Provider reference</th>
              <th className="px-3 py-2 font-semibold">Checks</th>
              <th className="px-3 py-2 text-right font-semibold">Earning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1EEE3]">
            {d.items.map((item) => {
              const failedChecks = item.checks.filter((c) => !c.ok)
              const active = current === item.earning_id
              return (
                <tr
                  key={item.earning_id}
                  data-testid="breakdown-row"
                  onClick={() => onSelect(item.earning_id)}
                  aria-selected={active}
                  className={`cursor-pointer ${active ? 'bg-[#FFF8E1]' : 'hover:bg-[#FBFAF5]'} ${item.verified === false ? 'border-l-4 border-l-[#DC2626]' : ''}`}
                >
                  <td className="px-3 py-2 align-top">
                    <p className="font-semibold text-[#17201B]">{item.type === 'ride' ? 'Ride' : 'Food'} · {item.reference ?? `Earning #${item.earning_id}`}</p>
                    <p className="text-[11px] text-[#6B7280]">{[item.customer_name, item.restaurant].filter(Boolean).join(' · ')}</p>
                    <p className="text-[11px] text-[#9CA3AF]">Completed {when(item.completed_at)}</p>
                  </td>
                  <td className="px-3 py-2 align-top">{money(item.customer_paid)}</td>
                  <td className="px-3 py-2 align-top">
                    <p className="break-all text-[#17201B]">{item.payment_reference ?? '—'}</p>
                    <p className="text-[11px] text-[#6B7280]">{item.payment_provider ?? item.payment_method ?? ''} · {when(item.paid_at)}</p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {item.verified === true && <span className="inline-flex items-center gap-0.5 font-semibold text-[#166534]"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> {item.checks.length}/{item.checks.length} passed</span>}
                    {item.verified === false && (
                      <span className="font-semibold text-[#B91C1C]">
                        <span className="inline-flex items-center gap-0.5"><XCircle className="h-3.5 w-3.5" aria-hidden="true" /> Failed</span>
                        <span className="block text-[11px] font-normal">{failedChecks.map((c) => c.label).join('; ')}</span>
                      </span>
                    )}
                    {item.verified === null && <span className="text-[#9CA3AF]">Snapshot</span>}
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <p className="font-semibold text-[#17201B]">{formatCurrency(item.amount)}</p>
                    <button type="button" onClick={(e) => { e.stopPropagation(); onSelect(item.earning_id) }} className={`mt-0.5 inline-flex items-center gap-0.5 whitespace-nowrap bg-transparent p-0 text-[11px] font-semibold shadow-none ${active ? 'text-[#8A5A00]' : 'text-[#16803C] hover:underline'}`}>
                      <Search className="h-3 w-3" aria-hidden="true" /> {active ? 'Viewing records' : 'Investigate'}
                    </button>
                  </td>
                </tr>
              )
            })}
            <tr className="bg-[#FBF8EF] font-semibold">
              <td className="px-3 py-2" colSpan={4}>Total requested</td>
              <td className="px-3 py-2 text-right">{formatCurrency(d.items_total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------- C. Original transaction investigation ----------------

function OriginalRecordsPanel({ payoutId, earningId, reference }: { payoutId: number; earningId: number; reference: string | null }) {
  const { data: r, isLoading, isError } = useQuery({
    queryKey: ['admin-cashout-earning', payoutId, earningId],
    queryFn: () => get<OriginalRecords>(`/admin/payouts/${payoutId}/earnings/${earningId}`),
  })

  return (
    <div className={card} role="region" aria-label="Original transaction records">
      <SectionTitle letter="C" title={`Original records${reference ? ` · ${reference}` : ''}`} icon={<Search className="h-4 w-4" />} />
      {isError && <p className="text-sm text-[#B91C1C]">The original records could not be loaded.</p>}
      {isLoading && <p className="text-sm text-[#6B7280]">Loading the original records…</p>}
      {r && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <Records title="Tourist account" icon={<User className="h-3.5 w-3.5" />}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className={dt}>Name</dt><dd>{r.tourist.name ?? '—'}</dd>
              <dt className={dt}>Email</dt><dd className="break-all">{r.tourist.email ?? '—'}</dd>
              <dt className={dt}>Mobile</dt><dd>{r.tourist.phone ?? '—'}</dd>
              <dt className={dt}>Account</dt>
              <dd>
                {r.tourist.account_id ? `#${r.tourist.account_id} · ${r.tourist.account_status ?? '—'}` : <span className="text-[#B45309]">Guest (no account)</span>}
                {r.tourist.account_id && !r.tourist.email_verified ? <span className="text-[#B45309]"> · email not verified</span> : null}
              </dd>
              <dt className={dt}>Member since</dt><dd>{when(r.tourist.member_since)}</dd>
            </dl>
          </Records>

          {r.type === 'ride' && r.ride ? (
            <Records title="Ride booking" icon={<Bike className="h-3.5 w-3.5" />}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt className={dt}>Booking</dt><dd className="font-semibold">{r.order.number}</dd>
                <dt className={dt}>Vehicle</dt><dd className="capitalize">{r.ride.vehicle_type ?? '—'}</dd>
                <dt className={dt}>Passengers</dt><dd>{r.ride.passenger_count ?? '—'}</dd>
                <dt className={dt}>Pick-up</dt><dd>{r.ride.pickup_address ?? '—'}</dd>
                <dt className={dt}>Drop-off</dt><dd>{r.ride.dropoff_address ?? '—'}</dd>
                <dt className={dt}>Distance</dt><dd>{r.ride.distance_km !== null ? `${r.ride.distance_km} km` : '—'}{r.ride.duration_minutes ? ` · ${r.ride.duration_minutes} min` : ''}</dd>
                <dt className={dt}>Fare</dt><dd className="font-semibold">{formatCurrency(r.ride.fare)}</dd>
                <dt className={dt}>Booked</dt><dd>{when(r.order.placed_at)}</dd>
              </dl>
            </Records>
          ) : (
            <Records title="Order and restaurant" icon={<Store className="h-3.5 w-3.5" />}>
              <p className="font-semibold">{r.order.number} <span className="font-normal text-[#6B7280]">· placed {when(r.order.placed_at)}</span></p>
              <p className="text-[#6B7280]">{r.restaurants.map((b) => b.name).join(', ') || '—'}</p>
              <table className="mt-1 w-full" aria-label="Order items">
                <tbody>
                  {r.items.map((i, n) => (
                    <tr key={n}>
                      <td className="py-0.5">{i.quantity}× {i.name}{i.cancelled_quantity > 0 ? <span className="text-[#B45309]"> ({i.cancelled_quantity} cancelled)</span> : null}</td>
                      <td className="py-0.5 text-right">{formatCurrency(i.subtotal)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-[#EEEBE0] text-[#6B7280]"><td className="pt-1">Delivery fee</td><td className="pt-1 text-right">{formatCurrency(r.order.delivery_fee)}</td></tr>
                  {r.order.tip > 0 && <tr className="text-[#6B7280]"><td>Rider tip</td><td className="text-right">{formatCurrency(r.order.tip)}</td></tr>}
                  {r.order.system_fee > 0 && <tr className="text-[#6B7280]"><td>System fee</td><td className="text-right">{formatCurrency(r.order.system_fee)}</td></tr>}
                  <tr className="font-semibold"><td>Total charged</td><td className="text-right">{formatCurrency(r.order.total)}</td></tr>
                </tbody>
              </table>
              {r.order.delivery_address && <p className="mt-1 text-[#6B7280]">Deliver to: {r.order.delivery_address}</p>}
            </Records>
          )}

          <Records title="Payment" icon={<BadgeCheck className="h-3.5 w-3.5" />}>
            {r.payments.length === 0 ? (
              <p className="font-semibold text-[#B91C1C]">No payment record.</p>
            ) : (
              <ul className="space-y-1.5" aria-label="Payments">
                {r.payments.map((p) => (
                  <li key={p.number} className={p.status === 'paid' && !p.refunded_at ? '' : 'text-[#B91C1C]'}>
                    <p className="font-semibold">{formatCurrency(p.amount)} · {p.status}{p.refunded_at ? ` · refunded ${when(p.refunded_at)}` : ''}</p>
                    <p className="break-all text-[#6B7280]">{[p.provider, p.method, p.provider_reference].filter(Boolean).join(' · ')}</p>
                    <p className="text-[#6B7280]">{p.number} · paid {when(p.paid_at)}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[#6B7280]">Order: {r.order.payment_method ?? '—'} · {r.order.payment_status ?? '—'}</p>
          </Records>

          <Records title="Rider assignment and dispatch" icon={<Bike className="h-3.5 w-3.5" />}>
            {r.assignment ? (
              <>
                <p>
                  Assigned to <span className="font-semibold">{r.assignment.rider?.name ?? '—'}</span> · {when(r.assignment.assigned_at)} · <span className="capitalize">{r.assignment.status?.replace(/_/g, ' ') ?? '—'}</span>
                </p>
                {r.assignment.dispatch.length > 0 ? (
                  <ol className="mt-1 space-y-0.5" aria-label="Dispatch history">
                    {r.assignment.dispatch.map((log, n) => (
                      <li key={n} className={log.is_this_rider ? 'font-semibold text-[#17201B]' : 'text-[#6B7280]'}>
                        #{log.attempt ?? n + 1} {log.rider} — {log.response ?? 'no response'} · {when(log.responded_at ?? log.offered_at)}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[#6B7280]">No offer log (claimed from the open board or assigned directly).</p>
                )}
              </>
            ) : (
              <p className="font-semibold text-[#B91C1C]">No delivery record.</p>
            )}
          </Records>

          {r.type === 'food' && (
            <Records title="Pickup confirmations" icon={<Store className="h-3.5 w-3.5" />}>
              {r.pickups.length === 0 ? (
                <p className="text-[#6B7280]">No pickup stops recorded (single-restaurant pickup: see "Picked up" below).</p>
              ) : (
                <ul className="space-y-0.5" aria-label="Pickup confirmations">
                  {r.pickups.map((s, n) => (
                    <Tick key={n} ok={!!s.confirmed_at}>{s.restaurant ?? 'Restaurant'} — {s.confirmed_at ? `confirmed ${when(s.confirmed_at)}` : (s.status ?? 'not confirmed')}</Tick>
                  ))}
                </ul>
              )}
            </Records>
          )}

          <Records title={r.type === 'ride' ? 'Trip completion' : 'Delivery confirmation'} icon={<CheckCircle2 className="h-3.5 w-3.5" />}>
            {r.completion ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                <dt className={dt}>{r.type === 'ride' ? 'Passenger on board' : 'Picked up'}</dt><dd>{when(r.completion.picked_up_at)}</dd>
                <dt className={dt}>Arrived</dt><dd>{when(r.completion.arrived_destination_at)}</dd>
                <dt className={dt}>{r.type === 'ride' ? 'Completed' : 'Delivered'}</dt><dd>{when(r.completion.delivered_at)}</dd>
                <dt className={dt}>Confirmed</dt><dd>{r.completion.confirmed_at ? `${when(r.completion.confirmed_at)} by ${r.completion.confirmed_by ?? '—'}` : '—'}</dd>
                {r.type === 'food' && (
                  <>
                    <dt className={dt}>Drop-off photo</dt>
                    <dd>{r.completion.proof_photo ? `On file${r.completion.proof_distance_m !== null ? ` · taken ${Math.round(r.completion.proof_distance_m)} m from the drop-off` : ''}` : 'None'}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="font-semibold text-[#B91C1C]">Not completed.</p>
            )}
          </Records>

          <Records title="Earning computation" icon={<Wallet className="h-3.5 w-3.5" />} wide>
            <p className={`font-semibold ${r.earning.matches_formula ? 'text-[#166534]' : 'text-[#B91C1C]'}`} data-testid="earning-formula">
              {r.earning.formula}
              {!r.earning.matches_formula && ' — does not match the recorded earning'}
            </p>
            <p className="text-[#6B7280]">
              Delivery fee charged to the customer {formatCurrency(r.earning.delivery_fee_charged)} · earned {when(r.earning.earned_at)} · earning #{r.earning.id} ({r.earning.status})
            </p>
            <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-0.5 sm:grid-cols-2" aria-label="Verification checks">
              {r.verification.map((c) => (
                <Tick key={c.key} ok={c.ok}>{c.label}{c.detail ? ` — ${c.detail}` : ''}</Tick>
              ))}
            </ul>
          </Records>
        </div>
      )}
    </div>
  )
}

function Records({ title, icon, wide, children }: { title: string; icon: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={`rounded-xl border border-[#EEEBE0] bg-[#FDFCF8] p-3 text-xs text-[#374151] ${wide ? 'lg:col-span-2' : ''}`} role="group" aria-label={title}>
      <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]"><span className={GOLD} aria-hidden="true">{icon}</span>{title}</p>
      {children}
    </div>
  )
}

// ---------------- D. Financial verification ----------------

function FinancialVerification({ detail: d }: { detail: CashoutDetail }) {
  const f = d.financial!
  const rows: [string, number, string?][] = [
    ['Customers were charged', f.customer_paid],
    ['Provider confirmed', f.gateway_confirmed],
    ['Earnings in this request', f.earnings_in_request],
  ]
  const ledger: [string, number][] = [
    ['Lifetime online earnings', f.lifetime_online_earnings],
    ['Paid out before', f.paid_out_before],
    ['Other open requests', f.other_open_requests],
    ['This request', d.status === 'paid' ? 0 : d.amount],
  ]
  return (
    <div className={card} role="region" aria-label="Financial verification">
      <SectionTitle letter="D" title="Financial verification" icon={<ShieldCheck className="h-4 w-4" />} />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">This request's transactions</p>
          <dl className="space-y-1 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2 rounded-lg bg-[#FBF8EF] px-3 py-1.5"><dt className="text-[#4B5563]">{label}</dt><dd className="font-semibold text-[#17201B]">{formatCurrency(value)}</dd></div>
            ))}
          </dl>
        </div>
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">Rider's online earnings ledger</p>
          <dl className="space-y-1 text-sm">
            {ledger.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2 px-3 py-0.5"><dt className="text-[#4B5563]">{label}</dt><dd className="text-[#17201B]">{formatCurrency(value)}</dd></div>
            ))}
            <div className={`flex justify-between gap-2 rounded-lg px-3 py-1.5 font-semibold ${f.remaining_unpaid < 0 ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#EAF6ED] text-[#166534]'}`} data-testid="remaining-unpaid">
              <dt>Remaining unpaid after this</dt><dd>{formatCurrency(f.remaining_unpaid)}</dd>
            </div>
          </dl>
        </div>
      </div>
      <ul className="mt-3 space-y-0.5 text-xs" aria-label="Financial checks">
        {f.checks.map((c) => (
          <Tick key={c.key} ok={c.ok}>{c.label}</Tick>
        ))}
      </ul>
    </div>
  )
}

// ---------------- E. Decision ----------------

function Outcome({ detail: d, onError }: { detail: CashoutDetail; onError: (e: unknown, f: string) => void }) {
  if (!d.review.rejection_reason && !d.failure && !d.payment && !d.review.approved_by) return null
  return (
    <div className="space-y-2 text-sm">
      {d.review.approved_by && !d.payment && (
        <p className="rounded-lg bg-[#EAF6ED] px-3 py-2 text-xs text-[#166534]">
          Approved by {d.review.approved_by.name} · {when(d.review.approved_at)}{d.review.note ? ` — "${d.review.note}"` : ''}
        </p>
      )}
      {d.review.rejection_reason && <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[#B91C1C]">Rejected: {d.review.rejection_reason}</p>}
      {d.failure && (
        <p className="rounded-lg bg-[#FEF2F2] px-3 py-2 text-[#B91C1C]">
          Payout failed: {d.failure.reason} ({d.failure.failed_by?.name}, {when(d.failure.failed_at)})
        </p>
      )}
      {d.payment && (
        <div className="rounded-xl border border-[#CFE8D6] bg-[#F4FBF6] p-3" data-testid="payment-record">
          <p className="flex items-center gap-1 font-semibold text-[#166534]"><BadgeCheck className="h-4 w-4" aria-hidden="true" /> Paid through GCash</p>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#374151]">
            <dt className={dt}>Reference</dt><dd className="font-semibold">{d.payment.reference}</dd>
            <dt className={dt}>Amount</dt><dd>{formatCurrency(d.payment.amount)}</dd>
            <dt className={dt}>Recipient</dt><dd>{d.payment.recipient_number} · {d.payment.recipient_name}</dd>
            <dt className={dt}>Paid</dt><dd>{when(d.payment.paid_at)}</dd>
            <dt className={dt}>Approved by</dt><dd>{d.review.approved_by?.name ?? '—'}</dd>
            <dt className={dt}>Paid by</dt><dd>{d.payment.paid_by?.name ?? '—'}</dd>
          </dl>
          {d.payment.has_proof && (
            <button
              type="button"
              onClick={() => openAuthenticatedDocument(`/admin/payouts/${d.id}/proof`).catch((e) => onError(e, 'Could not open the proof.'))}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#16803C] hover:underline"
            >
              <FileImage className="h-3.5 w-3.5" aria-hidden="true" /> View transfer proof
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ActionButton({ label, hint, onRun, onDone, onError }: { label: string; hint: string; onRun: () => Promise<unknown>; onDone: () => void; onError: (e: unknown) => void }) {
  const m = useMutation({ mutationFn: onRun, onSuccess: onDone, onError })
  return (
    <div className="rounded-xl border border-[#F2D27A] bg-[#FFFBEB] p-3">
      <button type="button" onClick={() => m.mutate()} disabled={m.isPending} className="rounded-lg bg-[#E9B949] px-4 py-2 text-sm font-semibold text-[#3D2A00] hover:bg-[#DDAA35] disabled:opacity-50">
        {label}
      </button>
      <p className="mt-1 text-[11px] text-[#6B7280]">{hint}</p>
    </div>
  )
}

const VALIDATION_STYLE: Record<'pass' | 'flag' | 'block', { label: string; tone: string }> = {
  pass: { label: 'PASS', tone: 'bg-[#DCFCE7] text-[#166534]' },
  flag: { label: 'FLAG — investigate', tone: 'bg-[#FFF4D6] text-[#8A5A00]' },
  block: { label: 'BLOCK — cannot proceed', tone: 'bg-[#FEE2E2] text-[#B91C1C]' },
}

/** Stage 6: the cashout's latest validation against the permanent earnings ledger. */
function LedgerValidation({ detail: d, onDone, onError }: { detail: CashoutDetail; onDone: (t: string) => void; onError: (e: unknown, f: string) => void }) {
  const recheck = useMutation({
    mutationFn: () => post(`/admin/payouts/${d.id}/validate`),
    onSuccess: () => onDone('Checked again against the earnings ledger.'),
    onError: (e) => onError(e, 'Could not validate the request.'),
  })
  const v = d.validation
  const live = d.status === 'pending' || d.status === 'under_review' || d.status === 'approved'
  return (
    <div className="rounded-xl border border-[#E5E9E7] p-3" role="region" aria-label="Ledger validation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-[#17201B]">Ledger validation</p>
        {v ? (
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${VALIDATION_STYLE[v.result].tone}`} data-testid="validation-result">
            {VALIDATION_STYLE[v.result].label}
          </span>
        ) : (
          <span className="text-xs text-[#6B7280]">Not validated yet</span>
        )}
      </div>
      {v && (
        <>
          <p className="mt-0.5 text-[11px] text-[#6B7280]">
            At {v.context === 'request' ? 'request' : v.context === 'approve' ? 'approval' : v.context === 'pay' ? 'payment' : 're-check'} · {formatDateTime(v.at)}{v.checked_by ? ` · ${v.checked_by}` : ''}
          </p>
          {v.checks.some((c) => !c.ok) && (
            <ul className="mt-2 space-y-0.5 text-[11px]" aria-label="Failed validation checks">
              {v.checks.filter((c) => !c.ok).map((c) => (
                <li key={c.key} className={c.severity === 'block' ? 'text-[#B91C1C]' : 'text-[#8A5A00]'}>
                  {c.severity === 'block' ? '✗' : '!'} {c.label}{c.detail ? ` — ${c.detail}` : ''}
                </li>
              ))}
            </ul>
          )}
          {v.decision_note && <p className="mt-2 rounded-lg bg-[#F6F8F4] px-2 py-1 text-[11px] text-[#374151]">Decision: {v.decision_note}</p>}
        </>
      )}
      {live && (
        <button type="button" onClick={() => recheck.mutate()} disabled={recheck.isPending} className="mt-2 text-xs font-semibold text-[#16803C] hover:underline disabled:opacity-50">
          {recheck.isPending ? 'Checking…' : 'Check again against the ledger'}
        </button>
      )}
    </div>
  )
}

function ApproveForm({ id, disabled, flagged = false, noteMin = 10, onDone, onError }: { id: number; disabled: boolean; flagged?: boolean; noteMin?: number; onDone: (t: string) => void; onError: (e: unknown, f: string) => void }) {
  const [password, setPassword] = useState('')
  const [note, setNote] = useState('')
  const m = useMutation({
    mutationFn: () => post(`/admin/payouts/${id}/approve`, { password, note: note.trim() || undefined }),
    onSuccess: () => {
      setPassword('')
      onDone('Approved. Send the GCash transfer, then confirm the payment.')
    },
    onError: (e) => onError(e, 'Could not approve.'),
  })
  return (
    <form className="rounded-xl border border-[#E5E9E7] p-3" aria-label="Approve cashout" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <p className="text-sm font-bold text-[#17201B]">Approve</p>
      <p className="text-[11px] text-[#6B7280]">Approving does not send money. The server re-checks every earning first. Enter your password to confirm it is you.</p>
      <label className="mt-2 block text-xs font-medium text-[#4B5563]">Your password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Approver password" className={field} /></label>
      <label className="mt-2 block text-xs font-medium text-[#4B5563]">
        {flagged ? 'Investigation decision (required — this request is flagged)' : 'Note (optional)'}
        {flagged ? (
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} aria-label="Approval note" className={field}
            placeholder="What you checked and why the payout is justified" />
        ) : (
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} aria-label="Approval note" className={field} />
        )}
      </label>
      <button type="submit" disabled={disabled || !password || (flagged && note.trim().length < noteMin) || m.isPending} className="mt-2 w-full rounded-lg bg-[#16803C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-50">
        {m.isPending ? 'Approving…' : 'Approve cashout'}
      </button>
      {disabled && <p className="mt-1 text-[11px] text-[#B91C1C]">Approval is blocked until every earning verifies and the ledger validation passes.</p>}
      {flagged && !disabled && <p className="mt-1 text-[11px] text-[#8A5A00]">Document your investigation (at least {noteMin} characters) before approving a flagged cashout.</p>}
    </form>
  )
}

function PaymentForm({ detail, onDone, onError }: { detail: CashoutDetail; onDone: (t: string) => void; onError: (e: unknown, f: string) => void }) {
  const [reference, setReference] = useState('')
  const [amount, setAmount] = useState(String(detail.amount))
  const [number, setNumber] = useState(detail.destination.gcash_number ?? '')
  const [name, setName] = useState(detail.destination.account_name ?? '')
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
      return post(`/admin/payouts/${detail.id}/mark-paid`, body)
    },
    onSuccess: () => onDone('Payment confirmed.'),
    onError: (e) => onError(e, 'Could not confirm the payment.'),
  })
  const ready = reference.trim() && amount && number.trim() && name.trim() && paidAt && proof && password
  return (
    <form className="rounded-xl border-2 border-[#16803C] p-3" aria-label="Confirm GCash payment" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <p className="flex items-center gap-1 text-sm font-bold text-[#17201B]"><HandCoins className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> Confirm GCash payment</p>
      <p className="text-[11px] text-[#6B7280]">
        Send {formatCurrency(detail.amount)} from the Tourism Office GCash to {detail.destination.gcash_number}, then record the transfer. TrackTour never sends money itself.
      </p>
      {detail.two_person_required && (
        <p className="mt-1 text-[11px] font-medium text-[#B45309]">
          {formatCurrency(detail.two_person_threshold)} or more: a staff member other than the approver ({detail.review.approved_by?.name ?? '—'}) must confirm.
        </p>
      )}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
        <label className="text-xs font-medium text-[#4B5563]">GCash reference no.<input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={64} aria-label="GCash reference number" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563]">Amount sent (₱)<input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Amount sent" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563]">Recipient GCash no.<input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={11} aria-label="Recipient GCash number" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563]">Recipient name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Recipient name" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563]">Date and time sent<input type="datetime-local" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} aria-label="Date sent" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563]">Proof of transfer<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setProof(e.target.files?.[0] ?? null)} aria-label="Proof of transfer" className={field} /></label>
        <label className="text-xs font-medium text-[#4B5563] sm:col-span-2 xl:col-span-1">Your password<input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Payer password" className={field} /></label>
      </div>
      <button type="submit" disabled={!ready || m.isPending} className="mt-2 w-full rounded-lg bg-[#16803C] px-4 py-2 text-sm font-semibold text-white hover:bg-[#126B32] disabled:opacity-50">
        {m.isPending ? 'Confirming…' : 'Mark as paid'}
      </button>
    </form>
  )
}

function ReasonForm({ id, kind, onDone, onError }: { id: number; kind: 'reject' | 'fail'; onDone: (t: string) => void; onError: (e: unknown, f: string) => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const reject = kind === 'reject'
  const m = useMutation({
    mutationFn: () => post(`/admin/payouts/${id}/${reject ? 'reject' : 'mark-failed'}`, reject ? { reason } : { reason, password }),
    onSuccess: () => onDone(reject ? 'Rejected. The earnings returned to the rider.' : 'Marked failed. The earnings returned to the rider.'),
    onError: (e) => onError(e, reject ? 'Could not reject.' : 'Could not mark it failed.'),
  })
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-[#FCA5A5] px-3 py-1.5 text-sm font-semibold text-[#B91C1C] hover:bg-[#FEF2F2]">
        {reject ? 'Reject…' : 'Transfer failed…'}
      </button>
    )
  }
  return (
    <form className="w-full rounded-xl border border-[#FCA5A5] p-3" aria-label={reject ? 'Reject cashout' : 'Payout failed'} onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
      <label className="text-xs font-medium text-[#4B5563]">
        {reject ? 'Reason for rejecting (the rider sees this)' : 'What went wrong with the transfer'}
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} aria-label={reject ? 'Rejection reason' : 'Failure reason'} className={field} />
      </label>
      {!reject && (
        <label className="mt-2 block text-xs font-medium text-[#4B5563]">Your password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Password for failure" className={field} /></label>
      )}
      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={!reason.trim() || (!reject && !password) || m.isPending} className="rounded-lg bg-[#B91C1C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {reject ? 'Reject cashout' : 'Mark failed'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-[#D7E2DC] px-3 py-2 text-sm">Cancel</button>
      </div>
    </form>
  )
}
