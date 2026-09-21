import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import type { Delivery } from '@/shared/types'
import { ChevronLeft, ChevronRight, CheckCircle, ArrowDownLeft, ArrowUpRight, Coins, Motorbike } from 'lucide-react'

interface CreditTransaction {
  id: number
  transaction_type: string
  amount: number
  description: string
  created_at: string
}

type Tab = 'deliveries' | 'rider_hailing' | 'credits'

const ITEMS_PER_PAGE = 10

export default function RiderHistory() {
  const [tab, setTab] = useState<Tab>('deliveries')
  const [page, setPage] = useState(1)

  const { data: deliveriesData, isLoading: deliveriesLoading } = useQuery({
    queryKey: ['rider-deliveries-completed'],
    queryFn: () => get<{ data: Delivery[] }>('/rider/deliveries/completed'),
  })

  const { data: creditsData, isLoading: creditsLoading } = useQuery({
    queryKey: ['rider-credits-transactions'],
    queryFn: () => get<CreditTransaction[]>('/rider/credits/transactions'),
  })

  const deliveries = deliveriesData?.data ?? []
  const credits = creditsData ?? []

  const tabItems: (Delivery | CreditTransaction)[] = tab === 'deliveries' ? deliveries : tab === 'credits' ? credits : []
  const totalPages = Math.ceil(tabItems.length / ITEMS_PER_PAGE)
  const paginated = tabItems.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab)
    setPage(1)
  }

  const getCreditLabel = (type: string) => {
    switch (type) {
      case 'CREDIT_TOPUP': return 'Credit Top-up'
      case 'COD_RESERVE': return 'COD Reserved'
      case 'COD_RELEASE': return 'COD Released'
      case 'CREDIT_ADJUSTMENT': return 'Adjustment'
      default: return type
    }
  }

  const getCreditColor = (type: string) => {
    switch (type) {
      case 'CREDIT_TOPUP':
      case 'COD_RELEASE':
        return 'bg-emerald-50 text-emerald-700'
      case 'COD_RESERVE':
        return 'bg-amber-50 text-amber-700'
      default:
        return 'bg-gray-50 text-gray-700'
    }
  }

  if (deliveriesLoading || creditsLoading) return <DashboardSkeleton />

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">History</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Your deliveries and credit transactions</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F3F8F5] p-1 rounded-xl mb-6">
        <button
          onClick={() => handleTabChange('deliveries')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition ${
            tab === 'deliveries'
              ? 'bg-white text-[#17201B] shadow-sm'
              : 'text-[#6B7280] hover:text-[#17201B]'
          }`}
        >
          <CheckCircle className="w-4 h-4" />
          Deliveries
        </button>
        <button
          onClick={() => handleTabChange('rider_hailing')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition ${
            tab === 'rider_hailing'
              ? 'bg-white text-[#17201B] shadow-sm'
              : 'text-[#6B7280] hover:text-[#17201B]'
          }`}
        >
          <Motorbike className="w-4 h-4" />
          Rider Hailing
        </button>
        <button
          onClick={() => handleTabChange('credits')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition ${
            tab === 'credits'
              ? 'bg-white text-[#17201B] shadow-sm'
              : 'text-[#6B7280] hover:text-[#17201B]'
          }`}
        >
          <Coins className="w-4 h-4" />
          Credits
        </button>
      </div>

      {/* Deliveries Tab */}
      {tab === 'deliveries' && (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E9E7] bg-[#F3F8F5]">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Order ID</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Customer</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Amount</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E9E7]">
                {paginated.map((delivery: any) => (
                  <tr key={delivery.id} className="hover:bg-[#F3F8F5] transition-colors">
                    <td className="px-5 py-3 font-medium text-[#17201B]">#{delivery.id}</td>
                    <td className="px-5 py-3 text-[#4B5563]">{delivery.customer_name ?? '—'}</td>
                    <td className="px-5 py-3">
                      <StatusBadge status={delivery.status} />
                    </td>
                    <td className="px-5 py-3 text-right font-medium text-[#17201B]">
                      ₱{Number(delivery.total_amount ?? 0).toFixed(2)}
                    </td>
                    <td className="px-5 py-3 text-[#6B7280] text-right whitespace-nowrap">
                      {delivery.completed_at ? formatDateTime(delivery.completed_at) : '—'}
                    </td>
                  </tr>
                ))}
                {deliveries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-[#9CA3AF]">No completed deliveries yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Credits Tab */}
      {tab === 'credits' && (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E9E7] bg-[#F3F8F5]">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Type</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Description</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Amount</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E9E7]">
                {paginated.map((tx) => {
                  const creditTx = tx as CreditTransaction
                  return (
                    <tr key={tx.id} className="hover:bg-[#F3F8F5] transition-colors">
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${getCreditColor(creditTx.transaction_type)}`}>
                          {creditTx.transaction_type === 'COD_RESERVE' ? (
                            <ArrowUpRight className="w-3 h-3" />
                          ) : (
                            <ArrowDownLeft className="w-3 h-3" />
                          )}
                          {getCreditLabel(creditTx.transaction_type)}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-[#4B5563]">{creditTx.description}</td>
                      <td className={`px-5 py-3 text-right font-medium whitespace-nowrap ${
                        creditTx.transaction_type === 'CREDIT_TOPUP' || creditTx.transaction_type === 'COD_RELEASE'
                          ? 'text-emerald-600' : 'text-amber-600'
                      }`}>
                        {creditTx.transaction_type === 'COD_RESERVE' ? '-' : '+'}₱{Number(creditTx.amount).toFixed(2)}
                      </td>
                      <td className="px-5 py-3 text-[#6B7280] text-right whitespace-nowrap">
                        {new Date(creditTx.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  )
                })}
                {credits.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-12 text-center text-[#9CA3AF]">No credit transactions yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Rider Hailing Tab */}
      {tab === 'rider_hailing' && (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] shadow-sm overflow-hidden">
          <div className="p-5 text-center text-[#9CA3AF]">
            <Motorbike className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No rider hailing trips yet</p>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-sm text-[#6B7280]">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page === 1}
              className="p-2 rounded-lg border border-[#E5E9E7] text-[#6B7280] hover:bg-[#F3F8F5] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages, page + 1))}
              disabled={page === totalPages}
              className="p-2 rounded-lg border border-[#E5E9E7] text-[#6B7280] hover:bg-[#F3F8F5] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
