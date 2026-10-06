import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatCurrency, formatDateTime, capitalize } from '@/shared/utils'
import { API_ENDPOINTS } from '@/shared/constants'
import { BarChart3, CheckCircle2, CircleDollarSign, Clock, Receipt, Store, TrendingUp, Wallet } from 'lucide-react'

type PeriodKey = 'today' | 'weekly' | 'monthly' | 'all'

const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: 'Today',
  weekly: 'This Week',
  monthly: 'This Month',
  all: 'All Time',
}

interface WindowMetrics {
  revenue: number
  transactions: number
  cod_revenue: number
  cod_transactions: number
  online_revenue: number
  online_transactions: number
}

interface PosSummaryResponse {
  today: WindowMetrics
  this_week: WindowMetrics
  this_month: WindowMetrics
  all_time: WindowMetrics
  pending_amount: number
}

interface PosSalesResponse {
  period: { label: string; start: string | null; end: string | null }
  summary: {
    gross_sales: number
    transactions: number
    average_order_value: number
    pending_amount: number
    system_fees: number
    cod_settlements: { transactions: number; settlement_base: number; platform_revenue: number }
  }
  by_payment_method: { payment_method: string; transactions: number; revenue: number }[]
  by_order_status: Record<string, number>
}

interface PosTransaction {
  id: number
  order_number: string
  customer_name: string
  business: { id: number; business_name: string }
  order_type: string
  payment_method: string
  subtotal: number
  delivery_fee: number
  rider_tip: number
  system_fee: number
  total: number
  paid_amount: number
  status: string
  paid_at: string | null
  created_at: string | null
  group_order_id: number | null
  is_group: boolean
}

interface PaginationMeta {
  current_page: number
  last_page: number
  per_page: number
  total: number
}

interface PosBusinessRow {
  business_id: number
  business_name: string
  transactions: number
  revenue: number
  cod_revenue: number
  cod_transactions: number
  online_revenue: number
  online_transactions: number
}

interface PosTrendDay {
  date: string
  sales: number
  transactions: number
}

const STATUS_FUNNEL_ORDER = [
  'waiting_restaurant',
  'accepted',
  'preparing',
  'ready',
  'picked_up',
  'in_transit',
  'arrived_destination',
  'delivered',
  'completed',
]

const METHOD_LABELS: Record<string, string> = {
  cod: 'COD (Cash)',
  gcash: 'GCash',
  unmarked: 'Unmarked',
}

type MethodColor = { bar: string; text: string; chip: string }

const FALLBACK_METHOD_COLOR: MethodColor = { bar: 'bg-[#9CA3AF]', text: 'text-[#6B7280]', chip: 'bg-[#F3F4F6] border-[#E5E7EB]' }

const METHOD_COLORS: Record<string, MethodColor> = {
  cod: { bar: 'bg-[#16803C]', text: 'text-[#16803C]', chip: 'bg-[#EAF6ED] border-[#D7E8DB]' },
  gcash: { bar: 'bg-[#0891B2]', text: 'text-[#0891B2]', chip: 'bg-[#E0F6FA] border-[#C5EBF2]' },
  unmarked: FALLBACK_METHOD_COLOR,
}

