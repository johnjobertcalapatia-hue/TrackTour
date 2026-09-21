import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { CheckCircle2, ClipboardList, Eye, XCircle, ShoppingBag, Package } from 'lucide-react'

interface OrderSummary {
  id: number
  order_number: string
  business_name: string
  status: string
  total: number
  created_at: string
}

interface GroupOrderSummary {
  id: number
  reference_number: string
  status: string
  grand_total: number
  paid_amount: number
  delivery_address?: string | null
  created_at: string
  orders?: { id: number; order_number: string; business?: { name: string } | null }[]
}

interface OrdersResponse {
  orders?: {
    data?: OrderSummary[]
  }
  group_orders?: {
    data?: GroupOrderSummary[]
  }
}

const ORDER_STEPS = [
  { key: 'waiting_restaurant', label: 'Waiting' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'out_for_delivery', label: 'Delivery' },
  { key: 'delivered', label: 'Completed' },
]

const STATUS_ALIASES: Record<string, string> = {
  pending_payment: 'waiting_restaurant',
  picked_up: 'out_for_delivery',
  on_the_way: 'out_for_delivery',
  completed: 'delivered',
}

function getProgress(status: string) {
  const normalizedStatus = STATUS_ALIASES[status] ?? status
  const stepIndex = ORDER_STEPS.findIndex((step) => step.key === normalizedStatus)
  return {
    normalizedStatus,
    stepIndex: stepIndex < 0 ? 0 : stepIndex,
    rejected: ['rejected', 'cancelled', 'cancelled_by_tourist'].includes(status),
  }
}

function getCardTone(status: string) {
  if (['completed', 'delivered'].includes(status)) {
    return {
      card: 'bg-white/40 border-[#087F3F]/40 shadow-[0_8px_32px_-12px_rgba(8,127,63,0.35)]',
      badge: 'border border-white/40 bg-[#087F3F]/90 text-white',
      topBorder: 'bg-gradient-to-r from-[#087F3F] to-emerald-400',
    }
  }
  if (['cancelled', 'cancelled_by_tourist', 'rejected'].includes(status)) {
    return {
      card: 'bg-white/40 border-red-300/70 shadow-[0_8px_32px_-12px_rgba(239,68,68,0.35)]',
      badge: 'border border-white/40 bg-red-500/90 text-white',
      topBorder: 'bg-gradient-to-r from-red-500 to-rose-400',
    }
  }
  if (['pending_payment', 'waiting_restaurant'].includes(status)) {
    return {
      card: 'bg-white/40 border-amber-300/70 shadow-[0_8px_32px_-12px_rgba(245,158,11,0.35)]',
      badge: 'border border-white/40 bg-amber-500/90 text-white',
      topBorder: 'bg-gradient-to-r from-amber-500 to-yellow-400',
    }
  }
  return {
    card: 'bg-white/40 border-[#087F3F]/40 shadow-[0_8px_32px_-12px_rgba(8,127,63,0.35)]',
    badge: 'border border-white/40 bg-[#087F3F]/90 text-white',
    topBorder: 'bg-gradient-to-r from-[#087F3F] to-emerald-400',
  }
}

function getStatusBadge(status: string) {
  if (['completed', 'delivered'].includes(status)) return 'bg-[#087F3F]'
  if (['cancelled', 'cancelled_by_tourist', 'rejected'].includes(status)) return 'bg-red-500'
  return 'bg-amber-500'
}

function statusTextColor(status: string) {
  if (['completed', 'delivered'].includes(status)) return 'text-[#087F3F]'
  if (['cancelled', 'cancelled_by_tourist', 'rejected'].includes(status)) return 'text-red-500'
  return 'text-amber-600'
}

