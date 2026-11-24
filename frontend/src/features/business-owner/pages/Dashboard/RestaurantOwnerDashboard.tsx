import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { get } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { formatCurrency, toAssetUrl } from '@/shared/utils'
import {
  ArrowRight, BarChart3, CalendarDays, CheckCircle2, ClipboardList, Info, PlusCircle, ShoppingBag, Star, Tag, Users, Wallet, Zap,
  type LucideIcon,
} from 'lucide-react'

/**
 * Restaurant owner dashboard (redesign, matches the TrackTour owner mockup).
 * Every number comes from existing owner endpoints — nothing is estimated:
 *  - /business-owner/dashboard          all-time totals, pending, promotions, recent orders
 *  - /business-owner/reports/sales      completed orders and revenue per day (week / month / year)
 *  - /business-owner/expenses/summary   this month's expenses by category
 *  - /business-owner/staff              active staff of this restaurant
 *  - /business-owner/businesses         the restaurant's cover photo for the banner
 * There is no period-over-period data, so no "+x%" badges are shown.
 */
export interface RestaurantDashboardData {
  business: { name: string; category: string }
  stats: { total_orders: number; total_revenue: number; pending_orders: number; active_promotions: number; total_menu_items: number }
  recent_orders: { id: number; order_number: string; customer_name: string; status: string; total: number; created_at: string }[]
}

interface SalesDay { date: string; total_orders: number; total_revenue: number | string }
interface SalesReport { sales_data: SalesDay[]; summary: { total_revenue: number | string; total_orders: number } }
interface ExpenseSummary { total_expenses: number; by_category: Record<string, number | string> }
interface BusinessRow { id: number; name?: string; business_name?: string; cover_photo?: string | null }

type Period = 'weekly' | 'monthly' | 'yearly'
const PERIODS: { key: Period; label: string }[] = [
  { key: 'weekly', label: 'This week' },
  { key: 'monthly', label: 'This month' },
  { key: 'yearly', label: 'This year' },
]

const GREEN = '#16803C'
const AMBER = '#D97706'
const card = 'rounded-[20px] border border-[#ECE7DA] bg-[#fff] shadow-[0_1px_2px_rgba(23,32,27,0.04),0_6px_18px_rgba(23,32,27,0.05)]'

const STATUS_STYLE: Record<string, string> = {
  pending_payment: 'bg-amber-50 text-amber-800 border-amber-200',
  waiting_restaurant: 'bg-amber-50 text-amber-800 border-amber-200',
  accepted: 'bg-sky-50 text-sky-800 border-sky-200',
  preparing: 'bg-amber-50 text-amber-800 border-amber-200',
  ready: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  picked_up: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  in_transit: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  delivered: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  completed: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  cancelled: 'bg-red-50 text-red-700 border-red-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
}
const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
const money = (v: number | string | undefined) => formatCurrency(Number(v ?? 0))
const shortDate = (iso: string) => new Date(iso + (iso.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })

