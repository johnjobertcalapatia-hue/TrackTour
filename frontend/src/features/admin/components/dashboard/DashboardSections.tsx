import { createContext, useContext, useState, type ReactNode } from 'react'
import { Link as RouterLink, type LinkProps } from 'react-router-dom'
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Bike, Car, CheckCircle2, ChevronRight, CircleDot, Database, Eye,
  Heart, Landmark, Lightbulb, MessageCircle, Minus, Package, Receipt, ShieldCheck, Sparkles, Star, Table2, Truck, Users, Wallet, Wifi,
  type LucideIcon,
} from 'lucide-react'
import { cn, formatDate, toAssetUrl } from '@/shared/utils'
import { CLASS_META, change, count, peso, pesoShort, type Analytics, type Compare, type PopularityClass, type TrendPoint } from './types'

export const card = 'rounded-2xl bg-white border border-[#E7E2D6]'

/**
 * Where the dashboard's links point. The sections are written with Bansud
 * admin paths; another portal (the municipal dashboard) supplies a mapper so
 * the same sections open its own pages. Default: unchanged admin paths.
 */
export const DashboardLinkContext = createContext<(to: string) => string>((to) => to)

function Link({ to, ...rest }: Omit<LinkProps, 'to'> & { to: string }) {
  const resolve = useContext(DashboardLinkContext)
  return <RouterLink to={resolve(to)} {...rest} />
}

// ---------------------------------------------------------------------------
// Building blocks

export function Delta({ c, invert = false, light = false }: { c: Pick<Compare, 'value' | 'previous'>; invert?: boolean; light?: boolean }) {
  const d = change(c)
  if (!d) return <span className={cn('text-xs', light ? 'text-white/60' : 'text-[#9AA39D]')}>— vs prev.</span>
  const good = d.direction === 'flat' ? null : (d.direction === 'up' || d.direction === 'new') !== invert
  const Icon = d.direction === 'down' ? ArrowDownRight : d.direction === 'flat' ? Minus : ArrowUpRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-semibold',
        light ? (good === false ? 'text-red-200' : 'text-[#FFE680]') : good === null ? 'text-[#66736B]' : good ? 'text-[#1E6B40]' : 'text-red-600'
      )}
      title="Compared with the previous equivalent period"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {d.text}
    </span>
  )
}

/** Tier-2 heading that introduces a dashboard zone (numbered, larger than panel titles). */
export function SectionHeading({ index, title, description, aside }: { index: string; title: string; description: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#0F2E1D] text-xs font-bold text-[#FFD700]" aria-hidden="true">{index}</span>
        <div>
          <h2 className="text-lg font-bold leading-tight text-[#1C2B22]">{title}</h2>
          <p className="text-sm text-[#66736B]">{description}</p>
        </div>
      </div>
      {aside}
    </div>
  )
}

/**
 * Panel. `size="compact"` is the tier-3 variant: smaller title, tighter
 * padding and a quieter border, for supporting detail.
 */
