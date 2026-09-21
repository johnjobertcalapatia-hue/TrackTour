import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch, post } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import type { Order } from '@/shared/types'
import { ChevronLeft, ChevronRight, Filter, CheckCircle, XCircle } from 'lucide-react'

const ITEMS_PER_PAGE = 8
const STATUS_FILTERS = ['all', 'waiting_restaurant', 'accepted', 'preparing', 'ready', 'picked_up', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'rejected']

export default function BusinessOwnerOrders() {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('all')
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-orders', selectedBusinessId],
    queryFn: () => {
      const params = new URLSearchParams()
      if (selectedBusinessId) params.set('business_id', String(selectedBusinessId))
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const qs = params.toString()
      return get<{ data: Order[] }>(`/business-owner/orders${qs ? `?${qs}` : ''}`)
    },
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      patch(`/business-owner/orders/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-orders'] }),
  })

  const acceptMutation = useMutation({
    mutationFn: (id: number) => post(`/business-owner/orders/${id}/accept`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-orders'] }),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: number) => post(`/business-owner/orders/${id}/reject`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-orders'] }),
  })

  if (isLoading) return <DashboardSkeleton />

  const allOrders = data?.data ?? []
  const filtered = statusFilter === 'all' ? allOrders : allOrders.filter((o) => o.status === statusFilter)
  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Orders</h1>
        <p className="mt-1 text-sm text-[#647067]">Manage incoming orders</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Filter className="w-4 h-4 text-[#647067]" />
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => { setStatusFilter(s); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === s
                ? 'bg-[#16803C] text-white'
                : 'bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4]'
            }`}
          >
            {s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <p className="text-[#647067]">No orders found.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Order #</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Customer</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Status</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Total</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Date</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {paginated.map((order) => (
                    <tr key={order.id} className="hover:bg-[#F6F8F4] transition-colors">
                      <td className="px-5 lg:px-6 py-3 font-medium text-[#17201A] whitespace-nowrap">
                        {order.order_number}
                        {order.group_reference_number && (
                          <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                            {order.group_reference_number}
                          </span>
                        )}
                      </td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap">{order.customer_name}</td>
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap"><StatusBadge status={order.status} /></td>
                      <td className="px-5 lg:px-6 py-3 text-right font-medium text-[#17201A] whitespace-nowrap">{formatCurrency(order.total)}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#647067] whitespace-nowrap">{formatDateTime(order.created_at)}</td>
                      <td className="px-5 lg:px-6 py-3 text-right whitespace-nowrap">
                        {order.status === 'waiting_restaurant' && (
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => acceptMutation.mutate(order.id)}
                              disabled={acceptMutation.isPending}
                              className="text-xs bg-[#16803C] hover:bg-[#126B32] text-white px-3 py-1.5 rounded-lg transition inline-flex items-center gap-1"
                            >
                              <CheckCircle className="w-3 h-3" />
                              Accept
                            </button>
                            <button
                              onClick={() => rejectMutation.mutate(order.id)}
                              disabled={rejectMutation.isPending}
                              className="text-xs bg-white border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition inline-flex items-center gap-1"
                            >
                              <XCircle className="w-3 h-3" />
                              Reject
                            </button>
                          </div>
                        )}
                        {order.status === 'accepted' && (
                          <button onClick={() => statusMutation.mutate({ id: order.id, status: 'preparing' })} className="text-xs bg-[#16803C] hover:bg-[#126B32] text-white px-3 py-1.5 rounded-lg transition">
                            Prepare
                          </button>
                        )}
                        {order.status === 'preparing' && (
                          <button onClick={() => statusMutation.mutate({ id: order.id, status: 'ready' })} className="text-xs bg-[#16803C] hover:bg-[#126B32] text-white px-3 py-1.5 rounded-lg transition">
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
              <p className="text-sm text-[#647067]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#647067]">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
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
