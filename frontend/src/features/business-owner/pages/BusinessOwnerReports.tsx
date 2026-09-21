import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency } from '@/shared/utils'
import { TrendingUp, Package, CalendarCheck, DollarSign, Filter, RefreshCw, BarChart3, Layers, Download, FileText, FileSpreadsheet } from 'lucide-react'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import type { Business } from '@/shared/types'

interface SalesSummary {
  total_revenue: string | number
  total_orders: number
  average_order_value: string | number
}

interface SalesRow {
  date: string
  total_orders: number
  total_revenue: string | number
}

interface SalesReportResponse {
  sales_data: SalesRow[]
  summary: SalesSummary
  period: string
}

interface OrderStatusRow {
  status: string
  count: number
  revenue: string | number
}

interface OrdersReportResponse {
  orders: OrderStatusRow[]
  total_orders: number
  total_revenue: string | number
}

interface BookingStatusRow {
  status: string
  count: number
  revenue: string | number
}

interface BookingTypeRow {
  booking_type?: string
  type?: string
  count: number
  revenue: string | number
}

interface BookingsReportResponse {
  bookings_by_status: BookingStatusRow[]
  bookings_by_type: BookingTypeRow[]
  total_bookings: number
  total_revenue: string | number
}

const CHART_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

function buildExportUrl(type: string, format: string, queryString: string): string {
  const base = `/api/business-owner/exports/${format}?type=${type}${queryString ? '&' + queryString : ''}`
  return base
}

