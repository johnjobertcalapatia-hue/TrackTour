import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Bike, CalendarCheck, Download, ShoppingBag, Store, UserCheck, Wallet } from 'lucide-react'
import { apiErrorMessage, get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Alert } from '@/shared/components/Alert'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatCurrency, formatDate } from '@/shared/utils'
import { card, inputClass, PageHeader, StatCard } from '@/features/municipal/components/MunicipalUi'
import { MUNICIPAL_API, type CountRow, type MunicipalReport } from '@/features/municipal/types'

const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())
const daysAgo = (n: number) => {
  const d = new Date(`${manilaToday()}T00:00:00`)
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('en-CA')
}

const PRESETS = [
  { label: '7 days', days: 6 },
  { label: '30 days', days: 29 },
  { label: '90 days', days: 89 },
]

function csvCell(value: unknown) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function downloadCsv(report: MunicipalReport, municipality: string) {
  const rows: (string | number)[][] = [
    [`${municipality} tourism report`, `${report.range.from} to ${report.range.to}`],
    [],
    ['Summary', 'Value'],
    ['Orders', report.orders.total],
    ['Completed orders', report.orders.completed],
    ['Item sales from completed orders (PHP)', report.orders.item_sales],
    ['Bookings', report.bookings.total],
    ['Completed booking value (PHP)', report.bookings.completed_value],
    ['Active tourists', report.tourists.active_in_range],
    ['Businesses (all)', report.businesses.total],
    ['Businesses registered in range', report.businesses.registered_in_range],
    ['Riders (all)', report.riders.total],
    ['Riders registered in range', report.riders.registered_in_range],
    ['Deliveries completed by local riders', report.riders.completed_deliveries],
    [],
    ['Date', 'Orders'],
    ...report.orders.trend.map((d) => [d.date, d.orders]),
    [],
    ['Top business', 'Completed orders', 'Item sales (PHP)'],
    ...report.top_businesses.map((b) => [b.business_name, b.orders, b.sales]),
    [],
    ['Business category', 'Count'],
    ...report.businesses.by_category.map((c) => [c.category ?? '', c.total]),
  ]
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${municipality.toLowerCase().replace(/\s+/g, '-')}-report-${report.range.from}-to-${report.range.to}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function MunicipalReports() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(manilaToday())
  const [showTable, setShowTable] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['municipal', 'reports', from, to],
    queryFn: () => get<MunicipalReport>(MUNICIPAL_API.REPORTS, { params: { from, to } }),
  })
  const { data: profile } = useQuery({
    queryKey: ['municipal', 'profile'],
    queryFn: () => get<{ municipality: { name: string } }>(MUNICIPAL_API.PROFILE),
    staleTime: 5 * 60_000,
  })
  const municipality = profile?.municipality.name ?? 'Municipality'

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle={`${municipality} statistics for the selected period. Sales include only this municipality's businesses.`}
        actions={
          data && (
            <button
              type="button"
              onClick={() => downloadCsv(data, municipality)}
              className="px-4 py-2 rounded-xl text-sm font-semibold bg-[#0F2E1D] text-white hover:bg-[#18402A] inline-flex items-center gap-2"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
          )
        }
      />

      <div className={`${card} mb-5 p-4 flex flex-wrap items-end gap-3`}>
        <div className="flex gap-2" role="group" aria-label="Quick ranges">
          {PRESETS.map((p) => {
            const active = from === daysAgo(p.days) && to === manilaToday()
            return (
              <button
                key={p.label}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setFrom(daysAgo(p.days))
                  setTo(manilaToday())
                }}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border ${active ? 'bg-[#2E8B57] border-[#2E8B57] text-white' : 'border-[#CFE5D7] text-[#2E8B57] hover:bg-[#F1F7F3]'}`}
              >
                Last {p.label}
              </button>
            )
          })}
        </div>
        <label className="text-xs font-medium text-[#66736B]">
          From
          <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="text-xs font-medium text-[#66736B]">
          To
          <input type="date" value={to} min={from} max={manilaToday()} onChange={(e) => e.target.value && setTo(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
      </div>

      {isLoading ? (
        <DashboardSkeleton />
      ) : error || !data ? (
        <Alert type="error" message={apiErrorMessage(error, 'Could not load the report.')} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
            <StatCard label="Orders" value={data.orders.total} hint={`${data.orders.completed} completed`} icon={ShoppingBag} />
            <StatCard label="Item sales (completed orders)" value={formatCurrency(data.orders.item_sales)} hint="Local businesses' share only" icon={Wallet} />
            <StatCard label="Bookings" value={data.bookings.total} hint={`${formatCurrency(data.bookings.completed_value)} completed value`} icon={CalendarCheck} tone="blue" />
            <StatCard label="Active tourists" value={data.tourists.active_in_range} hint="Ordered or booked in this period" icon={UserCheck} tone="blue" />
            <StatCard label="New businesses" value={data.businesses.registered_in_range} hint={`${data.businesses.total} registered in total`} icon={Store} />
            <StatCard label="Local rider deliveries" value={data.riders.completed_deliveries} hint={`${data.riders.registered_in_range} new riders · ${data.riders.total} total`} icon={Bike} />
          </div>

          <section className={`${card} mb-6`} aria-label="Orders per day">
            <div className="px-5 py-4 border-b border-[#E7E2D6] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[#1C2B22]">Orders per day</h2>
                <p className="text-xs text-[#66736B]">
                  {formatDate(data.range.from)} – {formatDate(data.range.to)} · Philippine time
                </p>
              </div>
              <button type="button" onClick={() => setShowTable((v) => !v)} className="text-xs font-semibold text-[#2E8B57] hover:underline">
                {showTable ? 'Show chart' : 'Show table'}
              </button>
            </div>
            {showTable ? (
              <div className="max-h-80 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-[#FAF7F0]">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wider text-[#66736B]">
                      <th className="px-5 py-2">Date</th>
                      <th className="px-5 py-2 text-right">Orders</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1EDE3]">
                    {data.orders.trend.map((d) => (
                      <tr key={d.date}>
                        <td className="px-5 py-2 text-[#1C2B22]">{formatDate(d.date)}</td>
                        <td className="px-5 py-2 text-right tabular-nums text-[#1C2B22]">{d.orders}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-64 px-2 py-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.orders.trend} margin={{ top: 4, right: 12, bottom: 0, left: -12 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke="#EEE9DD" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}
                      tick={{ fontSize: 11, fill: '#66736B' }}
                      axisLine={{ stroke: '#E7E2D6' }}
                      tickLine={false}
                      minTickGap={24}
                    />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#66736B' }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip
                      cursor={{ fill: '#E6F2EB' }}
                      content={({ active, payload, label }) =>
                        active && payload?.length ? (
                          <div className="rounded-lg border border-[#E7E2D6] bg-white px-3 py-2 text-xs shadow-md">
                            <p className="text-[#66736B]">{formatDate(String(label))}</p>
                            <p className="font-semibold text-[#1C2B22]">{payload[0]?.value} orders</p>
                          </div>
                        ) : null
                      }
                    />
                    <Bar dataKey="orders" fill="#2E8B57" radius={[4, 4, 0, 0]} maxBarSize={18} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className={`${card} overflow-hidden`} aria-label="Top businesses">
              <h2 className="px-5 py-4 border-b border-[#E7E2D6] text-sm font-semibold text-[#1C2B22]">Top businesses by item sales</h2>
              {data.top_businesses.length === 0 ? (
                <p className="px-5 py-6 text-sm text-[#66736B]">No completed orders in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[#FAF7F0] text-left text-xs font-semibold uppercase tracking-wider text-[#66736B]">
                      <th className="px-5 py-2">Business</th>
                      <th className="px-5 py-2 text-right">Orders</th>
                      <th className="px-5 py-2 text-right">Sales</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F1EDE3]">
                    {data.top_businesses.map((b) => (
                      <tr key={b.id}>
                        <td className="px-5 py-2.5 text-[#1C2B22]">{b.business_name}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums">{b.orders}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums font-medium">{formatCurrency(b.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <BreakdownTable title="Businesses by category" rows={data.businesses.by_category} labelKey="category" />
            <BreakdownTable title="Orders by status" rows={data.orders.by_status} labelKey="status" badge />
            <BreakdownTable title="Business status" rows={data.businesses.by_status} labelKey="status" badge />
            <BreakdownTable title="Rider accounts" rows={data.riders.by_status} labelKey="status" badge />
            <BreakdownTable title="Bookings by status" rows={data.bookings.by_status} labelKey="status" badge />
          </div>
        </>
      )}
    </div>
  )
}

function BreakdownTable({ title, rows, labelKey, badge }: { title: string; rows: CountRow[]; labelKey: 'status' | 'category'; badge?: boolean }) {
  const total = rows.reduce((sum, r) => sum + Number(r.total), 0)
  return (
    <section className={`${card} overflow-hidden`} aria-label={title}>
      <h2 className="px-5 py-4 border-b border-[#E7E2D6] text-sm font-semibold text-[#1C2B22]">{title}</h2>
      {rows.length === 0 ? (
        <p className="px-5 py-6 text-sm text-[#66736B]">No records.</p>
      ) : (
        <ul className="divide-y divide-[#F1EDE3]">
          {rows.map((r) => {
            const label = String(r[labelKey] ?? 'Unknown')
            const share = total ? Math.round((Number(r.total) / total) * 100) : 0
            return (
              <li key={label} className="px-5 py-2.5 flex items-center justify-between gap-3 text-sm">
                {badge ? <StatusBadge status={label} /> : <span className="text-[#1C2B22]">{label}</span>}
                <span className="tabular-nums text-[#1C2B22]">
                  {r.total} <span className="text-xs text-[#66736B]">· {share}%</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
