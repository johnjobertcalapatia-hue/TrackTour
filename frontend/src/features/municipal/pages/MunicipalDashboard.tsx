import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  BarChart3, Bike, Building2, CalendarDays, ClipboardList, Store, Table2, TrendingUp, Truck, Users, Wallet,
} from 'lucide-react'
import { apiErrorMessage, get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { cn, formatDate, toAssetUrl } from '@/shared/utils'
import {
  ActivitySection, AttentionBar, DashboardLinkContext, Delta, KpiCard, OperationsSection, OpportunitiesSection, Panel, PopularitySection,
  SectionHeading,
} from '@/features/admin/components/dashboard/DashboardSections'
import { count, peso, pesoShort, type Compare, type PeriodKey } from '@/features/admin/components/dashboard/types'
import { DashboardHeader, PeriodFilter, todayKey } from '@/features/admin/components/dashboard/DashboardHeader'
import { MUNICIPAL_API, type MunicipalAnalytics, type MunicipalDashboardData } from '@/features/municipal/types'


/**
 * The shared dashboard sections are written with Bansud admin paths; on the
 * municipal portal each one opens the matching municipal page instead.
 */
export function toMunicipalPath(to: string): string {
  if (to.startsWith('/municipal')) return to
  const business = /^\/admin\/businesses\/(\d+)/.exec(to)
  if (business) return `/municipal/businesses/${business[1]}`
  if (to.startsWith('/admin/businesses')) return '/municipal/businesses'
  if (to.startsWith('/admin/users/tourists')) return '/municipal/tourists'
  if (to.startsWith('/admin/users?role=business_owner')) return '/municipal/business-owners'
  if (to.startsWith('/admin/users')) return '/municipal/tourists'
  if (/^\/admin\/(riders|live|rider-)/.test(to)) return '/municipal/riders'
  if (to.startsWith('/admin/audit-logs')) return '/municipal/activity-logs'
  return '/municipal/reports'
}

/**
 * Municipal Tourism Office — the Bansud Tourism Dashboard's design and
 * figures, for this municipality only. Analytics come from
 * /municipal/dashboard/analytics (scoped server-side to the officer's
 * municipality); review queues, newest businesses and office activity come
 * from /municipal/dashboard.
 */
export default function MunicipalDashboard() {
  const [period, setPeriod] = useState<PeriodKey>('this_month')
  const [range, setRange] = useState({ from: todayKey(), to: todayKey() })
  const [applied, setApplied] = useState(range)

  const params: Record<string, string> = { period }
  if (period === 'custom') Object.assign(params, applied)

  const base = useQuery({
    queryKey: ['municipal', 'dashboard'],
    queryFn: () => get<MunicipalDashboardData>(MUNICIPAL_API.DASHBOARD),
    refetchInterval: 60_000,
  })
  const analytics = useQuery({
    queryKey: ['municipal', 'analytics', params],
    queryFn: () => get<MunicipalAnalytics>(MUNICIPAL_API.DASHBOARD_ANALYTICS, { params }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })

  if (base.isLoading || analytics.isLoading) return <DashboardSkeleton />
  if (!base.data || !analytics.data) {
    return <div className="py-20 text-center text-[#66736B]">{apiErrorMessage(base.error ?? analytics.error, 'Unable to load dashboard data.')}</div>
  }

  const { municipality, stats, pending, recent_businesses: recentBusinesses, recent_activity: recentActivity } = base.data
  const data = analytics.data
  const o = data.overview
  const periodLabel = data.period.label
  const pendingApprovals = stats.business_owners.pending + stats.businesses.pending + stats.riders.pending
  const refresh = () => {
    base.refetch()
    analytics.refetch()
  }

  // Review queues, counted exactly as the municipal list pages count them.
  const alerts = [
    { key: 'business_owners', label: 'Business owners to verify', count: stats.business_owners.pending, link: '/municipal/business-owners' },
    { key: 'businesses', label: 'Business registrations to review', count: stats.businesses.pending, link: '/municipal/businesses' },
    { key: 'riders', label: 'Rider applicants', count: stats.riders.pending, link: '/municipal/riders' },
    { key: 'documents', label: 'Business documents to verify', count: stats.documents.business_pending, link: '/municipal/documents' },
    { key: 'flagged', label: 'Flagged business documents', count: stats.documents.business_flagged, link: '/municipal/documents?status=flagged' },
    { key: 'rider_documents', label: 'Rider requirements to review', count: stats.documents.riders_pending, link: '/municipal/documents?type=rider' },
  ]
  const indicators: { label: string; value: string; to: string }[] = [
    { label: 'Active riders', value: count(o.riders.active), to: '/municipal/riders' },
    { label: 'Riders online', value: count(o.riders.online_now), to: '/municipal/riders' },
    { label: 'Tourists online', value: count(data.live.tourists_online), to: '/municipal/tourists' },
    { label: 'Active business owners', value: count(o.business_owners.active), to: '/municipal/business-owners' },
    { label: 'New registrations today', value: count(o.users.new_today), to: '/municipal/tourists' },
    { label: 'Pending approvals', value: count(pendingApprovals), to: '/municipal/business-owners' },
  ]
  const reviewItems = [
    ...pending.business_owners.map((p) => ({ key: `o${p.id}`, label: p.name, kind: 'Business owner', date: p.created_at, href: `/municipal/business-owners/${p.id}` })),
    ...pending.businesses.map((b) => ({ key: `b${b.id}`, label: b.business_name, kind: 'Business', date: b.created_at, href: `/municipal/businesses/${b.id}` })),
    ...pending.riders.map((r) => ({ key: `r${r.id}`, label: r.name, kind: 'Rider', date: r.created_at, href: `/municipal/riders/${r.id}` })),
  ].slice(0, 6)

  return (
    <DashboardLinkContext.Provider value={toMunicipalPath}>
      <div className="space-y-6">
        <DashboardHeader
          cover={municipality.cover_photo}
          logo={municipality.logo}
          name={`${municipality.name} Tourism Office`}
          title={`${municipality.name} Tourism Dashboard`}
          period={data.period}
          onRefresh={refresh}
          refreshing={base.isFetching || analytics.isFetching}
          filters={<PeriodFilter period={period} onPeriod={setPeriod} range={range} onRange={setRange} onApply={() => setApplied(range)} />}
        />

        {/* ── Tier 1 · What matters now ─────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-5">
            <EconomyHero economy={data.economy} periodLabel={periodLabel} municipality={municipality.name} />
          </div>
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:col-span-7" aria-label="Municipality performance">
            <KpiCard label="Tourism Businesses" value={count(o.businesses.total)} icon={Building2} to="/municipal/businesses"
              delta={<Delta c={o.businesses.new} />} sub={<>Active {count(o.businesses.active)} · Pending {count(stats.businesses.pending)} · Suspended {count(o.businesses.suspended)}</>} />
            <KpiCard label="Registered Users" value={count(o.users.total)} icon={Users} to="/municipal/tourists"
              delta={<Delta c={o.users.new} />} sub={<>Online now: {count(o.users.online_now)} · {count(o.users.new.value)} new</>} />
            <KpiCard label="Deliveries" value={count(o.deliveries.value)} icon={Truck} to="/municipal/reports" delta={<Delta c={o.deliveries} />} sub={periodLabel} />
            <KpiCard label="Ride-hailing" value={count(o.ride_hailing.value)} icon={Bike} to="/municipal/reports" delta={<Delta c={o.ride_hailing} />} sub={periodLabel} />
            <KpiCard label="Bookings & reservations" value={count(o.bookings.value)} icon={CalendarDays} to="/municipal/businesses" delta={<Delta c={o.bookings} />} sub={periodLabel} />
            <KpiCard label="Riders" value={count(o.riders.active)} icon={Bike} to="/municipal/riders" tone="gold"
              sub={<>Online now {count(o.riders.online_now)} · {count(stats.riders.pending)} applicants</>} />
          </section>
        </div>

        <AttentionBar alerts={alerts} />

        <ul className="flex flex-wrap gap-x-6 gap-y-1 px-1 text-sm" aria-label="Indicators">
          {indicators.map((i) => (
            <li key={i.label}>
              <Link to={i.to} className="text-[#66736B] hover:text-[#1C2B22]">
                {i.label} <span className="font-semibold tabular-nums text-[#1C2B22]">{i.value}</span>
              </Link>
            </li>
          ))}
        </ul>

        {/* ── Tier 2 · Decision sections ───────────────────────────── */}
        <SectionHeading index="1" title="Business popularity & growth" description={`Which ${municipality.name} businesses are gaining visibility, and which need promotional support`} />
        <PopularitySection data={data.popularity} />
        <OpportunitiesSection items={data.opportunities} />

        <SectionHeading index="2" title="Local tourism economy" description={`Customer spending and what ${municipality.name} businesses and riders earned, from verified records`} />
        <EconomySection economy={data.economy} trend={data.trend} periodLabel={periodLabel} />

        {/* ── Tier 3 · Supporting detail ───────────────────────────── */}
        <SectionHeading index="3" title="Operations & records" description="Live activity, review queues, new businesses and office actions" />
        <OperationsSection ops={data.operations} live={data.live} periodLabel={periodLabel} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="Applications to review" icon={ClipboardList} to="/municipal/business-owners" size="compact">
            {reviewItems.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[#66736B]">Nothing waiting for review.</p>
            ) : (
              <ul className="divide-y divide-[#F1EDE3]">
                {reviewItems.map((item) => (
                  <li key={item.key}>
                    <Link to={item.href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#FAF7F0]">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-[#1C2B22]">{item.label}</span>
                        <span className="block text-xs text-[#66736B]">Applied {formatDate(item.date)}</span>
                      </span>
                      <span className="shrink-0 rounded-full bg-[#FFF6CC] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#5C4A00]">{item.kind}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Recently registered businesses" icon={Store} to="/municipal/businesses" size="compact">
            {recentBusinesses.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-[#66736B]">No businesses registered yet.</p>
            ) : (
              <ul className="divide-y divide-[#F1EDE3]">
                {recentBusinesses.map((b) => (
                  <li key={b.id}>
                    <Link to={`/municipal/businesses/${b.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-[#FAF7F0]">
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#E6F2EB]">
                          {b.logo ? <img src={toAssetUrl(b.logo)} alt="" className="h-full w-full object-cover" /> : <Store className="h-4 w-4 text-[#2E8B57]" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[#1C2B22]">{b.business_name}</span>
                          <span className="block truncate text-xs text-[#66736B]">{[b.category, b.barangay].filter(Boolean).join(' · ') || 'Uncategorized'} · {formatDate(b.created_at)}</span>
                        </span>
                      </span>
                      <StatusBadge status={b.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <ActivitySection items={recentActivity.map((a) => ({ id: a.id, description: a.description, by: a.actor, at: a.created_at }))} />
        </div>
      </div>
    </DashboardLinkContext.Provider>
  )
}

/** Tier 1: the one high-emphasis element — customer spending in this municipality. */
function EconomyHero({ economy: e, periodLabel, municipality }: { economy: MunicipalAnalytics['economy']; periodLabel: string; municipality: string }) {
  const facts = [
    { label: 'Business earnings', value: e.business_owner_earnings.value },
    { label: 'Rider earnings', value: e.rider_earnings.value },
    { label: 'Refunds', value: e.refunds.value },
  ]
  return (
    <Link
      to="/municipal/reports"
      aria-label={`Tourism transaction value ${peso(e.gross_transaction_value.value)}, ${periodLabel}`}
      className="relative flex h-full flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-[#0F2E1D] via-[#16472C] to-[#2E8B57] p-6 text-white shadow-[0_10px_30px_rgba(15,46,29,0.25)] transition hover:shadow-[0_14px_36px_rgba(15,46,29,0.32)]"
    >
      <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#FFD700]/10" aria-hidden="true" />
      <span>
        <span className="flex items-center gap-2 text-sm font-medium text-white/80">
          <Wallet className="h-4 w-4 text-[#FFD700]" aria-hidden="true" /> Tourism transaction value · {periodLabel}
        </span>
        <span className="mt-2 block truncate text-4xl font-bold tracking-tight tabular-nums lg:text-[44px]">{peso(e.gross_transaction_value.value)}</span>
        <span className="mt-1 flex items-center gap-2 text-sm text-white/75"><Delta c={e.gross_transaction_value} light /> vs previous period</span>
        <span className="mt-1 block text-xs text-white/60">Completed orders and bookings with {municipality} businesses</span>
      </span>
      <span className="mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-4">
        {facts.map((x) => (
          <span key={x.label} className="min-w-0">
            <span className="block text-[11px] uppercase tracking-wider text-white/60">{x.label}</span>
            <span className="block truncate text-base font-semibold tabular-nums">{pesoShort(x.value)}</span>
          </span>
        ))}
      </span>
    </Link>
  )
}

function EconomySection({ economy: e, trend, periodLabel }: { economy: MunicipalAnalytics['economy']; trend: MunicipalAnalytics['trend']; periodLabel: string }) {
  const headline: { label: string; c: Compare; hint: string; invert?: boolean; emphasis?: boolean }[] = [
    { label: 'Tourism transaction value', c: e.gross_transaction_value, hint: 'Completed orders and bookings', emphasis: true },
    { label: 'Business-owner earnings', c: e.business_owner_earnings, hint: 'Settled to local businesses' },
    { label: 'Rider earnings', c: e.rider_earnings, hint: 'Delivery fees and tips' },
    { label: 'Refunds (provider-confirmed)', c: e.refunds, hint: 'Returned to customers', invert: true },
  ]
  const ledger: { label: string; value: string; c?: Compare }[] = [
    { label: 'COD collected', value: peso(e.cod_collections.value), c: e.cod_collections },
    { label: `GCash / PayMongo (${count(e.gateway.count ?? 0)})`, value: peso(e.gateway.value), c: e.gateway },
    { label: `Pending settlements (${count(e.pending_settlements.count)})`, value: peso(e.pending_settlements.amount) },
  ]

  return (
    <Panel title="Economy Overview" subtitle={`${periodLabel} · verified transactions and reconciled settlements only`} icon={TrendingUp} to="/municipal/reports" toLabel="Reports">
      <div className="grid grid-cols-2 gap-px border-b border-[#F1EDE3] bg-[#F1EDE3] lg:grid-cols-4">
        {headline.map((h) => (
          <div key={h.label} className="bg-white px-5 py-4">
            <p className="text-xs font-medium text-[#66736B]">{h.label}</p>
            <p className={cn('mt-1 truncate text-xl font-bold tabular-nums', h.emphasis ? 'text-[#1E6B40]' : 'text-[#1C2B22]')}>{peso(h.c.value)}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[#9AA39D]"><Delta c={h.c} invert={h.invert} /> {h.hint}</p>
          </div>
        ))}
      </div>

      <TransactionChart trend={trend} />

      <ul className="grid grid-cols-1 border-t border-[#F1EDE3] sm:grid-cols-3" aria-label="Payment and settlement records">
        {ledger.map((l) => (
          <li key={l.label} className="border-b border-[#F1EDE3] sm:border-b-0 sm:border-r">
            <Link to="/municipal/reports" className="block px-5 py-3 hover:bg-[#FAF7F0]">
              <span className="block text-xs text-[#66736B]">{l.label}</span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold tabular-nums text-[#1C2B22]">{l.value}</span>
                {l.c && <Delta c={l.c} />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', ...opts }).format(new Date(d.length === 7 ? `${d}-01T00:00:00Z` : `${d}T00:00:00Z`))

/**
 * Tourism transaction value per day (or month). One series in ₱ on one axis
 * — the title names it, so no legend; transactions are in the tooltip and
 * the table view.
 */
function TransactionChart({ trend }: { trend: MunicipalAnalytics['trend'] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [active, setActive] = useState<number | null>(null)
  const points = trend.points
  const monthly = trend.granularity === 'month'
  const label = (date: string, long = false) => dayLabel(date, monthly ? { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined } : { month: 'short', day: 'numeric' })
  const max = Math.max(1, ...points.map((p) => p.gross_value))
  const nice = (() => {
    const pow = 10 ** Math.floor(Math.log10(max))
    return Math.ceil(max / pow) * pow
  })()
  const ticks = [0, nice / 2, nice]
  const every = Math.max(1, Math.ceil(points.length / 8))
  const empty = points.every((p) => p.gross_value === 0)

  return (
    <div className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#1C2B22]">Tourism transaction value {monthly ? 'by month' : 'by day'}</p>
        <div className="flex rounded-lg border border-[#E7E2D6] p-0.5" role="group" aria-label="Chart or table">
          <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')} className={cn('rounded-md p-1', view === 'chart' ? 'bg-[#E6F2EB] text-[#1E6B40]' : 'text-[#66736B]')} aria-label="Show chart"><BarChart3 className="h-4 w-4" /></button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')} className={cn('rounded-md p-1', view === 'table' ? 'bg-[#E6F2EB] text-[#1E6B40]' : 'text-[#66736B]')} aria-label="Show table"><Table2 className="h-4 w-4" /></button>
        </div>
      </div>

      {view === 'table' || points.length === 0 ? (
        <div className="max-h-64 overflow-auto rounded-xl border border-[#F1EDE3]">
          <table className="w-full text-sm">
            <caption className="sr-only">Tourism transaction value and transactions per {monthly ? 'month' : 'day'}</caption>
            <thead className="sticky top-0 bg-[#FAF7F0] text-left text-[11px] font-semibold uppercase tracking-wider text-[#66736B]">
              <tr><th scope="col" className="px-3 py-2">{monthly ? 'Month' : 'Day'}</th><th scope="col" className="px-3 py-2 text-right">Transaction value</th><th scope="col" className="px-3 py-2 text-right">Transactions</th></tr>
            </thead>
            <tbody className="divide-y divide-[#F1EDE3]">
              {points.map((p) => (
                <tr key={p.date}><th scope="row" className="px-3 py-1.5 text-left font-normal">{label(p.date, true)}</th><td className="px-3 py-1.5 text-right tabular-nums">{peso(p.gross_value)}</td><td className="px-3 py-1.5 text-right tabular-nums">{p.transactions}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          {empty && <p className="absolute inset-x-0 top-14 z-10 text-center text-sm text-[#66736B]">No completed transactions in this period.</p>}
          <div className="flex h-56 gap-2">
            <div className="relative w-12 shrink-0 text-right text-[11px] tabular-nums text-[#9AA39D]" aria-hidden="true">
              {ticks.map((t) => <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${(t / nice) * 100}%` }}>{pesoShort(t)}</span>)}
            </div>
            <div className="relative flex-1">
              {ticks.map((t) => (
                <span key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-[#C9C2B2]' : 'border-dashed border-[#F1EDE3]')} style={{ bottom: `${(t / nice) * 100}%` }} aria-hidden="true" />
              ))}
              <div className="absolute inset-0 flex items-end" role="list" aria-label="Transaction value per period">
                {points.map((p, i) => {
                  const on = active === i
                  const h = (p.gross_value / nice) * 100
                  return (
                    <button
                      key={p.date}
                      type="button"
                      role="listitem"
                      aria-label={`${label(p.date, true)}: ${peso(p.gross_value)}, ${p.transactions} transactions`}
                      onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                      className={cn('relative flex h-full flex-1 items-end justify-center px-[2px] outline-none', on && 'bg-[#FAF7F0]')}
                    >
                      {p.gross_value > 0 && <span className="block w-full max-w-[18px] rounded-t-[4px] bg-[#257347]" style={{ height: `${Math.max(h, 1.5)}%` }} />}
                      {on && (
                        <span className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#0F2E1D] px-3 py-2 text-left text-xs text-white shadow-lg" style={{ bottom: `calc(${Math.min(h, 70)}% + 10px)` }}>
                          <span className="block font-semibold">{label(p.date, true)}</span>
                          <span className="block tabular-nums">{peso(p.gross_value)}</span>
                          <span className="block text-white/70 tabular-nums">{p.transactions} transactions</span>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="ml-14 mt-1.5 flex text-[10px] text-[#66736B]" aria-hidden="true">
            {points.map((p, i) => <span key={p.date} className="flex-1 truncate text-center">{i % every === 0 ? label(p.date) : ''}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}
