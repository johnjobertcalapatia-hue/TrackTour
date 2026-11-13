import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, ChevronRight, Clock, HandCoins, Hourglass } from 'lucide-react'
import { get } from '@/shared/services/api'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { CashoutStatusChip, type CashoutStatus } from './AdminCashoutInvestigation'

export type { CashoutDetail } from './AdminCashoutInvestigation'

interface ListRow {
  id: number
  payout_number: string
  status: CashoutStatus
  amount: number
  rider: { id: number; name: string | null }
  destination_gcash_number: string | null
  items_count: number
  requested_at: string
}

/** GET /admin/payouts/summary (AdminPayoutController::summary). */
interface Summary {
  pending_count: number
  under_review_count: number
  awaiting_review_amount: number
  approved_unpaid_count: number
  approved_unpaid_amount: number
  paid_today_amount: number
  paid_today_count: number
}

const TABS: { key: string; label: string; empty: string }[] = [
  { key: 'pending', label: 'Pending', empty: 'No new cashout requests.' },
  { key: 'under_review', label: 'Under Review', empty: 'Nothing is under review.' },
  { key: 'approved', label: 'Approved', empty: 'No approved cashouts waiting for a GCash transfer.' },
  { key: 'paid', label: 'Paid', empty: 'No paid cashouts yet.' },
  { key: 'rejected', label: 'Rejected', empty: 'No rejected cashouts.' },
  { key: 'failed', label: 'Failed', empty: 'No failed transfers.' },
  { key: '', label: 'All', empty: 'No cashout requests yet.' },
]

/**
 * Tourism Office cashout management (decision 2026-11-11). Dashboard tiles,
 * the request queue by stage, and a row per request that opens its full
 * investigation page (/admin/cashouts/:id).
 */
export default function AdminRiderCashouts() {
  const navigate = useNavigate()
  const [tab, setTab] = useState('pending')

  const summary = useQuery({
    queryKey: ['admin-cashouts-summary'],
    queryFn: () => get<Summary>('/admin/payouts/summary'),
    refetchInterval: 60_000,
  })
  const list = useQuery({
    queryKey: ['admin-cashouts', tab],
    queryFn: () => get<{ data: ListRow[] }>('/admin/payouts', { params: tab ? { status: tab } : {} }),
  })
  const rows = list.data?.data ?? []
  const s = summary.data
  const current = TABS.find((t) => t.key === tab)!

  const counts: Record<string, number | undefined> = {
    pending: s?.pending_count,
    under_review: s?.under_review_count,
    approved: s?.approved_unpaid_count,
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-[#17201A] lg:text-3xl">Rider Cashouts</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          No verified transaction, no earnings. No verified earnings, no cashout. No Tourism Office approval, no payout.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Cashout summary" role="group">
        <Tile label="Pending requests" value={s ? String(s.pending_count) : '—'} hint={s ? `${s.under_review_count} under review` : ''} icon={<Clock className="h-5 w-5" />} accent="gold" testId="tile-pending" />
        <Tile label="Awaiting review" value={s ? formatCurrency(s.awaiting_review_amount) : '—'} hint="Pending + under review" icon={<Hourglass className="h-5 w-5" />} accent="gold" testId="tile-awaiting" />
        <Tile label="Approved, not yet paid" value={s ? String(s.approved_unpaid_count) : '—'} hint={s ? `${formatCurrency(s.approved_unpaid_amount)} to send` : ''} icon={<HandCoins className="h-5 w-5" />} accent="blue" testId="tile-approved" />
        <Tile label="Paid today" value={s ? formatCurrency(s.paid_today_amount) : '—'} hint={s ? `${s.paid_today_count} ${s.paid_today_count === 1 ? 'transfer' : 'transfers'}` : ''} icon={<BadgeCheck className="h-5 w-5" />} accent="green" testId="tile-paid-today" />
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-[#F7F4EA] p-1" role="tablist" aria-label="Cashout status">
        {TABS.map((t) => (
          <button
            key={t.key || 'all'}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === t.key ? 'bg-white text-[#17201B] shadow-sm' : 'text-[#6B7280] hover:text-[#17201B]'}`}
          >
            {t.label}
            {counts[t.key] ? <span className="rounded-full bg-[#E9B949] px-1.5 text-[11px] font-bold text-[#3D2A00]">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#E7E3D4] bg-white">
        <table className="w-full min-w-[720px] text-sm" aria-label="Cashout requests">
          <thead>
            <tr className="bg-[#FBF8EF] text-left text-[11px] uppercase tracking-wider text-[#6B7280]">
              <th className="px-4 py-2 font-semibold">Request</th>
              <th className="px-4 py-2 font-semibold">Rider</th>
              <th className="px-4 py-2 font-semibold">GCash</th>
              <th className="px-4 py-2 font-semibold">Earnings</th>
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 text-right font-semibold">Amount</th>
              <th className="w-8 px-2 py-2" aria-hidden="true" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F1EEE3]">
            {rows.map((r) => (
              <tr
                key={r.id}
                data-testid="cashout-row"
                tabIndex={0}
                onClick={() => navigate(`/admin/cashouts/${r.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/admin/cashouts/${r.id}`) }}
                className="cursor-pointer hover:bg-[#FFFBEB] focus:bg-[#FFFBEB] focus:outline-none"
              >
                <td className="px-4 py-2.5">
                  <p className="font-semibold text-[#17201B]">{r.payout_number}</p>
                  <p className="text-[11px] text-[#9CA3AF]">{formatDateTime(r.requested_at)}</p>
                </td>
                <td className="px-4 py-2.5 text-[#17201B]">{r.rider.name ?? `Rider #${r.rider.id}`}</td>
                <td className="px-4 py-2.5 text-[#4B5563]">{r.destination_gcash_number ?? '—'}</td>
                <td className="px-4 py-2.5 text-[#4B5563]">{r.items_count}</td>
                <td className="px-4 py-2.5"><CashoutStatusChip status={r.status} /></td>
                <td className="px-4 py-2.5 text-right font-semibold text-[#17201B]">{formatCurrency(r.amount)}</td>
                <td className="px-2 py-2.5 text-[#C9A23A]"><ChevronRight className="h-4 w-4" aria-hidden="true" /></td>
              </tr>
            ))}
            {!list.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-[#9CA3AF]">{current.empty}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const ACCENT = {
  gold: 'bg-[#FFF4D6] text-[#A8780A]',
  blue: 'bg-[#DBEAFE] text-[#1D4ED8]',
  green: 'bg-[#EAF6ED] text-[#16803C]',
}

function Tile({ label, value, hint, icon, accent, testId }: { label: string; value: string; hint: string; icon: ReactNode; accent: keyof typeof ACCENT; testId: string }) {
  return (
    <div className="rounded-2xl border border-[#E7E3D4] bg-white p-4" data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-[#6B7280]">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${ACCENT[accent]}`} aria-hidden="true">{icon}</span>
      </div>
      <p className="mt-1 text-2xl font-bold text-[#17201B]">{value}</p>
      <p className="text-[11px] text-[#6B7280]">{hint}</p>
    </div>
  )
}