export default function AdminPosSales() {
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [txPage, setTxPage] = useState(1)
  const [txSearch, setTxSearch] = useState('')
  const [txMethod, setTxMethod] = useState('')
  const [txStatus, setTxStatus] = useState('')

  const { data: summary } = useQuery({
    queryKey: ['admin-pos-summary'],
    queryFn: () => get<PosSummaryResponse>(API_ENDPOINTS.ADMIN.POS_SUMMARY),
  })

  const { data: sales, isLoading: loadingSales } = useQuery({
    queryKey: ['admin-pos-sales', period],
    queryFn: () => get<PosSalesResponse>(API_ENDPOINTS.ADMIN.POS, { params: { period } }),
  })

  const { data: trend } = useQuery({
    queryKey: ['admin-pos-trend', period],
    queryFn: () => get<{ days: PosTrendDay[] }>(API_ENDPOINTS.ADMIN.POS_TREND, { params: { period } }),
  })

  const { data: byBusiness } = useQuery({
    queryKey: ['admin-pos-by-business', period],
    queryFn: () =>
      get<{ businesses: PosBusinessRow[]; total_revenue: number; total_transactions: number }>(
        API_ENDPOINTS.ADMIN.POS_BY_BUSINESS,
        { params: { period } }
      ),
  })

  const { data: txData, isLoading: loadingTx } = useQuery({
    queryKey: ['admin-pos-transactions', txPage, txSearch, txMethod, txStatus],
    queryFn: () =>
      get<{ data: PosTransaction[]; meta: PaginationMeta }>(API_ENDPOINTS.ADMIN.POS_TRANSACTIONS, {
        params: {
          page: txPage,
          search: txSearch || undefined,
          payment_method: txMethod || undefined,
          status: txStatus || undefined,
          perPage: 15,
        },
      }),
  })

  const transactions = txData?.data ?? []
  const txMeta = txData?.meta
  const trendDays = trend?.days ?? []
  const maxTrend = Math.max(...trendDays.map((d) => d.sales), 0)
  const statuses = sales?.by_order_status ?? {}
  const funnel = [
    ...STATUS_FUNNEL_ORDER.filter((s) => statuses[s]),
    ...Object.keys(statuses).filter((s) => !STATUS_FUNNEL_ORDER.includes(s)),
  ]
  const maxFunnel = Math.max(...Object.values(statuses), 0)
  const methods = sales?.by_payment_method ?? []

  const kpiCards = summary
    ? [
        { label: 'Today Sales', value: formatCurrency(summary.today.revenue), sub: `${summary.today.transactions} transactions`, icon: CircleDollarSign, tint: 'bg-[#EAF6ED] text-[#16803C]' },
        { label: 'Today COD', value: formatCurrency(summary.today.cod_revenue), sub: `${summary.today.cod_transactions} cash payments`, icon: Wallet, tint: 'bg-[#FFF7D6] text-[#B45309]' },
        { label: 'Today Online', value: formatCurrency(summary.today.online_revenue), sub: `${summary.today.online_transactions} GCash payments`, icon: TrendingUp, tint: 'bg-[#E0F6FA] text-[#0891B2]' },
        { label: 'Awaiting Payment', value: formatCurrency(summary.pending_amount), sub: 'pending amount snapshot', icon: Clock, tint: 'bg-[#FEF3F2] text-[#DC2626]' },
        { label: 'This Month Sales', value: formatCurrency(summary.this_month.revenue), sub: `${summary.this_month.transactions} transactions`, icon: BarChart3, tint: 'bg-[#EAF6ED] text-[#126B32]' },
        { label: 'All-Time Sales', value: formatCurrency(summary.all_time.revenue), sub: `${summary.all_time.transactions} transactions`, icon: Receipt, tint: 'bg-[#EAF6ED] text-[#16803C]' },
      ]
    : []

  return (
    <div>
      <div className="relative rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6 mb-6 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" viewBox="0 0 800 400" fill="none">
            <path d="M0 200 Q200 100 400 200 T800 200" stroke="#16803C" strokeWidth="2" fill="none" />
            <path d="M0 250 Q200 150 400 250 T800 250" stroke="#126B32" strokeWidth="1.5" fill="none" />
            <circle cx="120" cy="90" r="40" fill="#16803C" opacity="0.1" />
            <circle cx="680" cy="90" r="30" fill="#126B32" opacity="0.1" />
          </svg>
        </div>
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">POS &amp; Sales</h1>
            <p className="mt-1 text-sm lg:text-base text-[#6B7280]">
              Tourism Office sales monitor — paid orders (COD &amp; GCash) across every restaurant
            </p>
          </div>
          <div className="inline-flex rounded-xl bg-[#F3F4F6] p-1 gap-1 w-fit">
            {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setPeriod(key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                  period === key ? 'bg-white shadow text-[#16803C]' : 'text-[#6B7280] hover:text-[#17201A]'
                }`}
              >
                {PERIOD_LABELS[key]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {kpiCards.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
          {kpiCards.map((card) => {
            const Icon = card.icon
            return (
              <div key={card.label} className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-5 hover:shadow-tourism-lg transition-all">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{card.label}</p>
                    <p className="mt-2 text-lg lg:text-xl font-bold text-[#17201A] truncate">{card.value}</p>
                    <p className="mt-1 text-xs text-[#6B7280] truncate">{card.sub}</p>
                  </div>
                  <div className={`w-10 h-10 ${card.tint} rounded-lg flex items-center justify-center shrink-0`}>
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {loadingSales || !sales ? (
        <div className="text-center py-20 text-[#6B7280]">Loading sales...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            {/* Payment methods */}
            <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-6">
              <div className="flex items-center gap-2 mb-4">
                <CircleDollarSign className="w-5 h-5 text-[#16803C]" />
                <h2 className="text-lg font-semibold text-[#17201A]">Payment Methods</h2>
              </div>
              <div className="space-y-4">
                {methods.map((m) => {
                  const colors = METHOD_COLORS[m.payment_method] ?? FALLBACK_METHOD_COLOR
                  const pct = sales.summary.transactions > 0 ? (m.transactions / sales.summary.transactions) * 100 : 0
                  return (
                    <div key={m.payment_method}>
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <span className="font-medium text-[#17201A]">{METHOD_LABELS[m.payment_method] ?? capitalize(m.payment_method)}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${colors.chip} ${colors.text}`}>
                          {m.transactions} · {formatCurrency(m.revenue)}
                        </span>
                      </div>
                      <div className="h-3 bg-[#F3F4F6] rounded-full overflow-hidden">
                        <div className={`h-full ${colors.bar} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
                {methods.length === 0 && <p className="text-sm text-[#6B7280]">No paid orders in this period.</p>}
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="bg-[#F6F8F4] border border-[#E2E8E3] rounded-xl p-4">
                  <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">Gross Sales</p>
                  <p className="mt-1 text-xl font-bold text-[#16803C]">{formatCurrency(sales.summary.gross_sales)}</p>
                  <p className="mt-0.5 text-xs text-[#6B7280]">Avg {formatCurrency(sales.summary.average_order_value)}</p>
                </div>
                <div className="bg-[#F6F8F4] border border-[#E2E8E3] rounded-xl p-4">
                  <p className="text-xs uppercase tracking-wider text-[#6B7280] font-semibold">System Fees</p>
                  <p className="mt-1 text-xl font-bold text-[#17201A]">{formatCurrency(sales.summary.system_fees)}</p>
                  <p className="mt-0.5 text-xs text-[#6B7280]">{PERIOD_LABELS[period]}</p>
                </div>
              </div>

              <div className="mt-3 border border-[#E0E7E0] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle2 className="w-4 h-4 text-[#126B32]" />
                  <p className="text-sm font-semibold text-[#17201A]">COD Settlements (Tourism Office 20%)</p>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-lg font-bold text-[#126B32]">{sales.summary.cod_settlements.transactions}</p>
                    <p className="text-[11px] uppercase tracking-wider text-[#6B7280]">Settled</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-[#126B32]">{formatCurrency(sales.summary.cod_settlements.settlement_base)}</p>
                    <p className="text-[11px] uppercase tracking-wider text-[#6B7280]">Settlement Base</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-[#16803C]">{formatCurrency(sales.summary.cod_settlements.platform_revenue)}</p>
                    <p className="text-[11px] uppercase tracking-wider text-[#6B7280]">TO Revenue</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Order status funnel */}
            <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-6">
              <div className="flex items-center gap-2 mb-4">
                <Store className="w-5 h-5 text-[#16803C]" />
                <h2 className="text-lg font-semibold text-[#17201A]">Order Status Funnel</h2>
                <span className="ml-auto text-xs text-[#6B7280]">{PERIOD_LABELS[period]}</span>
              </div>
              <div className="space-y-3">
                {funnel.map((status) => {
                  const count = statuses[status] ?? 0
                  const pct = maxFunnel > 0 ? (count / maxFunnel) * 100 : 0
                  return (
                    <div key={status}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-[#17201A] capitalize">{status.replace(/_/g, ' ')}</span>
                        <span className="text-xs font-semibold text-[#6B7280]">{count}</span>
                      </div>
                      <div className="h-2.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                        <div className="h-full bg-[#16803C]/80 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
                {funnel.length === 0 && <p className="text-sm text-[#6B7280]">No paid orders in this period.</p>}
              </div>

              <div className="mt-6">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-5 h-5 text-[#16803C]" />
                  <h2 className="text-lg font-semibold text-[#17201A]">Sales Trend</h2>
                </div>
                {trendDays.length > 0 ? (
                  <div className="flex items-end gap-1.5 h-28">
                    {trendDays.map((day) => (
                      <div key={day.date} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${day.date} — ${formatCurrency(day.sales)} (${day.transactions})`}>
                        <div
                          className={`w-full rounded-t ${day.sales > 0 ? 'bg-[#16803C]/80' : 'bg-[#F3F4F6]'} hover:bg-[#126B32] transition-colors`}
                          style={{ height: `${maxTrend > 0 ? Math.max((day.sales / maxTrend) * 100, 3) : 3}%` }}
                        />
                        <span className="text-[9px] text-[#6B7280] truncate w-full text-center">{day.date.slice(5)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[#6B7280]">No trend data for this period.</p>
                )}
              </div>
            </div>
          </div>

          {/* Top businesses */}
          <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism overflow-hidden mb-6">
            <div className="px-5 lg:px-6 py-4 border-b border-[#E2E8E3] flex items-center gap-2">
              <Store className="w-5 h-5 text-[#16803C]" />
              <h2 className="text-lg font-semibold text-[#17201A]">Sales by Restaurant</h2>
              <span className="ml-auto text-sm text-[#6B7280]">
                Total {formatCurrency(byBusiness?.total_revenue ?? 0)} · {byBusiness?.total_transactions ?? 0} orders
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Restaurant</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Orders</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">COD</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Online</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {(byBusiness?.businesses ?? []).map((b) => (
                    <tr key={b.business_id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 lg:px-6 py-3 font-medium text-[#17201A]">{b.business_name}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#6B7280]">{b.transactions}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#6B7280]">{formatCurrency(b.cod_revenue)}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#6B7280]">{formatCurrency(b.online_revenue)}</td>
                      <td className="px-5 lg:px-6 py-3 font-semibold text-[#16803C]">{formatCurrency(b.revenue)}</td>
                    </tr>
                  ))}
                  {(byBusiness?.businesses ?? []).length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 lg:px-6 py-10 text-center text-[#6B7280]">No sales in this period.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Transactions */}
          <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism overflow-hidden">
            <div className="px-5 lg:px-6 py-4 border-b border-[#E2E8E3] flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex items-center gap-2">
                <Receipt className="w-5 h-5 text-[#16803C]" />
                <h2 className="text-lg font-semibold text-[#17201A]">Sales Transactions</h2>
              </div>
              <div className="lg:ml-auto flex flex-col sm:flex-row gap-2">
                <input
                  type="search"
                  placeholder="Search order or customer..."
                  value={txSearch}
                  onChange={(e) => { setTxSearch(e.target.value); setTxPage(1) }}
                  className="px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/40 focus:border-[#16803C]/40"
                />
                <select
                  value={txMethod}
                  onChange={(e) => { setTxMethod(e.target.value); setTxPage(1) }}
                  className="px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-sm text-[#17201A] focus:outline-none"
                >
                  <option value="">All methods</option>
                  <option value="cod">COD</option>
                  <option value="gcash">GCash</option>
                </select>
                <select
                  value={txStatus}
                  onChange={(e) => { setTxStatus(e.target.value); setTxPage(1) }}
                  className="px-3 py-2 bg-white border border-[#E2E8E3] rounded-lg text-sm text-[#17201A] focus:outline-none"
                >
                  <option value="">All statuses</option>
                  <option value="completed">Completed</option>
                  <option value="delivered">Delivered</option>
                  <option value="in_transit">In Transit</option>
                  <option value="ready">Ready</option>
                  <option value="preparing">Preparing</option>
                  <option value="waiting_restaurant">Finding Rider</option>
                  <option value="accepted">Accepted</option>
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Order</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Customer</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Restaurant</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Method</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Paid</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {transactions.map((t) => {
                    const colors = METHOD_COLORS[t.payment_method] ?? FALLBACK_METHOD_COLOR
                    return (
                      <tr key={`${t.id}-${t.order_number}`} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 lg:px-6 py-3">
                          <div className="font-medium text-[#17201A]">{t.order_number}</div>
                          {t.is_group && <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">Group checkout</span>}
                        </td>
                        <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{t.customer_name}</td>
                        <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{t.business.business_name}</td>
                        <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                          <span className={`inline-block px-2 py-0.5 rounded-full border text-xs font-semibold ${colors.chip} ${colors.text}`}>
                            {METHOD_LABELS[t.payment_method] ?? capitalize(t.payment_method)}
                          </span>
                        </td>
                        <td className="px-5 lg:px-6 py-3 font-semibold text-[#17201A] whitespace-nowrap">{formatCurrency(t.paid_amount)}</td>
                        <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                          <StatusBadge status={t.status} />
                        </td>
                        <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                          {t.paid_at ? formatDateTime(t.paid_at) : '-'}
                        </td>
                      </tr>
                    )
                  })}
                  {loadingTx && (
                    <tr>
                      <td colSpan={7} className="px-5 lg:px-6 py-10 text-center text-[#6B7280]">Loading transactions...</td>
                    </tr>
                  )}
                  {!loadingTx && transactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-5 lg:px-6 py-10 text-center text-[#6B7280]">No transactions match the current filters.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {txMeta && txMeta.last_page > 1 && (
              <div className="flex items-center justify-between px-5 lg:px-6 py-4 border-t border-[#E2E8E3]">
                <span className="text-xs text-[#6B7280]">
                  Page {txMeta.current_page} of {txMeta.last_page} · {txMeta.total} records
                </span>
                <div className="flex gap-2">
                  <button
                    disabled={txMeta.current_page <= 1}
                    onClick={() => setTxPage(txMeta.current_page - 1)}
                    className="px-3 py-1.5 rounded-lg text-sm border border-[#E2E8E3] bg-white text-[#17201A] disabled:opacity-40 hover:bg-[#F6F8F4] transition"
                  >
                    Prev
                  </button>
                  <button
                    disabled={txMeta.current_page >= txMeta.last_page}
                    onClick={() => setTxPage(txMeta.current_page + 1)}
                    className="px-3 py-1.5 rounded-lg text-sm border border-[#E2E8E3] bg-white text-[#17201A] disabled:opacity-40 hover:bg-[#F6F8F4] transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}