export function Panel({ title, icon: Icon, to, toLabel = 'View all', aside, subtitle, className = '', size = 'default', children }: {
  title: string; icon: LucideIcon; to?: string; toLabel?: string; aside?: ReactNode; subtitle?: string; className?: string; size?: 'default' | 'compact'; children: ReactNode
}) {
  const compact = size === 'compact'
  return (
    <section className={cn(card, 'overflow-hidden', compact ? 'border-[#EEE9DD]' : 'shadow-[0_1px_3px_rgba(15,46,29,0.06)]', className)} aria-label={title}>
      <div className={cn('flex flex-wrap items-center justify-between gap-3 border-b border-[#F1EDE3]', compact ? 'px-4 py-3' : 'px-5 py-4')}>
        <div className="min-w-0">
          <h3 className={cn('flex items-center gap-2 font-semibold text-[#1C2B22]', compact ? 'text-sm' : 'text-base')}>
            <Icon className={cn(compact ? 'h-4 w-4 text-[#66736B]' : 'h-[18px] w-[18px] text-[#2E8B57]')} aria-hidden="true" /> {title}
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-[#66736B]">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {aside}
          {to && (
            <Link to={to} className={cn('inline-flex items-center gap-0.5 font-medium text-[#2E8B57] hover:underline', compact ? 'text-xs' : 'text-sm')}>
              {toLabel} <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
      {children}
    </section>
  )
}

/** Tier-1 secondary tile: calm white card so only the hero carries weight. */
export function KpiCard({ label, value, delta, sub, icon: Icon, to, tone = 'green' }: {
  label: string; value: string; delta?: ReactNode; sub: ReactNode; icon: LucideIcon; to: string; tone?: 'green' | 'gold'
}) {
  const gold = tone === 'gold'
  return (
    <Link
      to={to}
      className={cn(card, 'group relative flex flex-col justify-between overflow-hidden p-4 transition hover:border-[#CFE5D7] hover:shadow-sm', gold && 'border-[#F5D78A] bg-[#FFFBEB]')}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-[#66736B]">{label}</span>
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', gold ? 'bg-[#FFF0B3] text-[#8A6A00]' : 'bg-[#E6F2EB] text-[#2E8B57]')}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </span>
      <span className="mt-2 flex flex-wrap items-baseline gap-x-2">
        <span className="truncate text-2xl font-bold tabular-nums text-[#1C2B22]">{value}</span>
        {delta}
      </span>
      <span className="mt-1 block truncate text-xs text-[#66736B]">{sub}</span>
    </Link>
  )
}

/** Tier 1: the one high-emphasis element — what the Tourism Office earned this period. */
export function HeroCard({ financial, periodLabel }: { financial: Analytics['financial']; periodLabel: string }) {
  const f = financial
  const facts = [
    { label: 'Net income', value: f.net_income.value },
    { label: 'Gross transactions', value: f.gross_transaction_value.value },
    { label: 'Earned today', value: f.earnings_today },
  ]
  return (
    <Link
      to="/admin/reports"
      aria-label={`Platform revenue ${peso(f.platform_revenue.value)}, ${periodLabel}`}
      className="relative flex h-full flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-[#0F2E1D] via-[#16472C] to-[#2E8B57] p-6 text-white shadow-[0_10px_30px_rgba(15,46,29,0.25)] transition hover:shadow-[0_14px_36px_rgba(15,46,29,0.32)]"
    >
      <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-[#FFD700]/10" aria-hidden="true" />
      <span>
        <span className="flex items-center gap-2 text-sm font-medium text-white/80">
          <Wallet className="h-4 w-4 text-[#FFD700]" aria-hidden="true" /> Platform revenue · {periodLabel}
        </span>
        <span className="mt-2 block truncate text-4xl font-bold tracking-tight tabular-nums lg:text-[44px]">{peso(f.platform_revenue.value)}</span>
        <span className="mt-1 flex items-center gap-2 text-sm text-white/75"><Delta c={f.platform_revenue} light /> vs previous period</span>
      </span>
      <span className="mt-6 grid grid-cols-3 gap-3 border-t border-white/15 pt-4">
        {facts.map((x) => (
          <span key={x.label} className="min-w-0">
            <span className="block text-[11px] uppercase tracking-wider text-white/60">{x.label}</span>
            <span className={cn('block truncate text-base font-semibold tabular-nums', x.value < 0 && 'text-red-200')}>{pesoShort(x.value)}</span>
          </span>
        ))}
      </span>
    </Link>
  )
}

/** Tier 1: what needs the Tourism Office today, directly under the headline figures. */
export function AttentionBar({ alerts }: { alerts: Analytics['alerts'] }) {
  const open = alerts.filter((a) => a.count > 0)
  const clear = alerts.length - open.length
  const total = open.reduce((n, a) => n + a.count, 0)
  return (
    <section
      className={cn('flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center', total ? 'border-[#F5D78A] bg-[#FFFBEB]' : 'border-[#CFE5D7] bg-[#F3FAF6]')}
      aria-label="Alerts & Approvals"
    >
      <span className="flex shrink-0 items-center gap-2 text-sm font-semibold text-[#1C2B22]">
        {total ? <AlertTriangle className="h-4 w-4 text-[#B07C00]" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 text-[#2E8B57]" aria-hidden="true" />}
        Needs attention today
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', total ? 'bg-[#FFE680] text-[#5C4A00]' : 'bg-[#E6F2EB] text-[#1E6B40]')}>{total ? `${count(total)} open` : 'All clear'}</span>
      </span>
      <ul className="flex flex-1 flex-wrap gap-2">
        {open.map((a) => (
          <li key={a.key}>
            <Link to={a.link} className="inline-flex items-center gap-2 rounded-full border border-[#F5D78A] bg-white px-3 py-1 text-sm text-[#1C2B22] hover:bg-[#FFF6CC]">
              {a.label}
              <span className="rounded-full bg-[#FFD700] px-1.5 text-xs font-bold tabular-nums text-[#5C4A00]">{count(a.count)}</span>
            </Link>
          </li>
        ))}
        {clear > 0 && <li className="self-center text-xs text-[#66736B]">{open.length ? `+ ${clear} other checks clear` : `${clear} checks clear`}</li>}
      </ul>
    </section>
  )
}

function StatusDot({ status }: { status: 'ok' | 'warning' | 'idle' | 'down' }) {
  const map = { ok: 'bg-[#2E8B57]', warning: 'bg-[#D99A00]', idle: 'bg-[#9A9282]', down: 'bg-red-500' }
  return <span className={cn('inline-block h-2 w-2 rounded-full', map[status])} aria-hidden="true" />
}

const dayLabel = (d: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', ...opts }).format(new Date(d.length === 7 ? `${d}-01T00:00:00Z` : `${d}T00:00:00Z`))

const timeAgo = (iso: string | null) => {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  return hours < 24 ? `${hours} h ago` : formatDate(iso)
}

// ---------------------------------------------------------------------------
// 1. Business popularity analytics

const CLASS_ORDER: PopularityClass[] = ['high', 'growing', 'average', 'low', 'declining']

export function PopularitySection({ data, className }: { data: Analytics['popularity']; className?: string }) {
  const total = CLASS_ORDER.reduce((n, k) => n + (data.summary[k] ?? 0), 0)
  const [tab, setTab] = useState<'top' | 'help'>('top')
  const rows = tab === 'top' ? data.top : data.needs_help

  return (
    <Panel
      title="Business Popularity Analytics"
      subtitle="Views, offerings, favorites, inquiries, bookings, transactions and reviews — not bookings alone"
      icon={BarChart3}
      to="/admin/businesses"
      className={className}
    >
      <div className="px-5 pt-4">
        {/* Classification summary — label + count on every class (never color alone) */}
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Popularity classes">
          {CLASS_ORDER.map((k) => (
            <li key={k} className="rounded-xl border border-[#F1EDE3] px-3 py-2">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#66736B]">
                <span className={cn('h-2 w-2 rounded-full', CLASS_META[k].dot)} aria-hidden="true" /> {CLASS_META[k].label}
              </span>
              <span className="text-xl font-bold tabular-nums text-[#1C2B22]">{count(data.summary[k] ?? 0)}</span>
            </li>
          ))}
        </ul>
        {total > 0 && (
          <div className="mt-3 flex h-2 gap-[2px] overflow-hidden rounded-full" aria-hidden="true">
            {CLASS_ORDER.filter((k) => data.summary[k]).map((k) => (
              <span key={k} className={cn('h-full', CLASS_META[k].dot)} style={{ width: `${(data.summary[k] / total) * 100}%` }} />
            ))}
          </div>
        )}
        <div className="mt-4 flex gap-1 rounded-xl bg-[#FAF7F0] p-1 text-sm" role="tablist" aria-label="Business list">
          {([['top', 'Most popular'], ['help', 'Needs promotional support']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cn('flex-1 rounded-lg px-3 py-1.5 font-medium', tab === k ? 'bg-white text-[#1C2B22] shadow-sm' : 'text-[#66736B] hover:text-[#1C2B22]')}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[#66736B]">
          {tab === 'top' ? 'No business engagement recorded in this period yet.' : 'No businesses need promotional support right now.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-[720px] text-sm">
            <thead className="text-left text-[11px] font-semibold uppercase tracking-wider text-[#66736B]">
              <tr>
                <th scope="col" className="px-5 py-2">Business</th>
                <th scope="col" className="px-2 py-2 text-right" title="Profile views"><Eye className="ml-auto h-3.5 w-3.5" aria-label="Profile views" /></th>
                <th scope="col" className="px-2 py-2 text-right" title="Favorites"><Heart className="ml-auto h-3.5 w-3.5" aria-label="Favorites" /></th>
                <th scope="col" className="px-2 py-2 text-right" title="Inquiries"><MessageCircle className="ml-auto h-3.5 w-3.5" aria-label="Inquiries" /></th>
                <th scope="col" className="px-2 py-2 text-right">Bookings</th>
                <th scope="col" className="px-2 py-2 text-right">Sales</th>
                <th scope="col" className="px-2 py-2 text-right">Rating</th>
                <th scope="col" className="px-2 py-2 text-right">Trend</th>
                <th scope="col" className="px-5 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1EDE3]">
              {rows.map((r, i) => (
                <tr key={r.id} className="hover:bg-[#FAF7F0]">
                  <td className="px-5 py-2.5">
                    <Link to={`/admin/businesses/${r.id}`} className="flex items-center gap-2.5">
                      <span className="w-4 text-xs font-bold text-[#9AA39D]" aria-hidden="true">{i + 1}</span>
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#E6F2EB] text-xs font-bold text-[#2E8B57]" aria-hidden="true">
                        {r.logo ? <img src={toAssetUrl(r.logo)} alt="" className="h-full w-full object-cover" /> : r.name.charAt(0)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-[#1C2B22] hover:text-[#2E8B57]">{r.name}</span>
                        <span className="block truncate text-xs text-[#66736B]">{[r.category, r.municipality].filter(Boolean).join(' · ')}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{count(r.metrics.views + r.metrics.offering_views)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{count(r.metrics.favorites)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{count(r.metrics.inquiries)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{count(r.metrics.bookings)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{count(r.metrics.transactions)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {r.rating !== null ? <span className="inline-flex items-center gap-0.5"><Star className="h-3 w-3 fill-[#D99A00] text-[#D99A00]" aria-hidden="true" />{r.rating}</span> : '—'}
                  </td>
                  <td className="px-2 py-2.5 text-right"><Delta c={{ value: r.score, previous: r.previous_score }} /></td>
                  <td className="px-5 py-2.5">
                    <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', CLASS_META[r.class].tone)}>{CLASS_META[r.class].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// 2. Tourism growth opportunities

const OPPORTUNITY_ICON: Record<string, LucideIcon> = {
  declining: AlertTriangle, low_conversion: Receipt, low_views: Eye, top_rated: Star, stale: Sparkles, event: Landmark,
}

export function OpportunitiesSection({ items, className }: { items: Analytics['opportunities']; className?: string }) {
  return (
    <Panel title="Tourism Growth Opportunities" subtitle="Suggested actions from this period's engagement" icon={Lightbulb} className={className}>
      {items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[#66736B]">No recommendations for this period. Engagement looks healthy.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((o, i) => {
            const Icon = OPPORTUNITY_ICON[o.kind] ?? Lightbulb
            const warn = o.kind === 'declining' || o.kind === 'low_conversion'
            const body = (
              <>
                <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', warn ? 'bg-[#FFF6CC] text-[#8A6A00]' : 'bg-[#E6F2EB] text-[#2E8B57]')}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[#1C2B22]">{o.title}</span>
                  <span className="mt-0.5 block text-xs text-[#66736B]">{o.action}</span>
                </span>
              </>
            )
            return (
              <li key={i}>
                {o.link ? (
                  <Link to={o.link} className="flex h-full items-start gap-3 rounded-xl bg-[#FAF7F0] px-3 py-3 transition hover:bg-[#F3EEE2]">{body}</Link>
                ) : (
                  <div className="flex h-full items-start gap-3 rounded-xl bg-[#FAF7F0] px-3 py-3">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// 3. Financial overview

export function FinancialSection({ data, trend, periodLabel, onRecordExpense, className }: {
  data: Analytics['financial']; trend: Analytics['trend']; periodLabel: string; onRecordExpense: () => void; className?: string
}) {
  const headline: { label: string; c: Compare; hint: string; invert?: boolean; emphasis?: boolean }[] = [
    { label: 'Gross transaction value', c: data.gross_transaction_value, hint: 'Completed orders and bookings (customer money)' },
    { label: 'Platform revenue', c: data.platform_revenue, hint: 'Tourism Office share from settled orders', emphasis: true },
    { label: 'Operating expenses', c: data.operating_expenses, hint: 'Recorded by the Tourism Office', invert: true },
    { label: 'Net income', c: data.net_income, hint: 'Platform revenue − operating expenses', emphasis: true },
  ]
  const ledger: { label: string; value: string; c?: Compare; to: string; invert?: boolean }[] = [
    { label: 'Business-owner earnings', value: peso(data.business_owner_earnings.value), c: data.business_owner_earnings, to: '/admin/reports' },
    { label: 'Rider earnings', value: peso(data.rider_earnings.value), c: data.rider_earnings, to: '/admin/riders' },
    { label: 'Refunds (provider-confirmed)', value: peso(data.refunds.value), c: data.refunds, to: '/admin/reports', invert: true },
    { label: 'COD collected', value: peso(data.cod_collections.value), c: data.cod_collections, to: '/admin/rider-cash' },
    { label: 'COD remitted (verified)', value: peso(data.cod_remitted.value), c: data.cod_remitted, to: '/admin/rider-cash' },
    { label: 'Rider cash advances', value: peso(data.rider_cash_advances.value), c: data.rider_cash_advances, to: '/admin/rider-cash' },
    { label: `GCash / PayMongo (${count(data.gateway.count ?? 0)})`, value: peso(data.gateway.value), c: data.gateway, to: '/admin/reports' },
    { label: `Pending settlements (${count(data.pending_settlements.count)})`, value: peso(data.pending_settlements.amount), to: '/admin/reports' },
  ]
  const cashouts: { label: string; value: number; c?: Compare }[] = [
    { label: 'Cashouts requested', value: data.cashouts.requested.value, c: data.cashouts.requested },
    { label: 'Cashouts approved', value: data.cashouts.approved.value, c: data.cashouts.approved },
    { label: 'Cashouts completed', value: data.cashouts.completed.value, c: data.cashouts.completed },
    { label: 'Open liability', value: data.cashouts.liability },
  ]

  return (
    <Panel
      title="Financial Overview"
      subtitle={`${periodLabel} · verified transactions and reconciled settlements only`}
      icon={Wallet}
      className={className}
      aside={
        <button type="button" onClick={onRecordExpense} className="rounded-lg border border-[#E7E2D6] px-3 py-1.5 text-sm font-medium text-[#1C2B22] hover:bg-[#FAF7F0]">
          + Record expense
        </button>
      }
    >
      <div className="grid grid-cols-2 gap-px border-b border-[#F1EDE3] bg-[#F1EDE3] lg:grid-cols-4">
        {headline.map((h) => (
          <div key={h.label} className="bg-white px-5 py-4">
            <p className="text-xs font-medium text-[#66736B]">{h.label}</p>
            <p className={cn('mt-1 truncate text-xl font-bold tabular-nums', h.emphasis ? 'text-[#1E6B40]' : 'text-[#1C2B22]', h.c.value < 0 && 'text-red-600')}>{peso(h.c.value)}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[#9AA39D]"><Delta c={h.c} invert={h.invert} /> {h.hint}</p>
          </div>
        ))}
      </div>

      <FinanceChart trend={trend} />

      <div className="grid grid-cols-2 gap-px border-t border-[#F1EDE3] bg-[#F1EDE3] sm:grid-cols-3 lg:grid-cols-6" aria-label="Earnings and cashouts">
        <div className="bg-[#FAF7F0] px-5 py-3">
          <p className="text-xs text-[#66736B]">Earned today</p>
          <p className="font-bold tabular-nums text-[#1C2B22]">{peso(data.earnings_today)}</p>
        </div>
        <div className="bg-[#FAF7F0] px-5 py-3">
          <p className="text-xs text-[#66736B]">Earned this month</p>
          <p className="font-bold tabular-nums text-[#1C2B22]">{peso(data.earnings_this_month)}</p>
        </div>
        {cashouts.map((c) => (
          <Link key={c.label} to="/admin/cashouts" className="bg-white px-5 py-3 hover:bg-[#FAF7F0]">
            <span className="block text-xs text-[#66736B]">{c.label}</span>
            <span className="block font-semibold tabular-nums text-[#1C2B22]">{peso(c.value)}</span>
          </Link>
        ))}
      </div>

      <ul className="grid grid-cols-1 border-t border-[#F1EDE3] sm:grid-cols-2 lg:grid-cols-4" aria-label="Financial categories">
        {ledger.map((l) => (
          <li key={l.label} className="border-b border-[#F1EDE3] sm:border-r">
            <Link to={l.to} className="block px-5 py-3 hover:bg-[#FAF7F0]">
              <span className="block text-xs text-[#66736B]">{l.label}</span>
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate font-semibold tabular-nums text-[#1C2B22]">{l.value}</span>
                {l.c && <Delta c={l.c} invert={l.invert} />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * Platform revenue vs operating expenses — two series in the same unit (₱),
 * one axis. Palette validated (#257347 / #D99A00: all checks pass; the gold's
 * surface-contrast WARN is relieved by the legend, tooltip and a visible
 * table view). Gross value and transactions live in the tooltip.
 */
const SERIES = [
  { key: 'platform_revenue', label: 'Platform revenue', color: '#257347' },
  { key: 'expenses', label: 'Operating expenses', color: '#D99A00' },
] as const

function FinanceChart({ trend }: { trend: Analytics['trend'] }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [active, setActive] = useState<number | null>(null)
  const points = trend.points
  const monthly = trend.granularity === 'month'
  const label = (p: TrendPoint, long = false) => dayLabel(p.date, monthly ? { month: long ? 'long' : 'short', year: long ? 'numeric' : undefined } : { month: 'short', day: 'numeric' })
  const max = Math.max(1, ...points.flatMap((p) => [p.platform_revenue, p.expenses]))
  const nice = (() => {
    const pow = 10 ** Math.floor(Math.log10(max))
    return Math.ceil(max / pow) * pow
  })()
  const ticks = [0, nice / 2, nice]
  const every = Math.max(1, Math.ceil(points.length / 8))
  const empty = points.every((p) => p.platform_revenue === 0 && p.expenses === 0)

  return (
    <div className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#1C2B22]">Daily transactions{monthly ? ' (by month)' : ''}</p>
        <div className="flex items-center gap-4">
          <ul className="flex gap-3 text-xs text-[#66736B]" aria-label="Legend">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden="true" />{s.label}</li>
            ))}
          </ul>
          <div className="flex rounded-lg border border-[#E7E2D6] p-0.5" role="group" aria-label="Chart or table">
            <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')} className={cn('rounded-md p-1', view === 'chart' ? 'bg-[#E6F2EB] text-[#1E6B40]' : 'text-[#66736B]')} aria-label="Show chart"><BarChart3 className="h-4 w-4" /></button>
            <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')} className={cn('rounded-md p-1', view === 'table' ? 'bg-[#E6F2EB] text-[#1E6B40]' : 'text-[#66736B]')} aria-label="Show table"><Table2 className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      {view === 'table' || points.length === 0 ? (
        <div className="max-h-64 overflow-auto rounded-xl border border-[#F1EDE3]">
          <table className="w-full text-sm">
            <caption className="sr-only">Platform revenue, operating expenses, gross value and transactions per {monthly ? 'month' : 'day'}</caption>
            <thead className="sticky top-0 bg-[#FAF7F0] text-left text-[11px] font-semibold uppercase tracking-wider text-[#66736B]">
              <tr><th scope="col" className="px-3 py-2">{monthly ? 'Month' : 'Day'}</th><th scope="col" className="px-3 py-2 text-right">Revenue</th><th scope="col" className="px-3 py-2 text-right">Expenses</th><th scope="col" className="px-3 py-2 text-right">Gross value</th><th scope="col" className="px-3 py-2 text-right">Transactions</th></tr>
            </thead>
            <tbody className="divide-y divide-[#F1EDE3]">
              {points.map((p) => (
                <tr key={p.date}><th scope="row" className="px-3 py-1.5 text-left font-normal">{label(p, true)}</th><td className="px-3 py-1.5 text-right tabular-nums">{peso(p.platform_revenue)}</td><td className="px-3 py-1.5 text-right tabular-nums">{peso(p.expenses)}</td><td className="px-3 py-1.5 text-right tabular-nums">{peso(p.gross_value)}</td><td className="px-3 py-1.5 text-right tabular-nums">{p.transactions}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          {empty && <p className="absolute inset-x-0 top-14 z-10 text-center text-sm text-[#66736B]">No revenue or expenses in this period.</p>}
          <div className="flex h-56 gap-2">
            <div className="relative w-12 shrink-0 text-right text-[11px] tabular-nums text-[#9AA39D]" aria-hidden="true">
              {ticks.map((t) => <span key={t} className="absolute right-0 translate-y-1/2" style={{ bottom: `${(t / nice) * 100}%` }}>{pesoShort(t)}</span>)}
            </div>
            <div className="relative flex-1">
              {ticks.map((t) => (
                <span key={t} className={cn('absolute inset-x-0 border-t', t === 0 ? 'border-[#C9C2B2]' : 'border-dashed border-[#F1EDE3]')} style={{ bottom: `${(t / nice) * 100}%` }} aria-hidden="true" />
              ))}
              <div className="absolute inset-0 flex items-end" role="list" aria-label="Revenue and expenses per period">
                {points.map((p, i) => {
                  const on = active === i
                  const top = Math.max(p.platform_revenue, p.expenses) / nice * 100
                  return (
                    <button
                      key={p.date}
                      type="button"
                      role="listitem"
                      aria-label={`${label(p, true)}: revenue ${peso(p.platform_revenue)}, expenses ${peso(p.expenses)}, gross value ${peso(p.gross_value)}, ${p.transactions} transactions`}
                      onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                      className={cn('relative flex h-full flex-1 items-end justify-center gap-[2px] px-[1px] outline-none', on && 'bg-[#FAF7F0]')}
                    >
                      {SERIES.map((s) => {
                        const v = p[s.key]
                        return v > 0 ? <span key={s.key} className="block w-full max-w-[14px] rounded-t-[4px]" style={{ height: `${Math.max((v / nice) * 100, 1.5)}%`, background: s.color }} /> : <span key={s.key} className="block w-full max-w-[14px]" />
                      })}
                      {on && (
                        <span className="pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#0F2E1D] px-3 py-2 text-left text-xs text-white shadow-lg" style={{ bottom: `calc(${Math.min(top, 70)}% + 10px)` }}>
                          <span className="block font-semibold">{label(p, true)}</span>
                          {SERIES.map((s) => (
                            <span key={s.key} className="flex items-center gap-1.5 tabular-nums"><span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}: {peso(p[s.key])}</span>
                          ))}
                          <span className="mt-0.5 block text-white/70 tabular-nums">Gross {peso(p.gross_value)} · {p.transactions} transactions</span>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="ml-14 mt-1.5 flex text-[10px] text-[#66736B]" aria-hidden="true">
            {points.map((p, i) => <span key={p.date} className="flex-1 truncate text-center">{i % every === 0 ? label(p) : ''}</span>)}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 4. Daily operations + live activity

export function OperationsSection({ ops, live, periodLabel, className }: { ops: Analytics['operations']; live: Analytics['live']; periodLabel: string; className?: string }) {
  const tiles: { label: string; c: Compare; icon: LucideIcon; to: string }[] = [
    { label: 'Food orders', c: ops.food_orders, icon: Package, to: '/admin/live/deliveries' },
    { label: 'Deliveries completed', c: ops.deliveries, icon: Truck, to: '/admin/live/deliveries' },
    { label: 'Ride-hailing bookings', c: ops.ride_hailing, icon: Car, to: '/admin/live/map' },
    { label: 'Accommodation bookings', c: ops.accommodation, icon: Landmark, to: '/admin/businesses' },
  ]
  const liveRows: { label: string; value: number; to: string; icon: LucideIcon }[] = [
    { label: 'Users online now', value: live.users_online, to: '/admin/users', icon: Wifi },
    { label: 'Tourists online', value: live.tourists_online, to: '/admin/users/tourists', icon: Users },
    { label: 'Riders available', value: live.riders_available, to: '/admin/live/map', icon: Bike },
    { label: 'Riders on a delivery', value: live.riders_on_delivery, to: '/admin/live/deliveries', icon: Truck },
    { label: 'Drivers on a ride', value: live.drivers_on_rides, to: '/admin/live/map', icon: Car },
    { label: 'Active food orders', value: live.active_food_orders, to: '/admin/live/deliveries', icon: Package },
    { label: 'Ongoing ride-hailing trips', value: live.ongoing_rides, to: '/admin/live/map', icon: Car },
    { label: 'Deliveries waiting for a rider', value: live.pending_deliveries, to: '/admin/live/deliveries', icon: CircleDot },
    { label: 'Cancelled today', value: live.cancelled_today, to: '/admin/live/deliveries', icon: AlertTriangle },
  ]

  return (
    <div className={cn('space-y-4', className)}>
      <Panel title="Daily Operations" subtitle={`${periodLabel} vs previous period`} icon={Activity} size="compact">
        <div className="grid grid-cols-2 gap-px bg-[#F1EDE3] sm:grid-cols-4">
          {tiles.map((t) => (
            <Link key={t.label} to={t.to} className="bg-white px-4 py-3 transition hover:bg-[#FAF7F0]">
              <span className="flex items-center gap-1.5 text-xs text-[#66736B]"><t.icon className="h-3.5 w-3.5 text-[#2E8B57]" aria-hidden="true" /> {t.label}</span>
              <span className="mt-1 block text-xl font-bold tabular-nums text-[#1C2B22]">{count(t.c.value)}</span>
              <span className="block"><Delta c={t.c} /></span>
            </Link>
          ))}
        </div>
        <p className="border-t border-[#F1EDE3] px-4 py-2 text-xs text-[#66736B]">Cancelled transactions this period: <b className="text-[#1C2B22]">{count(ops.cancelled)}</b></p>
      </Panel>

      <Panel title="Live Platform Activity" subtitle="Real-time · refreshes every minute" icon={Wifi} to="/admin/live/map" toLabel="Live map" size="compact">
        <ul className="grid grid-cols-2 gap-px bg-[#F1EDE3] sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
          {liveRows.map((r) => (
            <li key={r.label} className="bg-white">
              <Link to={r.to} className="block h-full px-4 py-3 hover:bg-[#FAF7F0]">
                <span className="flex items-start gap-1.5 text-xs leading-tight text-[#66736B]"><r.icon className="h-3.5 w-3.5 shrink-0 text-[#2E8B57]" aria-hidden="true" /> {r.label}</span>
                <span className="mt-1 block text-xl font-bold tabular-nums text-[#1C2B22]">{count(r.value)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 5. Municipality statistics, alerts, activity, system

export function MunicipalitySection({ rows, className }: { rows: Analytics['municipalities']; className?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.share))
  return (
    <Panel title="Municipality Statistics" subtitle="Share of completed transaction value this period" icon={Landmark} to="/admin/municipalities" size="compact" className={className}>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[#66736B]">No municipalities yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-px bg-[#F1EDE3] sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
          {rows.map((m) => (
            <li key={m.id} className="bg-white">
              <Link to={`/admin/municipalities/${m.id}`} className="block h-full px-4 py-3 hover:bg-[#FAF7F0]">
                <span className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-[#1C2B22]">
                    {m.name}
                    {m.is_home && <span className="rounded-full bg-[#FFF6CC] px-2 py-0.5 text-[10px] font-semibold text-[#5C4A00]">Home</span>}
                    {!m.has_office && <span className="rounded-full bg-[#F1EDE3] px-2 py-0.5 text-[10px] text-[#66736B]">No office account</span>}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums text-[#1C2B22]">{m.share}%</span>
                </span>
                <span className="mt-1 block h-2 overflow-hidden rounded-full bg-[#F1EDE3]" aria-hidden="true">
                  <span className="block h-full rounded-full bg-[#2E8B57]" style={{ width: `${(m.share / max) * 100}%` }} />
                </span>
                <span className="mt-0.5 block text-[11px] text-[#66736B]">
                  {count(m.businesses)} businesses · {count(m.riders)} riders · {count(m.transactions)} transactions · {pesoShort(m.value)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function ActivitySection({ items, className }: { items: Analytics['activity']; className?: string }) {
  return (
    <Panel title="Recent Activities" icon={Activity} to="/admin/audit-logs" size="compact" className={className}>
      {items.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-[#66736B]">No activity recorded yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-px bg-[#F1EDE3] sm:grid-cols-2 lg:grid-cols-3">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 bg-white px-4 py-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#2E8B57]" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm text-[#1C2B22]">{a.description}</span>
                {a.by && <span className="block text-xs text-[#66736B]">{a.by}</span>}
              </span>
              <span className="shrink-0 text-xs text-[#9AA39D]">{timeAgo(a.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

const SYSTEM_ICON: Record<string, LucideIcon> = { database: Database, payments: Wallet, tracking: Wifi, jobs: ShieldCheck }

export function SystemSection({ items, className }: { items: Analytics['system']; className?: string }) {
  const allOk = items.every((s) => s.status === 'ok')
  return (
    <Panel
      title="System Health"
      icon={ShieldCheck}
      to="/admin/settings/diagnostics"
      toLabel="Diagnostics"
      size="compact"
      className={className}
      aside={<span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', allOk ? 'bg-[#E6F2EB] text-[#1E6B40]' : 'bg-[#FFF6CC] text-[#5C4A00]')}>{allOk ? 'All systems online' : 'Check items'}</span>}
    >
      <ul className="grid grid-cols-2 gap-2 p-3 lg:grid-cols-4">
        {items.map((s) => {
          const Icon = SYSTEM_ICON[s.key] ?? ShieldCheck
          const label = { ok: 'Healthy', warning: 'Attention', idle: 'Idle', down: 'Down' }[s.status]
          return (
            <li key={s.key} className="rounded-xl bg-[#FAF7F0] p-2.5 text-center">
              <Icon className="mx-auto h-5 w-5 text-[#66736B]" aria-hidden="true" />
              <p className="mt-1.5 text-sm font-medium text-[#1C2B22]">{s.label}</p>
              <p className="flex items-center justify-center gap-1.5 text-xs font-semibold text-[#1C2B22]"><StatusDot status={s.status} /> {label}</p>
              <p className="mt-0.5 truncate text-[11px] text-[#66736B]" title={s.detail}>{s.detail}</p>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
