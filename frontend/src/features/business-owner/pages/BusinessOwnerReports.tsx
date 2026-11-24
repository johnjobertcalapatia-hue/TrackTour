import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, Bell, CalendarDays, ChevronDown, ClipboardList, Crown, Download,
  History, MessageSquare, PieChart as PieIcon, ShoppingBag, Star, TrendingUp, UtensilsCrossed, Wrench,
} from 'lucide-react'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, toAssetUrl } from '@/shared/utils'
import type { Business } from '@/shared/types'
import { useBusinessPortal } from '../services/business-portal'

// ── Types (GET reports/overview) ─────────────────────────────────────────

interface Kpi { value: number; previous: number; change: number | null }
interface SeriesPoint {
  date: string
  label_to: string | null
  orders: number
  revenue: number
  earnings: number
  previous_orders: number
  previous_revenue: number
  previous_earnings: number
}
interface Overview {
  range: { from: string; to: string; days: number; previous_from: string; previous_to: string }
  kpis: {
    orders: Kpi
    revenue: Kpi
    earnings: Kpi & { expenses: number }
    rating: { value: number | null; count: number; new_in_range: number }
  }
  series: SeriesPoint[]
  breakdown: { label: string; from: string; to: string; revenue: number; previous_revenue: number }[]
  top_items: { offering_id: number | null; name: string; quantity: number; orders: number; revenue: number; image: string | null }[]
  orders_by_status: { total: number; groups: { key: StatusKey; count: number }[] }
  bookings: { total: number; revenue: number; by_status: { status: string; count: number; revenue: number }[] }
}
type StatusKey = 'completed' | 'in_progress' | 'pending' | 'cancelled'
type Metric = 'orders' | 'revenue' | 'earnings'
type Preset = 'last_7' | 'last_30' | 'this_month' | 'last_month' | 'last_90' | 'this_year' | 'custom'

interface RecentNotification { id: number; category: string; title: string; created_at: string }

// ── Constants ────────────────────────────────────────────────────────────

const PRESETS: { key: Preset; label: string }[] = [
  { key: 'last_7', label: 'Last 7 Days' },
  { key: 'last_30', label: 'Last 30 Days' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'last_90', label: 'Last 90 Days' },
  { key: 'this_year', label: 'This Year' },
  { key: 'custom', label: 'Custom range' },
]

/** Orders by status: validated categorical palette (fixed order, labelled in the legend). */
const STATUS_META: Record<StatusKey, { label: string; color: string }> = {
  completed: { label: 'Completed', color: '#1B7F3B' },
  in_progress: { label: 'In progress', color: '#C28A00' },
  pending: { label: 'Pending', color: '#2F6FDB' },
  cancelled: { label: 'Cancelled', color: '#C8467A' },
}
const STATUS_ORDER: StatusKey[] = ['completed', 'in_progress', 'pending', 'cancelled']

const CURRENT = '#1B7F3B'
const PREVIOUS = '#9BCFAA'

// min-w-0 + overflow-hidden: a grid card must be able to shrink below its chart's drawn width,
// otherwise the chart keeps its old pixel width and spills into the next card.
const card = 'min-w-0 overflow-hidden rounded-[20px] border border-[#E7ECE8] bg-[#fff] shadow-[0_6px_18px_rgba(22,101,52,0.06)]'
const field = 'h-10 w-full rounded-xl border border-[#E2E8E3] bg-white px-3 text-sm text-[#17201A] focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25'

// ── Helpers ──────────────────────────────────────────────────────────────

/** Today in Manila (the platform's clock), as YYYY-MM-DD. */
function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d) }