export default function RestaurantOwnerDashboard({ data, businessId }: { data: RestaurantDashboardData; businessId: number }) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [period, setPeriod] = useState<Period>('monthly')
  const now = useClock()

  const { data: monthSales } = useQuery({
    queryKey: ['bo-sales', businessId, 'monthly'],
    queryFn: () => get<SalesReport>(`/business-owner/reports/sales?business_id=${businessId}&period=monthly`),
  })
  const { data: chartSales, isLoading: chartLoading } = useQuery({
    queryKey: ['bo-sales', businessId, period],
    queryFn: () => get<SalesReport>(`/business-owner/reports/sales?business_id=${businessId}&period=${period}`),
  })
  const { data: expenses } = useQuery({
    queryKey: ['bo-expenses-summary', businessId],
    queryFn: () => get<ExpenseSummary>(`/business-owner/expenses/summary?business_id=${businessId}`),
  })
  const { data: staffData } = useQuery({
    queryKey: ['bo-staff', businessId],
    queryFn: () => get<{ staff: { status: string }[] }>(`/business-owner/staff?business_id=${businessId}`),
  })
  const { data: businesses } = useQuery({
    queryKey: ['bo-businesses'],
    queryFn: () => get<{ data: BusinessRow[] } | BusinessRow[]>('/business-owner/businesses'),
  })

  const businessList = Array.isArray(businesses) ? businesses : businesses?.data ?? []
  const cover = businessList.find((b) => b.id === businessId)?.cover_photo
  const coverUrl = cover ? toAssetUrl(cover) : ''

  const monthDays = monthSales?.sales_data ?? []
  const monthRevenue = Number(monthSales?.summary.total_revenue ?? 0)
  const monthOrders = Number(monthSales?.summary.total_orders ?? 0)
  const activeStaff = (staffData?.staff ?? []).filter((s) => s.status === 'active').length
  const totalExpenses = Number(expenses?.total_expenses ?? 0)
  const net = monthRevenue - totalExpenses

  const chartData = useMemo(
    () => (chartSales?.sales_data ?? []).map((d) => ({ date: d.date, label: shortDate(d.date), revenue: Number(d.total_revenue), orders: Number(d.total_orders) })),
    [chartSales],
  )
  const expenseBars = Object.entries(expenses?.by_category ?? {})
    .map(([category, total]) => ({ category: statusLabel(category), total: Number(total) }))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total)

  const firstName = (user?.name ?? '').split(' ')[0] || 'there'
  const isFood = ['Restaurant', 'Café', 'Food Hub', 'Hotel & Restaurant Combination'].includes(data.business.category)

  return (
    <div className="space-y-5">
      {/* Welcome banner: the restaurant's own cover photo, or brand green */}
      <section
        aria-label="Welcome"
        className="relative overflow-hidden rounded-[22px] bg-[#0F4D2B] text-white shadow-[0_8px_24px_rgba(15,77,43,0.18)]"
      >
        {coverUrl && <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-r from-[#0B3D22] via-[#0F4D2B]/90 to-[#0F4D2B]/30" aria-hidden="true" />
        <div className="relative flex min-h-[140px] flex-col justify-between gap-4 px-6 py-6 sm:flex-row sm:items-center lg:px-8">
          <div>
            <h1 className="text-[clamp(1.5rem,2.6vw,2.1rem)] font-extrabold leading-tight text-white">Welcome back, {firstName}!</h1>
            <p className="mt-1 text-sm text-[#DCEFE3] sm:text-base">Here&apos;s what&apos;s happening with your {isFood ? 'restaurant' : 'business'} today.</p>
          </div>
          <p className="inline-flex w-fit items-center gap-2 rounded-xl bg-[#0B3D22]/85 px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-[#ffffff26]" data-testid="dashboard-clock">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {now.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })}
            <span aria-hidden="true">•</span>
            {now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })}
          </p>
        </div>
      </section>

      {/* KPI tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile icon={ShoppingBag} tint="bg-[#16803C]" label="Orders this month" value={String(monthOrders)}
          hint={`Completed · ${data.stats.total_orders} orders all time`} spark={monthDays.map((d) => Number(d.total_orders))} color={GREEN} />
        <KpiTile icon={Wallet} tint="bg-[#E9A100]" label="Revenue this month" value={money(monthRevenue)}
          hint={`Completed orders · ${money(data.stats.total_revenue)} all time`} spark={monthDays.map((d) => Number(d.total_revenue))} color={AMBER} />
        <KpiTile icon={Users} tint="bg-[#0F4D2B]" label="Active staff" value={String(activeStaff)} hint="Staff who can sign in now" />
        <KpiTile icon={Star} tint="bg-[#7C3AED]" label="Active promotions" value={String(data.stats.active_promotions)} hint={`${data.stats.total_menu_items} menu items`} />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        {/* Sales overview: revenue only (orders per day in the tooltip; never two y-axes) */}
        <section aria-label="Sales overview" className={`${card} p-5`}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-[#17201B]"><BarChart3 className="h-5 w-5 text-[#16803C]" /> Sales Overview</h2>
            <label className="text-sm">
              <span className="sr-only">Period</span>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value as Period)}
                className="rounded-xl border border-[#E4DFD2] bg-[#fff] px-3 py-2 text-sm font-medium text-[#17201B] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25"
              >
                {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </label>
          </div>
          <p className="mb-2 text-xs text-[#5E6B63]">Revenue from completed orders per day.</p>
          {chartLoading ? (
            <div className="h-64 animate-pulse rounded-xl bg-[#F3F1EA]" />
          ) : chartData.length === 0 ? (
            <EmptyPanel text="No completed orders in this period yet." />
          ) : (
            <div className="h-64" role="img" aria-label={`Revenue per day, ${PERIODS.find((p) => p.key === period)?.label.toLowerCase()}`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={GREEN} stopOpacity={0.22} />
                      <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#EFECE3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#5E6B63', fontSize: 12 }} minTickGap={16} />
                  <YAxis tickLine={false} axisLine={false} width={64} tick={{ fill: '#5E6B63', fontSize: 12 }} tickFormatter={(v: number) => `₱${v >= 1000 ? `${Math.round(v / 100) / 10}k` : v}`} />
                  <Tooltip cursor={{ stroke: '#9CA3AF', strokeDasharray: '4 4' }} content={<SalesTooltip />} />
                  <Area type="monotone" dataKey="revenue" isAnimationActive={false} stroke={GREEN} strokeWidth={2} fill="url(#revFill)" dot={{ r: 4, fill: GREEN, stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 6, stroke: '#fff', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* Quick actions */}
        <section aria-label="Quick actions" className={`${card} p-5`}>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[#17201B]"><Zap className="h-5 w-5 text-[#E9A100]" /> Quick Actions</h2>
          <div className="grid grid-cols-2 gap-3">
            <QuickAction icon={PlusCircle} title="Manage Menu" text="Update menu & prices" onClick={() => navigate('/business-owner/menu')} />
            <QuickAction icon={Tag} title="Create Promotion" text="Add discounts & deals" onClick={() => navigate('/business-owner/promotions/create')} />
            <QuickAction icon={Users} title="Manage Staff" text="Accounts & roles" onClick={() => navigate('/business-owner/staff')} />
            <QuickAction icon={BarChart3} title="View Reports" text="Sales & earnings" onClick={() => navigate('/business-owner/reports')} />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Recent orders */}
        <section aria-label="Recent orders" className={`${card} p-5`}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-bold text-[#17201B]"><ClipboardList className="h-5 w-5 text-[#16803C]" /> Recent Orders</h2>
            <Link to="/business-owner/orders" className="inline-flex items-center gap-1 rounded-xl border border-[#E4DFD2] px-3 py-1.5 text-sm font-semibold text-[#17201B] hover:bg-[#F6F4EE]">
              View All <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {data.recent_orders.length === 0 ? (
            <EmptyPanel text="No orders yet." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#EFECE3] text-left text-xs font-semibold text-[#5E6B63]">
                    <th className="py-2 pr-3">Order #</th><th className="py-2 pr-3">Customer</th><th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3">Status</th><th className="py-2">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F2EFE7]">
                  {data.recent_orders.slice(0, 6).map((o) => (
                    <tr key={o.id} className="cursor-pointer hover:bg-[#FAF8F3]" onClick={() => navigate(`/business-owner/orders/${o.id}`)}>
                      <td className="py-2.5 pr-3 font-semibold text-[#0F4D2B]">{o.order_number}</td>
                      <td className="py-2.5 pr-3 text-[#17201B]">{o.customer_name}</td>
                      <td className="py-2.5 pr-3 text-right font-medium tabular-nums">{money(o.total)}</td>
                      <td className="py-2.5 pr-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[o.status] ?? 'bg-gray-50 text-gray-700 border-gray-200'}`}>{statusLabel(o.status)}</span>
                      </td>
                      <td className="py-2.5 whitespace-nowrap text-[#5E6B63]">
                        {new Date(o.created_at).toLocaleString('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Business summary (this month) */}
        <section aria-label="Business summary" className={`${card} p-5`}>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[#17201B]"><BarChart3 className="h-5 w-5 text-[#16803C]" /> Business Summary <span className="text-sm font-medium text-[#5E6B63]">· This month</span></h2>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <MiniBars title="Total sales" value={money(monthRevenue)} color={GREEN} data={monthDays.map((d) => ({ name: shortDate(d.date), value: Number(d.total_revenue) }))} empty="No completed orders yet" />
            <MiniBars title="Total expenses" value={money(totalExpenses)} color={AMBER} data={expenseBars.map((e) => ({ name: e.category, value: e.total }))} empty="No expenses recorded" />
          </div>
          <div className={`mt-5 flex items-start gap-3 rounded-2xl p-4 ${net >= 0 ? 'bg-[#EAF6ED]' : 'bg-amber-50'}`} role="status">
            {net >= 0 ? <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[#16803C]" /> : <Info className="mt-0.5 h-6 w-6 shrink-0 text-amber-700" />}
            <div>
              <p className="font-bold text-[#17201B]">{net >= 0 ? 'Sales are covering your expenses this month' : 'Expenses are higher than sales this month'}</p>
              <p className="text-sm text-[#4B5563]">Sales {money(monthRevenue)} − expenses {money(totalExpenses)} = <strong>{net < 0 ? `-${money(-net)}` : money(net)}</strong></p>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}

function KpiTile({ icon: Icon, tint, label, value, hint, spark, color }: {
  icon: LucideIcon; tint: string; label: string; value: string; hint: string; spark?: number[]; color?: string
}) {
  // A flat series (same value every day) would draw as a solid block: show no trend line then.
  const values = spark ?? []
  const points = Math.max(...values, 0) !== Math.min(...values, Infinity) ? values.map((v, i) => ({ i, v })) : []
  return (
    <div className={`${card} flex flex-col overflow-hidden p-5`} data-testid={`kpi-${label}`}>
      <div className="flex items-center gap-4">
        <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white ${tint}`}><Icon className="h-7 w-7" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#17201B]">{label}</p>
          <p className="mt-0.5 text-[1.65rem] font-extrabold leading-tight text-[#17201B] tabular-nums">{value}</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-[#5E6B63]">{hint}</p>
      {points.length > 1 && color ? (
        <div className="-mx-1 mt-2 h-10" aria-hidden="true">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.12} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : null}
    </div>
  )
}

function QuickAction({ icon: Icon, title, text, onClick }: { icon: LucideIcon; title: string; text: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 rounded-2xl bg-[#EEF7F1] px-3 py-4 text-center transition hover:bg-[#E2F1E7] focus-visible:ring-2 focus-visible:ring-[#16803C]/40">
      <Icon className="h-7 w-7 text-[#16803C]" aria-hidden="true" />
      <span className="text-sm font-bold text-[#0F4D2B]">{title}</span>
      <span className="text-xs text-[#5E6B63]">{text}</span>
    </button>
  )
}

function MiniBars({ title, value, color, data, empty }: { title: string; value: string; color: string; data: { name: string; value: number }[]; empty: string }) {
  return (
    <div>
      <p className="text-sm text-[#5E6B63]">{title}</p>
      <p className="text-xl font-extrabold text-[#17201B] tabular-nums">{value}</p>
      {data.length === 0 ? (
        <p className="mt-3 text-xs text-[#8A938D]">{empty}</p>
      ) : (
        <div className="mt-2 h-20" role="img" aria-label={`${title} breakdown`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap={2}>
              <Tooltip cursor={{ fill: '#F3F1EA' }} formatter={(v) => formatCurrency(Number(v))} labelStyle={{ color: '#17201B' }} />
              <Bar dataKey="value" fill={color} fillOpacity={0.85} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

function SalesTooltip({ active, payload }: { active?: boolean; payload?: { payload: { date: string; revenue: number; orders: number } }[] }) {
  if (!active || !payload?.length) return null
  const d = payload[0]!.payload
  return (
    <div className="rounded-xl bg-[#fff] px-3 py-2 text-xs shadow-lg ring-1 ring-black/5">
      <p className="font-semibold text-[#17201B]">{new Date(d.date + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
      <p className="mt-1 text-[#17201B]"><span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: GREEN }} />Revenue {formatCurrency(d.revenue)}</p>
      <p className="text-[#5E6B63]">{d.orders} completed order{d.orders === 1 ? '' : 's'}</p>
    </div>
  )
}

function EmptyPanel({ text }: { text: ReactNode }) {
  return <div className="flex h-40 items-center justify-center rounded-xl bg-[#FAF8F3] text-sm text-[#5E6B63]">{text}</div>
}

/** The current time, refreshed every 30 seconds for the banner. */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}