function SalesChart({ data }: { data: SalesRow[] }) {
  if (!data || data.length === 0) return null
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8E3] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
      <h3 className="font-semibold text-[#17201A] mb-4">Revenue Trend</h3>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8E3" />
          <XAxis dataKey="date" tick={{ fill: '#647067', fontSize: 11 }} tickLine={false} />
          <YAxis tick={{ fill: '#647067', fontSize: 11 }} tickLine={false} />
          <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #E2E8E3', borderRadius: 8, color: '#647067' }} />
          <Bar dataKey="total_revenue" fill="#16803C" radius={[4, 4, 0, 0]} name="Revenue" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function StatusPieChart({ data, labelKey, valueKey }: { data: any[]; labelKey: string; valueKey: string }) {
  if (!data || data.length === 0) return null
  return (
    <div className="bg-white rounded-2xl border border-[#E2E8E3] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
      <h3 className="font-semibold text-[#17201A] mb-4">Distribution</h3>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie data={data} dataKey={valueKey} nameKey={labelKey} cx="50%" cy="50%" outerRadius={80} label={({ [labelKey]: name, [valueKey]: val }) => `${name} (${val})`}>
            {data.map((_, idx) => <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />)}
          </Pie>
          <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #E2E8E3', borderRadius: 8, color: '#647067' }} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export default function BusinessOwnerReports() {
  const [activeTab, setActiveTab] = useState<'sales' | 'orders' | 'bookings'>('sales')
  const globalSelectedId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const [selectedBusiness, setSelectedBusiness] = useState(globalSelectedId ? String(globalSelectedId) : '')
  const [selectedBusinessType, setSelectedBusinessType] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState<'weekly' | 'monthly' | 'yearly'>('monthly')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const initialSyncDone = useRef(false)
  useEffect(() => {
    if (!initialSyncDone.current && globalSelectedId) {
      setSelectedBusiness(String(globalSelectedId))
      initialSyncDone.current = true
    }
  }, [globalSelectedId])

  const { data: businessesResponse, isLoading: loadingBusinesses } = useQuery({
    queryKey: ['bo-businesses'],
    queryFn: () => get<{ data: Business[] }>('/business-owner/businesses'),
  })
  const businesses = businessesResponse?.data ?? []

  const businessTypes = useMemo(() => {
    const types = new Set<string>()
    for (const biz of businesses) {
      if ((biz as any).category) types.add((biz as any).category)
    }
    return Array.from(types).sort()
  }, [businesses])

  const queryParams = new URLSearchParams()
  if (selectedBusiness) queryParams.set('business_id', selectedBusiness)
  if (selectedBusinessType) queryParams.set('business_type', selectedBusinessType)
  if (activeTab === 'sales') queryParams.set('period', selectedPeriod)
  if (dateFrom) queryParams.set('from', dateFrom)
  if (dateTo) queryParams.set('to', dateTo)
  const queryString = queryParams.toString()

  const { data: salesReport, isLoading: salesLoading, refetch: refetchSales } = useQuery<SalesReportResponse>({
    queryKey: ['bo-reports-sales', queryString],
    queryFn: () => get<SalesReportResponse>(`/business-owner/reports/sales?${queryString}`),
    enabled: activeTab === 'sales',
  })

  const { data: ordersReport, isLoading: ordersLoading, refetch: refetchOrders } = useQuery<OrdersReportResponse>({
    queryKey: ['bo-reports-orders', queryString],
    queryFn: () => get<OrdersReportResponse>(`/business-owner/reports/orders?${queryString}`),
    enabled: activeTab === 'orders',
  })

  const { data: bookingsReport, isLoading: bookingsLoading, refetch: refetchBookings } = useQuery<BookingsReportResponse>({
    queryKey: ['bo-reports-bookings', queryString],
    queryFn: () => get<BookingsReportResponse>(`/business-owner/reports/bookings?${queryString}`),
    enabled: activeTab === 'bookings',
  })

  const isLoading = loadingBusinesses || (activeTab === 'sales' && salesLoading) || (activeTab === 'orders' && ordersLoading) || (activeTab === 'bookings' && bookingsLoading)

  const handleRefresh = () => {
    if (activeTab === 'sales') refetchSales()
    else if (activeTab === 'orders') refetchOrders()
    else if (activeTab === 'bookings') refetchBookings()
  }

  const exportType = activeTab === 'sales' ? 'sales' : activeTab === 'orders' ? 'orders' : 'bookings'

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] flex items-center gap-2">
            <BarChart3 className="w-8 h-8 text-[#16803C]" />
            Business Reports
          </h1>
          <p className="mt-1 text-sm text-[#647067]">Track and analyze your business performance metrics</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-white text-[#16803C] rounded-xl text-sm font-medium border border-[#D7E8DB] hover:bg-[#F3F8F4] transition"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        </div>
      </div>

      <div className="border-b border-[#E2E8E3] flex gap-2">
        <button onClick={() => setActiveTab('sales')} className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all ${activeTab === 'sales' ? 'border-[#16803C] text-[#16803C] font-bold' : 'border-transparent text-[#647067] hover:text-[#17201A]'}`}>Sales Reports</button>
        <button onClick={() => setActiveTab('orders')} className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all ${activeTab === 'orders' ? 'border-[#16803C] text-[#16803C] font-bold' : 'border-transparent text-[#647067] hover:text-[#17201A]'}`}>Order Reports</button>
        <button onClick={() => setActiveTab('bookings')} className={`pb-3 px-4 text-sm font-semibold border-b-2 transition-all ${activeTab === 'bookings' ? 'border-[#16803C] text-[#16803C] font-bold' : 'border-transparent text-[#647067] hover:text-[#17201A]'}`}>Booking Reports</button>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] p-5 lg:p-6 shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
        <div className="flex items-center gap-2 mb-4 pb-2 border-b border-[#E2E8E3]">
          <Filter className="w-5 h-5 text-[#16803C]" />
          <h3 className="text-sm font-semibold text-[#17201A]">Filter Records</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div>
            <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Business</label>
            <select value={selectedBusiness} onChange={(e) => { setSelectedBusiness(e.target.value); setSelectedBusinessType('') }} className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
              <option value="">All</option>
              {businesses.map((biz) => (<option key={biz.id} value={biz.id}>{biz.name}</option>))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Business Type</label>
            <select value={selectedBusinessType} onChange={(e) => { setSelectedBusinessType(e.target.value); setSelectedBusiness('') }} className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
              <option value="">All types</option>
              {businessTypes.map((type) => (<option key={type} value={type}>{type}</option>))}
            </select>
          </div>
          {activeTab === 'sales' && (
            <div>
              <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Period</label>
              <select value={selectedPeriod} onChange={(e) => setSelectedPeriod(e.target.value as any)} className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition">
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Date From</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#647067] uppercase tracking-wider mb-1.5">Date To</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition" />
          </div>
        </div>
      </div>

      {/* Export buttons */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-[#647067] uppercase tracking-wider">Export:</span>
        <a href={buildExportUrl(exportType, 'pdf', queryString)} download className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#FEF2F2] border border-[#FECACA] text-[#B91C1C] rounded-xl text-xs font-medium hover:bg-[#FEE2E2] transition">
          <FileText className="w-3.5 h-3.5" /> PDF
        </a>
        <a href={buildExportUrl(exportType, 'csv', queryString)} download className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#EAF6ED] border border-[#BFE3CB] text-[#16803C] rounded-xl text-xs font-medium hover:bg-[#D7E8DB] transition">
          <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
        </a>
        <a href={buildExportUrl(exportType, 'excel', queryString)} download className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#EAF6ED] border border-[#BFE3CB] text-[#16803C] rounded-xl text-xs font-medium hover:bg-[#D7E8DB] transition">
          <Download className="w-3.5 h-3.5" /> Excel
        </a>
      </div>

      {isLoading ? (
        <DashboardSkeleton />
      ) : (
        <>
          {activeTab === 'sales' && salesReport && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white rounded-2xl border border-[#E2E8E3] p-5 lg:p-6 shadow-[0_6px_18px_rgba(22,101,52,0.06)] flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#EAF6ED] border border-[#D7E8DB] text-[#16803C] rounded-xl flex items-center justify-center shrink-0"><DollarSign className="w-6 h-6" /></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">Total Revenue</p><p className="mt-1 text-2xl font-bold text-[#17201A]">{formatCurrency(Number(salesReport.summary.total_revenue))}</p></div>
                </div>
                <div className="bg-white rounded-2xl border border-[#E2E8E3] p-5 lg:p-6 shadow-[0_6px_18px_rgba(22,101,52,0.06)] flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#EAF6ED] border border-[#D7E8DB] text-[#16803C] rounded-xl flex items-center justify-center shrink-0"><Package className="w-6 h-6" /></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">Total Orders</p><p className="mt-1 text-2xl font-bold text-[#17201A]">{salesReport.summary.total_orders}</p></div>
                </div>
                <div className="bg-white rounded-2xl border border-[#E2E8E3] p-5 lg:p-6 shadow-[0_6px_18px_rgba(22,101,52,0.06)] flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#EAF6ED] border border-[#D7E8DB] text-[#16803C] rounded-xl flex items-center justify-center shrink-0"><TrendingUp className="w-6 h-6" /></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">Avg Order Value</p><p className="mt-1 text-2xl font-bold text-[#17201A]">{formatCurrency(Number(salesReport.summary.average_order_value))}</p></div>
                </div>
              </div>

              <SalesChart data={salesReport.sales_data} />

              <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
                <div className="px-5 lg:px-6 py-4 border-b border-[#E2E8E3]"><h3 className="font-semibold text-[#17201A]">Daily Sales Records</h3></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead><tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]"><th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Date</th><th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067] text-center">Orders</th><th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067] text-right">Revenue</th></tr></thead>
                    <tbody className="divide-y divide-[#E2E8E3]">
                      {salesReport.sales_data.length === 0 ? (
                        <tr><td colSpan={3} className="px-6 py-12 text-center text-[#647067]">No sales data found for the selected filter.</td></tr>
                      ) : (
                        salesReport.sales_data.map((row, idx) => (
                          <tr key={idx} className="hover:bg-[#F6F8F4] transition-colors">
                            <td className="px-6 py-4 font-medium text-[#17201A]">{row.date}</td>
                            <td className="px-6 py-4 text-center text-[#4B5563]">{row.total_orders}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[#16803C]">{formatCurrency(Number(row.total_revenue))}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'orders' && ordersReport && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-[#E2E8E3] p-5 lg:p-6 shadow-[0_6px_18px_rgba(22,101,52,0.06)] flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#EAF6ED] border border-[#D7E8DB] text-[#16803C] rounded-xl flex items-center justify-center shrink-0"><Package className="w-6 h-6" /></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">Total Orders</p><p className="mt-1 text-2xl font-bold text-[#17201A]">{ordersReport.total_orders}</p></div>
                </div>
                <div className="bg-white rounded-2xl border border-[#E2E8E3] p-5 lg:p-6 shadow-[0_6px_18px_rgba(22,101,52,0.06)] flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#EAF6ED] border border-[#D7E8DB] text-[#16803C] rounded-xl flex items-center justify-center shrink-0"><DollarSign className="w-6 h-6" /></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">Total Revenue</p><p className="mt-1 text-2xl font-bold text-[#17201A]">{formatCurrency(Number(ordersReport.total_revenue))}</p></div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <StatusPieChart data={ordersReport.orders} labelKey="status" valueKey="count" />
                <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
                  <div className="px-5 lg:px-6 py-4 border-b border-[#E2E8E3]"><h3 className="font-semibold text-[#17201A]">Orders by Status</h3></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead><tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]"><th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Status</th><th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067] text-center">Count</th><th className="px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067] text-right">Revenue</th></tr></thead>
                      <tbody className="divide-y divide-[#E2E8E3]">
                        {ordersReport.orders.map((row, idx) => (
                          <tr key={idx} className="hover:bg-[#F6F8F4] transition-colors">
                            <td className="px-6 py-4"><span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold ${row.status === 'completed' ? 'bg-[#EAF6ED] text-[#16803C]' : row.status === 'pending' ? 'bg-[#FFF7D6] text-[#A66F00]' : row.status === 'cancelled' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#EAF6ED] text-[#16803C]'} border`}>{row.status.toUpperCase()}</span></td>
                            <td className="px-6 py-4 text-center text-[#4B5563]">{row.count}</td>
                            <td className="px-6 py-4 text-right font-semibold text-[#16803C]">{formatCurrency(Number(row.revenue))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'bookings' && bookingsReport && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl border border-[#E2E8E3] p-5 lg:p-6 shadow-[0_6px_18px_rgba(22,101,52,0.06)] flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#EAF6ED] border border-[#D7E8DB] text-[#16803C] rounded-xl flex items-center justify-center shrink-0"><CalendarCheck className="w-6 h-6" /></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">Total Bookings</p><p className="mt-1 text-2xl font-bold text-[#17201A]">{bookingsReport.total_bookings}</p></div>
                </div>
                <div className="bg-white rounded-2xl border border-[#E2E8E3] p-5 lg:p-6 shadow-[0_6px_18px_rgba(22,101,52,0.06)] flex items-center gap-4">
                  <div className="w-12 h-12 bg-[#EAF6ED] border border-[#D7E8DB] text-[#16803C] rounded-xl flex items-center justify-center shrink-0"><DollarSign className="w-6 h-6" /></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">Total Revenue</p><p className="mt-1 text-2xl font-bold text-[#17201A]">{formatCurrency(Number(bookingsReport.total_revenue))}</p></div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <StatusPieChart data={bookingsReport.bookings_by_status} labelKey="status" valueKey="count" />
                <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
                  <div className="px-5 lg:px-6 py-4 border-b border-[#E2E8E3] flex items-center gap-2"><Layers className="w-4 h-4 text-[#16803C]" /><h3 className="font-semibold text-[#17201A]">Bookings by Status</h3></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm border-collapse">
                      <thead><tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]"><th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Status</th><th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067] text-center">Count</th><th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067] text-right">Revenue</th></tr></thead>
                      <tbody className="divide-y divide-[#E2E8E3]">
                        {bookingsReport.bookings_by_status.map((row, idx) => (
                          <tr key={idx} className="hover:bg-[#F6F8F4] transition-colors">
                            <td className="px-5 py-3.5"><span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${row.status === 'confirmed' || row.status === 'approved' ? 'bg-[#EAF6ED] text-[#16803C]' : row.status === 'pending' ? 'bg-[#FFF7D6] text-[#A66F00]' : row.status === 'cancelled' ? 'bg-[#FEF2F2] text-[#B91C1C]' : 'bg-[#EAF6ED] text-[#16803C]'} border`}>{row.status.toUpperCase()}</span></td>
                            <td className="px-5 py-3.5 text-center text-[#4B5563]">{row.count}</td>
                            <td className="px-5 py-3.5 text-right font-medium text-[#16803C]">{formatCurrency(Number(row.revenue))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
                <div className="px-5 lg:px-6 py-4 border-b border-[#E2E8E3] flex items-center gap-2"><Layers className="w-4 h-4 text-[#16803C]" /><h3 className="font-semibold text-[#17201A]">Bookings by Type</h3></div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead><tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]"><th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Type</th><th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067] text-center">Count</th><th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067] text-right">Revenue</th></tr></thead>
                    <tbody className="divide-y divide-[#E2E8E3]">
                      {bookingsReport.bookings_by_type.map((row, idx) => (
                        <tr key={idx} className="hover:bg-[#F6F8F4] transition-colors">
                          <td className="px-5 py-3.5 text-[#17201A] font-medium capitalize">{String(row.booking_type || row.type || 'Standard').replace(/_/g, ' ')}</td>
                          <td className="px-5 py-3.5 text-center text-[#4B5563]">{row.count}</td>
                          <td className="px-5 py-3.5 text-right font-medium text-[#16803C]">{formatCurrency(Number(row.revenue))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