function presetRange(preset: Preset, today: string): { from: string; to: string } | null {
  const [y, m] = today.split('-').map(Number) as [number, number]
  switch (preset) {
    case 'last_7': return { from: addDays(today, -6), to: today }
    case 'last_30': return { from: addDays(today, -29), to: today }
    case 'last_90': return { from: addDays(today, -89), to: today }
    case 'this_month': return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'last_month': {
      const first = ymd(new Date(Date.UTC(y, m - 2, 1)))
      return { from: first, to: ymd(new Date(Date.UTC(y, m - 1, 0))) }
    }
    case 'this_year': return { from: `${y}-01-01`, to: today }
    default: return null
  }
}

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const compactPeso = new Intl.NumberFormat('en-PH', { notation: 'compact', maximumFractionDigits: 1 })
const peso = (v: number) => formatCurrency(v)
const money = (metric: Metric) => metric !== 'orders'

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`
  const d = Math.floor(s / 86400)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function buildExportUrl(type: string, format: string, query: URLSearchParams): string {
  const q = new URLSearchParams(query)
  q.set('type', type)
  return `/api/business-owner/exports/${format}?${q.toString()}`
}

// ── Pieces ───────────────────────────────────────────────────────────────

/**
 * Fixed-height box for a chart. The chart is absolutely positioned, so its
 * drawn width never props the card open; it always takes the card's current
 * width (charts in a grid otherwise keep an old, wider size and overlap).
 */
function ChartBox({ height, className = '', children }: { height: number | string; className?: string; children: ReactNode }) {
  return (
    <div className={`relative w-full min-w-0 ${className}`} style={{ height }}>
      <div className="absolute inset-0">{children}</div>
    </div>
  )
}

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-[#8A968E]">No earlier data</span>
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-[#15803D]' : 'text-[#B42318]'}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {up ? '+' : ''}{value}%<span className="sr-only"> compared with the previous period</span>
    </span>
  )
}

/** Tiny trend line; hidden when there is nothing to show (all equal). */
function Sparkline({ data, color, id }: { data: number[]; color: string; id: string }) {
  if (data.length < 2 || data.every((v) => v === data[0])) return null
  const rows = data.map((v, i) => ({ i, v }))
  return (
    <ChartBox height={40} className="pointer-events-none">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#spark-${id})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </ChartBox>
  )
}

function KpiTile({ icon, iconBg, label, value, extra, spark }: {
  icon: ReactNode
  iconBg: string
  label: string
  value: ReactNode
  extra: ReactNode
  spark?: ReactNode
}) {
  return (
    <div className={`${card} flex flex-col p-5 xl:p-4 2xl:p-5`}>
      <div className="flex items-start gap-4 xl:gap-3 2xl:gap-4">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white [&>svg]:h-6 [&>svg]:w-6 xl:h-10 xl:w-10 xl:[&>svg]:h-5 xl:[&>svg]:w-5 2xl:h-12 2xl:w-12 2xl:[&>svg]:h-6 2xl:[&>svg]:w-6 ${iconBg}`} aria-hidden="true">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[#3F4A44]">{label}</p>
          <p className="mt-0.5 text-2xl font-extrabold leading-tight tabular-nums text-[#17201A] [overflow-wrap:anywhere] xl:text-xl 2xl:text-2xl">{value}</p>
          <div className="mt-0.5">{extra}</div>
        </div>
      </div>
      {spark && <div className="mt-2">{spark}</div>}
    </div>
  )
}

function CardHeader({ id, icon, title, action }: { id: string; icon: ReactNode; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="flex items-center gap-2.5 text-lg font-bold text-[#17201A]">
        <span className="text-[#16803C] [&>svg]:h-5 [&>svg]:w-5" aria-hidden="true">{icon}</span>{title}
      </h2>
      {action}
    </div>
  )
}

function LegendDot({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[#3F4A44]">
      {dashed
        ? <span className="inline-block h-0 w-4 border-t-2 border-dashed" style={{ borderColor: color }} aria-hidden="true" />
        : <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} aria-hidden="true" />}
      {label}
    </span>
  )
}

