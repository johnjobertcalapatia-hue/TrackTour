import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDate, formatCurrency } from '@/shared/utils'
import { BarChart3, Download } from 'lucide-react'

interface ReportSummary {
  total_users: number
  total_businesses: number
  total_orders: number
  total_revenue: number
  total_bookings: number
  new_users_this_month: number
  new_businesses_this_month: number
}

interface ReportItem {
  id: number
  title: string
  type: string
  status: string
  date_range: string
  created_at: string
}

export default function AdminReports() {
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ['admin-reports-summary', dateFrom, dateTo],
    queryFn: () =>
      get<ReportSummary>('/admin/reports/summary', {
        params: { from: dateFrom || undefined, to: dateTo || undefined },
      }),
  })

  const { data: reportsData } = useQuery({
    queryKey: ['admin-reports', dateFrom, dateTo],
    queryFn: () =>
      get<{ data: ReportItem[] }>('/admin/reports', {
        params: { from: dateFrom || undefined, to: dateTo || undefined },
      }),
  })

  const reports = reportsData?.data ?? []

  const summaryCards = summary ? [
    { label: 'Total Users', value: summary.total_users, icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z', bg: 'bg-[#EAF6ED]', text: 'text-[#16803C]', border: 'border-[#D7E8DB]' },
    { label: 'Total Businesses', value: summary.total_businesses, icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4', bg: 'bg-[#EAF6ED]', text: 'text-[#126B32]', border: 'border-[#D7E8DB]' },
    { label: 'Total Orders', value: summary.total_orders, icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', bg: 'bg-[#EAF6ED]', text: 'text-[#16803C]', border: 'border-[#D7E8DB]' },
    { label: 'Total Revenue', value: formatCurrency(summary.total_revenue), icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1', bg: 'bg-[#FFF7D6]', text: 'text-[#B45309]', border: 'border-[#FDE68A]' },
    { label: 'Bookings', value: summary.total_bookings, icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z', bg: 'bg-[#EAF6ED]', text: 'text-[#126B32]', border: 'border-[#D7E8DB]' },
    { label: 'New Users (Month)', value: summary.new_users_this_month, icon: 'M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z', bg: 'bg-[#EAF6ED]', text: 'text-[#16803C]', border: 'border-[#D7E8DB]' },
  ] : []

  return (
    <div>
      <div className="relative rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6 mb-8 overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <svg className="w-full h-full" viewBox="0 0 800 400" fill="none">
            <path d="M0 200 Q200 100 400 200 T800 200" stroke="#16803C" strokeWidth="2" fill="none" />
            <path d="M0 250 Q200 150 400 250 T800 250" stroke="#126B32" strokeWidth="1.5" fill="none" />
            <circle cx="100" cy="100" r="40" fill="#16803C" opacity="0.1" />
            <circle cx="700" cy="80" r="30" fill="#126B32" opacity="0.1" />
            <path d="M50 300 L150 200 L250 300 Z" fill="#16803C" opacity="0.05" />
            <path d="M600 320 L700 220 L800 320 Z" fill="#126B32" opacity="0.05" />
          </svg>
        </div>
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Reports</h1>
            <p className="mt-1 text-sm lg:text-base text-[#6B7280]">System analytics and report generation</p>
          </div>
          <button className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#16803C] hover:bg-[#126B32] text-white rounded-xl text-sm font-medium transition">
            <Download className="w-4 h-4" />
            Export Report
          </button>
        </div>
      </div>

      <div className="mb-6 flex flex-col sm:flex-row gap-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">From</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-1.5">To</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50"
          />
        </div>
      </div>

      {!loadingSummary && summary && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
          {summaryCards.map((card) => (
            <div key={card.label} className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism p-5 transition-all duration-200 hover:shadow-tourism-lg hover:-translate-y-0.5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">{card.label}</p>
                  <p className="mt-2 text-xl lg:text-2xl font-bold text-[#17201A]">{card.value}</p>
                </div>
                <div className={`w-10 h-10 ${card.bg} border ${card.border} rounded-lg flex items-center justify-center`}>
                  <svg className={`w-5 h-5 ${card.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={card.icon} />
                  </svg>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism overflow-hidden">
        <div className="px-5 lg:px-6 py-4 border-b border-[#E2E8E3] flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-[#16803C]" />
          <h2 className="text-lg font-semibold text-[#17201A]">Generated Reports</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Report</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Type</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date Range</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {reports.map((report) => (
                <tr key={report.id} className="hover:bg-[#F6F8F4] transition-colors">
                  <td className="px-5 lg:px-6 py-3 font-medium text-[#17201A] whitespace-nowrap">{report.title}</td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap capitalize">{report.type.replace(/_/g, ' ')}</td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{report.date_range}</td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <StatusBadge status={report.status} />
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">{formatDate(report.created_at)}</td>
                </tr>
              ))}
              {reports.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No reports generated yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
