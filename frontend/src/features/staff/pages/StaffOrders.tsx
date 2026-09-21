import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import type { Order } from '@/shared/types'
import { ChevronLeft, ChevronRight, Filter } from 'lucide-react'

const ITEMS_PER_PAGE = 8
const STATUS_FILTERS = ['all', 'waiting_restaurant', 'accepted', 'preparing', 'ready', 'completed', 'cancelled', 'rejected']

export default function StaffOrders() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')

  const { data, isLoading } = useQuery({
    queryKey: ['staff-orders'],
    queryFn: () => get<{ data: Order[] }>('/staff/orders'),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      patch(`/staff/orders/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['staff-orders'] }),
  })

  if (isLoading) return <DashboardSkeleton />

  const allOrders = data?.data ?? []
  const filtered = statusFilter === 'all' ? allOrders : allOrders.filter((o) => o.status === statusFilter)
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Orders</h1>
        <p className="mt-1 text-sm text-gray-400">Manage and update order statuses</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Filter className="w-4 h-4 text-gray-400" />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === s
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
            }`}
          >
            {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 p-12 text-center">
          <p className="text-gray-400">No orders found.</p>
        </div>
      ) : (
        <>
          <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-gray-700/30 shadow-lg shadow-black/5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800/50 bg-gray-800/30">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Order #</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Total</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Date</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {paginated.map((order) => (
                    <tr key={order.id} className="hover:bg-gray-800/30 transition-colors">
                      <td className="px-5 lg:px-6 py-3 font-medium text-gray-100 whitespace-nowrap">{order.order_number}</td>
                      <td className="px-5 lg:px-6 py-3 text-gray-300 whitespace-nowrap">{order.customer_name}</td>
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap"><StatusBadge status={order.status} /></td>
                      <td className="px-5 lg:px-6 py-3 text-right font-medium text-gray-100 whitespace-nowrap">{formatCurrency(order.total)}</td>
                      <td className="px-5 lg:px-6 py-3 text-gray-400 whitespace-nowrap">{formatDateTime(order.created_at)}</td>
                      <td className="px-5 lg:px-6 py-3 text-right whitespace-nowrap">
                        {order.status === 'preparing' && (
                          <button onClick={() => statusMutation.mutate({ id: order.id, status: 'preparing' })} className="text-xs bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg transition">
                            Prepare
                          </button>
                        )}
                        {order.status === 'preparing' && (
                          <button onClick={() => statusMutation.mutate({ id: order.id, status: 'ready' })} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg transition">
                            Ready
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-400">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-gray-400">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 disabled:opacity-40 transition">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