export default function TouristOrders() {
  const { data, isLoading } = useQuery<OrdersResponse>({
    queryKey: ['tourist-orders'],
    queryFn: async () => {
      const response = await get<OrdersResponse>('/tourist/history?tab=food')
      if (!response) {
        throw new Error('Orders response is empty.')
      }
      return response
    },
  })

  if (isLoading) return <DashboardSkeleton />

  const orders = data?.orders?.data ?? []
  const groupOrders = data?.group_orders?.data ?? []
  const hasOrders = orders.length > 0 || groupOrders.length > 0

  return (
    <div className="relative">
      {/* Ambient glassmorphism background blobs */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-20 -left-20 w-96 h-96 rounded-full bg-[#087F3F]/15 blur-3xl" />
        <div className="absolute top-1/3 -right-24 w-80 h-80 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/4 w-96 h-96 rounded-full bg-amber-200/25 blur-3xl" />
        <div className="absolute top-10 right-1/3 w-72 h-72 rounded-full bg-teal-200/20 blur-3xl" />
      </div>

      <div className="relative z-10">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">My Orders</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Track the progress of each food order.</p>
      </div>

      {!hasOrders ? (
        <div className="bg-white/60 border border-[#E5E9E7] backdrop-blur-xl rounded-2xl p-12 text-center">
          <ClipboardList className="w-12 h-12 text-[#6B7280]/30 mx-auto mb-4" />
          <p className="text-[#6B7280] mb-4">You have no food orders yet.</p>
          <Link to="/tourist/food" className="inline-block bg-[#087F3F] hover:bg-[#056B35] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            Browse Food
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {groupOrders.map((group) => {
            const groupTone = getCardTone(group.status)
            return (
            <div key={`group-${group.id}`} className={`relative overflow-hidden border rounded-2xl p-5 hover:shadow-lg backdrop-blur-xl transition ${groupTone.card}`}>
              <div className={`absolute top-0 left-0 right-0 h-1 ${groupTone.topBorder}`} />
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 bg-white/60 backdrop-blur-md rounded-xl flex items-center justify-center shrink-0 shadow-sm">
                    <ShoppingBag className="w-5 h-5 text-purple-600" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-[#17201B] truncate">{group.reference_number}</p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${getStatusBadge(group.status)}`}>
                        Group Order
                      </span>
                    </div>
                    <p className="text-xs text-[#6B7280]">
                      {group.orders?.length ?? 0} restaurant{(group.orders?.length ?? 0) !== 1 ? 's' : ''} · {formatDateTime(group.created_at)}
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-[#17201B]">{formatCurrency(group.grand_total)}</p>
                  <p className={`text-xs font-semibold capitalize ${statusTextColor(group.status)}`}>
                    {group.status.replace(/_/g, ' ')}
                  </p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#6B7280]">
                {group.orders?.map((o) => (
                  <span key={o.id} className="inline-flex items-center gap-1 px-2 py-1 bg-[#F8FAF9] rounded-lg border border-[#E5E9E7]">
                    <Package className="w-3 h-3" />
                    {o.business?.name || `Order #${o.order_number}`}
                  </span>
                ))}
              </div>

              <Link
                to={`/tourist/food/group-order/${group.id}`}
                className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-purple-600 hover:underline"
              >
                <Eye className="w-4 h-4" /> View Receipt
              </Link>
            </div>
            )
          })}

          {orders.map((order) => {
            const progress = getProgress(order.status)
            const progressPercent = progress.rejected
              ? 0
              : (progress.stepIndex / (ORDER_STEPS.length - 1)) * 100
            const tone = getCardTone(order.status)

            return (
              <div key={order.id} className={`relative overflow-hidden border rounded-2xl p-5 hover:shadow-lg backdrop-blur-xl transition ${tone.card}`}>
                <div className={`absolute top-0 left-0 right-0 h-1 ${tone.topBorder}`} />
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 bg-white/60 backdrop-blur-md rounded-xl flex items-center justify-center shrink-0 shadow-sm">
                      {progress.rejected
                        ? <XCircle className="w-5 h-5 text-red-500" />
                        : <ClipboardList className="w-5 h-5 text-[#087F3F]" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-[#17201B] truncate">{order.business_name || 'Food Order'}</p>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${tone.badge}`}>
                          {progress.rejected ? 'Order Cancelled' : order.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="text-xs text-[#6B7280] mt-0.5">#{order.order_number} · {formatDateTime(order.created_at)}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-[#17201B]">{formatCurrency(order.total)}</p>
                  </div>
                </div>

                <div className="mt-5 px-1">
                  <div className="relative">
                    <div className="absolute top-3 left-3 right-3 h-1 rounded-full bg-[#E5E9E7]" />
                    <div
                      className={`absolute top-3 left-3 h-1 rounded-full transition-all duration-500 ${progress.rejected ? 'bg-red-400' : 'bg-[#087F3F]'}`}
                      style={{ width: `calc((100% - 1.5rem) * ${progressPercent / 100})` }}
                    />
                    <div className="relative flex justify-between">
                      {ORDER_STEPS.map((step, index) => {
                        const complete = !progress.rejected && index <= progress.stepIndex
                        return (
                          <div key={step.key} className="flex flex-col items-center">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 border-white z-10 ${
                              complete ? 'bg-[#087F3F] text-white' : 'bg-[#E5E9E7] text-[#6B7280]'
                            }`}>
                              {complete && <CheckCircle2 className="w-4 h-4" />}
                            </div>
                            <span className={`mt-1.5 text-[10px] text-center ${complete ? 'text-[#087F3F] font-semibold' : 'text-[#6B7280]'}`}>
                              {step.label}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                <Link
                  to={`/tourist/orders/${order.id}/progress`}
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#087F3F] hover:underline"
                >
                  <Eye className="w-4 h-4" /> View order progress
                </Link>
              </div>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}
