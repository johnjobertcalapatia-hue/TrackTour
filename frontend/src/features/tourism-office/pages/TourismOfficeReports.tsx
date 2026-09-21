import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency } from '@/shared/utils'
import { TrendingUp, Package, Users, Building2 } from 'lucide-react'

interface ReportsData {
  summary: {
    total_businesses: number
    total_orders: number
    total_revenue: number
    total_tourists: number
  }
  monthly_data: { month: string; orders: number; revenue: number }[]
  category_breakdown: { category: string; count: number }[]
  municipality_breakdown: { municipality: string; businesses: number; orders: number; revenue: number }[]
}

export default function TourismOfficeReports() {
  const { data, isLoading } = useQuery({
    queryKey: ['to-reports'],
    queryFn: () => get<ReportsData>('/tourism-office/reports'),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className="text-center py-20 text-gray-400">Unable to load reports.</div>

  const { summary, monthly_data: monthly, category_breakdown: categories, municipality_breakdown: municipalities } = data

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Reports</h1>
        <p className="mt-1 text-sm text-gray-400">Tourism office analytics and reports</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-blue-900/20 border border-blue-800 rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-900/30 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-300">Businesses</p>
              <p className="text-2xl font-bold text-gray-100">{summary.total_businesses}</p>
            </div>
          </div>
        </div>
        <div className="bg-emerald-900/20 border border-emerald-800 rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-900/30 rounded-xl flex items-center justify-center">
              <Package className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Orders</p>
              <p className="text-2xl font-bold text-gray-100">{summary.total_orders}</p>
            </div>
          </div>
        </div>
        <div className="bg-purple-900/20 border border-purple-800 rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-purple-900/30 rounded-xl flex items-center justify-center">
              <Users className="w-5 h-5 text-purple-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-purple-300">Tourists</p>
              <p className="text-2xl font-bold text-gray-100">{summary.total_tourists}</p>
            </div>
          </div>
        </div>
        <div className="bg-amber-900/20 border border-amber-800 rounded-2xl p-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-900/30 rounded-xl flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Revenue</p>
              <p className="text-2xl font-bold text-gray-100">{formatCurrency(summary.total_revenue)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {categories.length > 0 && (
          <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5">
            <div className="px-6 py-4 border-b border-gray-800/50">
              <h2 className="text-lg font-semibold text-gray-100">Business Categories</h2>
            </div>
            <div className="p-6 space-y-4">
              {categories.map((c, i) => {
                const maxCount = Math.max(...categories.map((x) => x.count))
                const pct = maxCount > 0 ? (c.count / maxCount) * 100 : 0
                return (
                  <div key={i}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-300">{c.category}</span>
                      <span className="text-sm font-medium text-gray-100">{c.count}</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-2">
                      <div className="bg-emerald-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {municipalities.length > 0 && (
          <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5">
            <div className="px-6 py-4 border-b border-gray-800/50">
              <h2 className="text-lg font-semibold text-gray-100">Municipality Breakdown</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/50 bg-gray-800/30">
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Municipality</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Businesses</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Orders</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {municipalities.map((m, i) => (
                    <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-6 py-3 text-gray-100 whitespace-nowrap">{m.municipality}</td>
                      <td className="px-6 py-3 text-right text-gray-300 whitespace-nowrap">{m.businesses}</td>
                      <td className="px-6 py-3 text-right text-gray-300 whitespace-nowrap">{m.orders}</td>
                      <td className="px-6 py-3 text-right font-medium text-gray-100 whitespace-nowrap">{formatCurrency(m.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {monthly.length > 0 && (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5">
          <div className="px-6 py-4 border-b border-gray-800/50">
            <h2 className="text-lg font-semibold text-gray-100">Monthly Performance</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800/50 bg-gray-800/30">
                  <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Month</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Orders</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {monthly.map((m, i) => (
                  <tr key={i} className="hover:bg-gray-800/30 transition-colors">
                    <td className="px-6 py-3 text-gray-100 whitespace-nowrap">{m.month}</td>
                    <td className="px-6 py-3 text-right text-gray-300 whitespace-nowrap">{m.orders}</td>
                    <td className="px-6 py-3 text-right font-medium text-gray-100 whitespace-nowrap">{formatCurrency(m.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