function TrendTooltip({ active, payload, metric }: { active?: boolean; payload?: { payload: SeriesPoint }[]; metric: Metric }) {
  const p = active ? payload?.[0]?.payload : undefined
  if (!p) return null
  const fmt = (v: number) => (money(metric) ? peso(v) : String(v))
  return (
    <div className="rounded-xl border border-[#E2E8E3] bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[#17201A]">{shortDate(p.date)}{p.label_to ? ` – ${shortDate(p.label_to)}` : ''}</p>
      <p className="mt-1 flex justify-between gap-4 text-[#3F4A44]"><span>This period</span><span className="font-semibold tabular-nums text-[#17201A]">{fmt(p[metric])}</span></p>
      <p className="flex justify-between gap-4 text-[#3F4A44]"><span>Previous period</span><span className="font-semibold tabular-nums text-[#17201A]">{fmt(p[`previous_${metric}` as keyof SeriesPoint] as number)}</span></p>
    </div>
  )
}

function SalesOverview({ series }: { series: SeriesPoint[] }) {
  const [metric, setMetric] = useState<Metric>('orders')
  const empty = series.every((p) => p[metric] === 0 && (p[`previous_${metric}` as keyof SeriesPoint] as number) === 0)
  return (
    <section aria-labelledby="sales-overview-title" className={`${card} p-5 lg:p-6`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 id="sales-overview-title" className="flex items-center gap-2.5 text-lg font-bold text-[#17201A]">
          <TrendingUp className="h-5 w-5 text-[#16803C]" aria-hidden="true" />Sales Overview
        </h2>
        <div role="group" aria-label="Chart measure" className="inline-flex rounded-full border border-[#E2E8E3] bg-[#F7F9F7] p-1">
          {(['orders', 'revenue', 'earnings'] as Metric[]).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition ${metric === m ? 'bg-[#0F4D2B] text-white' : 'text-[#3F4A44] hover:text-[#16803C]'}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2 flex justify-end gap-4">
        <LegendDot color={CURRENT} label="This Period" />
        <LegendDot color={PREVIOUS} label="Previous Period" dashed />
      </div>
      {empty ? (
        <p className="py-20 text-center text-sm text-[#647067]">No {metric} in this period or the one before.</p>
      ) : (
        <ChartBox height={280}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CURRENT} stopOpacity={0.18} />
                <stop offset="100%" stopColor={CURRENT} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#EEF2EF" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fill: '#647067', fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis
              allowDecimals={false}
              tickFormatter={(v: number) => (money(metric) ? `₱${compactPeso.format(v)}` : String(v))}
              tick={{ fill: '#647067', fontSize: 12 }} tickLine={false} axisLine={false} width={money(metric) ? 56 : 36}
            />
            <Tooltip content={<TrendTooltip metric={metric} />} cursor={{ stroke: '#CFE3D5' }} />
            <Line type="monotone" dataKey={`previous_${metric}`} stroke={PREVIOUS} strokeWidth={2} strokeDasharray="5 5" dot={series.length <= 31 ? { r: 3, fill: PREVIOUS, stroke: '#fff', strokeWidth: 2 } : false} activeDot={{ r: 5 }} isAnimationActive={false} />
            <Area type="monotone" dataKey={metric} stroke={CURRENT} strokeWidth={2.5} fill="url(#trend-fill)" dot={series.length <= 31 ? { r: 4, fill: CURRENT, stroke: '#fff', strokeWidth: 2 } : false} activeDot={{ r: 6 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
        </ChartBox>
      )}
    </section>
  )
}

function TopSelling({ items }: { items: Overview['top_items'] }) {
  const max = Math.max(1, ...items.map((i) => i.quantity))
  const rankStyle = ['bg-[#F5B301] text-white', 'bg-[#D7DDD9] text-[#3F4A44]', 'bg-[#E0874A] text-white']
  return (
    <section aria-labelledby="top-items-title" className={`${card} p-5 lg:p-6`}>
      <CardHeader
        id="top-items-title"
        icon={<Crown className="text-[#F5B301]" />}
        title="Top Selling Items"
        action={<Link to="/business-owner/menu" className="inline-flex items-center gap-1 rounded-full border border-[#E2E8E3] px-3 py-1.5 text-xs font-semibold text-[#17201A] hover:bg-[#F6F8F6]">View All <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}
      />
      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-[#647067]">No dishes sold in this period yet.</p>
      ) : (
        <ol className="space-y-4">
          {items.map((item, i) => (
            <li key={`${item.offering_id ?? item.name}-${i}`} className="flex items-center gap-3">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${rankStyle[i] ?? 'bg-[#F1F5F2] text-[#3F4A44]'}`}>
                <span className="sr-only">Rank </span>{i + 1}
              </span>
              {item.image
                ? <img src={toAssetUrl(item.image)} alt="" className="h-14 w-16 shrink-0 rounded-xl object-cover" />
                : <span className="flex h-14 w-16 shrink-0 items-center justify-center rounded-xl bg-[#F1F5F2] text-[#8A968E]" aria-hidden="true"><UtensilsCrossed className="h-6 w-6" /></span>}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-[#17201A]">{item.name}</p>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-[#17201A]">{peso(item.revenue)}</p>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#EEF2EF]" aria-hidden="true">
                    <span className="block h-full rounded-full bg-[#16803C]" style={{ width: `${(item.quantity / max) * 100}%` }} />
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-[#647067]">{item.quantity} sold</span>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function OrdersByStatus({ data }: { data: Overview['orders_by_status'] }) {
  const counts = Object.fromEntries(data.groups.map((g) => [g.key, g.count])) as Record<StatusKey, number>
  const slices = STATUS_ORDER.map((key) => ({ key, name: STATUS_META[key].label, value: counts[key] ?? 0 })).filter((s) => s.value > 0)
  const pct = (n: number) => (data.total ? Math.round((n / data.total) * 100) : 0)
  return (
    <section aria-labelledby="status-title" className={`${card} @container p-5 lg:p-6`}>
      <CardHeader id="status-title" icon={<PieIcon />} title="Orders by Status" />
      {data.total === 0 ? (
        <p className="py-14 text-center text-sm text-[#647067]">No orders placed in this period.</p>
      ) : (
        <div className="flex flex-col items-center gap-5 @[26rem]:flex-row">
          <div className="relative h-40 w-40 shrink-0">
            <div className="absolute inset-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={slices.length > 1 ? 2 : 0} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
                  {slices.map((s) => <Cell key={s.key} fill={STATUS_META[s.key].color} />)}
                </Pie>
                <Tooltip formatter={(v, n) => [`${v} (${pct(Number(v))}%)`, String(n)]} contentStyle={{ borderRadius: 12, border: '1px solid #E2E8E3', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            </div>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-extrabold tabular-nums text-[#17201A]">{data.total}</span>
              <span className="text-[11px] text-[#647067]">Total Orders</span>
            </div>
          </div>
          <ul className="w-full min-w-0 space-y-2.5" aria-label="Orders by status">
            {STATUS_ORDER.map((key) => (
              <li key={key} className="flex items-center gap-2.5 text-sm">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: STATUS_META[key].color }} aria-hidden="true" />
                <span className="flex-1 text-[#3F4A44]">{STATUS_META[key].label}</span>
                <span className="tabular-nums text-[#647067]">{counts[key] ?? 0}</span>
                <span className="w-10 text-right font-semibold tabular-nums text-[#17201A]">{pct(counts[key] ?? 0)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function BreakdownTooltip({ active, payload }: { active?: boolean; payload?: { payload: Overview['breakdown'][number] }[] }) {
  const b = active ? payload?.[0]?.payload : undefined
  if (!b) return null
  return (
    <div className="rounded-xl border border-[#E2E8E3] bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-[#17201A]">{b.label} · {shortDate(b.from)} – {shortDate(b.to)}</p>
      <p className="mt-1 flex justify-between gap-4 text-[#3F4A44]"><span>This period</span><span className="font-semibold tabular-nums text-[#17201A]">{peso(b.revenue)}</span></p>
      <p className="flex justify-between gap-4 text-[#3F4A44]"><span>Previous period</span><span className="font-semibold tabular-nums text-[#17201A]">{peso(b.previous_revenue)}</span></p>
    </div>
  )
}

function RevenueBreakdown({ data }: { data: Overview['breakdown'] }) {
  const empty = data.every((b) => b.revenue === 0 && b.previous_revenue === 0)
  return (
    <section aria-labelledby="breakdown-title" className={`${card} p-5 lg:p-6`}>
      <CardHeader id="breakdown-title" icon={<ClipboardList />} title="Revenue Breakdown" />
      <div className="-mt-2 mb-3 flex gap-4"><LegendDot color={CURRENT} label="This period" /><LegendDot color={PREVIOUS} label="Previous period" /></div>
      {empty ? (
        <p className="py-14 text-center text-sm text-[#647067]">No revenue in this period or the one before.</p>
      ) : (
        <ChartBox height={190}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#EEF2EF" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#3F4A44', fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v: number) => `₱${compactPeso.format(v)}`} tick={{ fill: '#647067', fontSize: 11 }} tickLine={false} axisLine={false} width={52} />
            <Tooltip content={<BreakdownTooltip />} cursor={{ fill: '#F3F8F4' }} />
            <Bar dataKey="revenue" name="This period" fill={CURRENT} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
            <Bar dataKey="previous_revenue" name="Previous period" fill={PREVIOUS} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
        </ChartBox>
      )}
    </section>
  )
}

const ACTIVITY_META: Record<string, { label: string; icon: ReactNode; tone: string; badge: string }> = {
  orders: { label: 'Order', icon: <ShoppingBag />, tone: 'bg-[#1B7F3B]', badge: 'bg-[#EAF6ED] text-[#166534]' },
  messages: { label: 'Message', icon: <MessageSquare />, tone: 'bg-[#2F6FDB]', badge: 'bg-[#EAF1FD] text-[#1D4ED8]' },
  reviews: { label: 'Review', icon: <Star />, tone: 'bg-[#F5B301]', badge: 'bg-[#FFF7D6] text-[#8A5A00]' },
  system: { label: 'System', icon: <Wrench />, tone: 'bg-[#6B7280]', badge: 'bg-[#F1F3F5] text-[#3F4A44]' },
  other: { label: 'Update', icon: <Bell />, tone: 'bg-[#6B7280]', badge: 'bg-[#F1F3F5] text-[#3F4A44]' },
}

function RecentActivity() {
  const { data } = useQuery({
    queryKey: ['bo-notifications', 'recent'],
    queryFn: () => get<{ data: RecentNotification[] }>('/business-owner/notifications?perPage=4'),
  })
  const rows = data?.data ?? []
  return (
    <section aria-labelledby="activity-title" className={`${card} p-5 lg:p-6`}>
      <CardHeader
        id="activity-title"
        icon={<History />}
        title="Recent Activity"
        action={<Link to="/business-owner/notifications" className="inline-flex items-center gap-1 rounded-full border border-[#E2E8E3] px-3 py-1.5 text-xs font-semibold text-[#17201A] hover:bg-[#F6F8F6]">View All <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></Link>}
      />
      {rows.length === 0 ? (
        <p className="py-14 text-center text-sm text-[#647067]">No activity yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((n) => {
            const meta = ACTIVITY_META[n.category] ?? ACTIVITY_META.other!
            return (
              <li key={n.id}>
                <Link to={`/business-owner/notifications/${n.id}`} className="flex items-center gap-3 rounded-xl p-1 transition hover:bg-[#F6F8F6]">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white [&>svg]:h-4 [&>svg]:w-4 ${meta.tone}`} aria-hidden="true">{meta.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[#17201A]">{n.title}</span>
                    <span className="block text-xs text-[#647067]">{timeAgo(n.created_at)}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.badge}`}>{meta.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function ExportMenu({ query }: { query: URLSearchParams }) {
  const ref = useRef<HTMLDetailsElement>(null)
  const link = (type: string, format: string, label: string) => (
    <a href={buildExportUrl(type, format, query)} download onClick={() => ref.current?.removeAttribute('open')} className="block rounded-lg px-3 py-1.5 text-sm text-[#17201A] hover:bg-[#F3F8F4]">{label}</a>
  )
  return (
    <details ref={ref} className="relative">
      <summary className="flex h-11 cursor-pointer list-none items-center gap-2 rounded-full border border-[#E2E8E3] bg-white px-4 text-sm font-semibold text-[#17201A] shadow-sm hover:bg-[#F6F8F6] [&::-webkit-details-marker]:hidden">
        <Download className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> Export
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-[#E2E8E3] bg-white p-2 shadow-lg">
        <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[#8A968E]">Sales report</p>
        {link('sales', 'pdf', 'PDF')}{link('sales', 'csv', 'CSV')}{link('sales', 'excel', 'Excel')}
        <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[#8A968E]">Orders report</p>
        {link('orders', 'pdf', 'PDF')}{link('orders', 'csv', 'CSV')}{link('orders', 'excel', 'Excel')}
      </div>
    </details>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────

/**
 * Reports & Analytics (owner and finance staff): KPIs against the previous
 * period, sales trend, top-selling items, orders by status, revenue per week
 * and recent activity. Real figures only (GET reports/overview).
 */
export default function BusinessOwnerReports() {
  const portal = useBusinessPortal()
  const globalSelectedId = portal.businessId
  const [selectedBusiness, setSelectedBusiness] = useState(globalSelectedId ? String(globalSelectedId) : '')
  const [selectedBusinessType, setSelectedBusinessType] = useState('')
  const [preset, setPreset] = useState<Preset>('last_30')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const initialSyncDone = useRef(false)
  useEffect(() => {
    if (!initialSyncDone.current && globalSelectedId) {
      setSelectedBusiness(String(globalSelectedId))
      initialSyncDone.current = true
    }
  }, [globalSelectedId])

  const { data: businessesResponse } = useQuery({
    queryKey: ['bo-businesses'],
    queryFn: () => get<Business[] | { data: Business[] }>(`${portal.prefix}/businesses`),
  })
  // GET /businesses returns the list itself (get() unwraps the envelope).
  const businesses: Business[] = Array.isArray(businessesResponse) ? businessesResponse : businessesResponse?.data ?? []
  const businessTypes = useMemo(() => {
    const types = new Set<string>()
    for (const biz of businesses) {
      const category = (biz as Business & { category?: string }).category
      if (category) types.add(category)
    }
    return Array.from(types).sort()
  }, [businesses])

  // The range: a preset, or Date From / Date To when "Custom range" is chosen.
  const today = manilaToday()
  const range = preset === 'custom' ? (dateFrom && dateTo ? { from: dateFrom, to: dateTo } : null) : presetRange(preset, today)
  const dateError = preset === 'custom' && dateFrom && dateTo
    ? dateFrom > dateTo ? 'Date From cannot be after Date To.' : daysBetween(dateFrom, dateTo) > 366 ? 'Choose a range of one year or less.' : ''
    : ''
  const validRange = range && !dateError ? range : null
  const hasFilters = Boolean(selectedBusiness || selectedBusinessType || preset !== 'last_30')
  const clearFilters = () => {
    setSelectedBusiness('')
    setSelectedBusinessType('')
    setPreset('last_30')
    setDateFrom('')
    setDateTo('')
  }

  const query = new URLSearchParams()
  if (selectedBusiness) query.set('business_id', selectedBusiness)
  if (selectedBusinessType) query.set('business_type', selectedBusinessType)
  if (validRange) { query.set('from', validRange.from); query.set('to', validRange.to) }
  const queryString = query.toString()

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['bo-reports-overview', queryString],
    queryFn: () => get<Overview>(`${portal.prefix}/reports/overview?${queryString}`),
    enabled: Boolean(validRange),
    placeholderData: (previous) => previous,
  })

  const presetLabel = PRESETS.find((p) => p.key === preset)?.label ?? 'Last 30 Days'
  const k = data?.kpis

  return (
    <div className="space-y-5">
      {/* Header band */}
      <div className="relative overflow-hidden rounded-[24px] border border-[#E2ECE4] bg-gradient-to-r from-[#EAF4EC] via-[#F2F7F1] to-[#F6F4EE] px-5 py-5 sm:px-7">
        <UtensilsCrossed className="pointer-events-none absolute left-[52%] top-1/2 h-24 w-24 -translate-y-1/2 text-[#16803C]/[0.06]" aria-hidden="true" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <span className="flex items-end gap-1" aria-hidden="true">
              <span className="h-5 w-2.5 rounded-sm bg-[#22A04B]" /><span className="h-8 w-2.5 rounded-sm bg-[#16803C]" /><span className="h-11 w-2.5 rounded-sm bg-[#0F6B31]" />
            </span>
            <div>
              <h1 className="text-2xl font-extrabold text-[#17201B] lg:text-[32px]">Reports &amp; Analytics</h1>
              <p className="mt-0.5 text-sm text-[#3F4A44]">Track your restaurant performance and business insights.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="report-range" className="sr-only">Date range</label>
            <div className="relative">
              <CalendarDays className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#16803C]" aria-hidden="true" />
              <select
                id="report-range"
                value={preset}
                onChange={(e) => setPreset(e.target.value as Preset)}
                className="h-11 appearance-none rounded-full border border-[#E2E8E3] bg-white pl-11 pr-10 text-sm font-semibold text-[#17201A] shadow-sm focus:border-[#16803C] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25"
              >
                {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#3F4A44]" aria-hidden="true" />
            </div>
            {!portal.isStaff && <ExportMenu query={query} />}
          </div>
        </div>
      </div>

      {/* Filters: business, type, custom dates */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-56">
          <label htmlFor="report-business" className="mb-1 block text-xs font-medium text-[#5E6B63]">Business</label>
          <select id="report-business" value={selectedBusiness} onChange={(e) => { setSelectedBusiness(e.target.value); setSelectedBusinessType('') }} className={field}>
            <option value="">All</option>
            {businesses.map((biz) => (<option key={biz.id} value={biz.id}>{biz.name}</option>))}
          </select>
        </div>
        <div className="w-full sm:w-44">
          <label htmlFor="report-business-type" className="mb-1 block text-xs font-medium text-[#5E6B63]">Business Type</label>
          <select id="report-business-type" value={selectedBusinessType} onChange={(e) => { setSelectedBusinessType(e.target.value); setSelectedBusiness('') }} className={field}>
            <option value="">All types</option>
            {businessTypes.map((type) => (<option key={type} value={type}>{type}</option>))}
          </select>
        </div>
        {preset === 'custom' && (
          <>
            <div className="w-full sm:w-44">
              <label htmlFor="report-date-from" className="mb-1 block text-xs font-medium text-[#5E6B63]">Date From</label>
              <input id="report-date-from" type="date" value={dateFrom} max={dateTo || today} aria-invalid={dateError ? true : undefined} onChange={(e) => setDateFrom(e.target.value)} className={field} />
            </div>
            <div className="w-full sm:w-44">
              <label htmlFor="report-date-to" className="mb-1 block text-xs font-medium text-[#5E6B63]">Date To</label>
              <input id="report-date-to" type="date" value={dateTo} min={dateFrom || undefined} max={today} aria-invalid={dateError ? true : undefined} onChange={(e) => setDateTo(e.target.value)} className={field} />
            </div>
          </>
        )}
        <div className="flex min-h-10 flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
          {dateError ? (
            <p role="alert" className="font-medium text-[#B91C1C]">{dateError}</p>
          ) : validRange ? (
            <p className="text-[#647067]">
              {presetLabel}: <span className="font-semibold text-[#17201A]">{longDate(validRange.from)} – {longDate(validRange.to)}</span>
              {data?.range && <> · compared with {longDate(data.range.previous_from)} – {longDate(data.range.previous_to)}</>}
            </p>
          ) : (
            <p className="text-[#647067]">Pick both dates to see the report.</p>
          )}
          {hasFilters && <button type="button" onClick={clearFilters} className="font-semibold text-[#16803C] hover:underline">Clear filters</button>}
        </div>
      </div>

      {isLoading && validRange ? (
        <DashboardSkeleton />
      ) : !data?.series || !k ? null : (
        <div className={`space-y-5 transition-opacity ${isFetching ? 'opacity-70' : ''}`} aria-busy={isFetching}>
          {/* KPIs */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiTile icon={<ShoppingBag />} iconBg="bg-[#1B7F3B]" label="Total Orders" value={k.orders.value} extra={<Change value={k.orders.change} />}
              spark={<Sparkline id="orders" color="#1B7F3B" data={data.series.map((p) => p.orders)} />} />
            <KpiTile icon={<span className="text-2xl font-extrabold leading-none xl:text-xl 2xl:text-2xl">₱</span>} iconBg="bg-[#F5B301]" label="Total Revenue" value={peso(k.revenue.value)} extra={<Change value={k.revenue.change} />}
              spark={<Sparkline id="revenue" color="#E0A100" data={data.series.map((p) => p.revenue)} />} />
            <KpiTile icon={<TrendingUp />} iconBg="bg-[#15803D]" label="Total Earnings" value={peso(k.earnings.value)}
              extra={<span className="flex flex-wrap items-center gap-x-2"><Change value={k.earnings.change} /><span className="text-xs text-[#647067]">after {peso(k.earnings.expenses)} expenses</span></span>}
              spark={<Sparkline id="earnings" color="#15803D" data={data.series.map((p) => p.earnings)} />} />
            <KpiTile icon={<Star className="fill-white" />} iconBg="bg-[#8B5CF6]" label="Average Rating"
              value={k.rating.value === null ? '—' : <span className="inline-flex items-center gap-1.5">{k.rating.value.toFixed(1)}<Star className="h-5 w-5 fill-[#F5B301] text-[#F5B301]" aria-hidden="true" /></span>}
              extra={<span className="text-xs text-[#647067]">{k.rating.count} review{k.rating.count === 1 ? '' : 's'}{k.rating.new_in_range ? ` · ${k.rating.new_in_range} new` : ''}</span>} />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <SalesOverview series={data.series} />
            <TopSelling items={data.top_items} />
          </div>

          <div className={`grid grid-cols-1 gap-5 ${portal.isStaff ? 'lg:grid-cols-2' : 'lg:grid-cols-2 xl:grid-cols-3'}`}>
            <OrdersByStatus data={data.orders_by_status} />
            <RevenueBreakdown data={data.breakdown} />
            {!portal.isStaff && <RecentActivity />}
          </div>

          {data.bookings.total > 0 && (
            <section aria-labelledby="bookings-title" className={`${card} p-5 lg:p-6`}>
              <h2 id="bookings-title" className="mb-3 text-lg font-bold text-[#17201A]">Bookings · {data.bookings.total} · {peso(data.bookings.revenue)}</h2>
              <ul className="divide-y divide-[#F0F3F1]">
                {data.bookings.by_status.map((b) => (
                  <li key={b.status} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <span className="capitalize text-[#3F4A44]">{b.status.replace(/_/g, ' ')}</span>
                    <span className="tabular-nums text-[#647067]">{b.count}</span>
                    <span className="w-28 text-right font-semibold tabular-nums text-[#17201A]">{peso(b.revenue)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
