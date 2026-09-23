import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { get, post } from '@/shared/services/api'
import { formatCurrency, formatDateTime, toAssetUrl } from '@/shared/utils'
import {
  ArrowLeft,
  Package,
  Store,
  Truck,
  MapPin,
  Phone,
  CreditCard,
  CheckCircle2,
  Clock,
  Loader2,
  AlertCircle,
  ShoppingBag,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react'
import { OrderProgressTrack } from '../components/OrderProgressTrack'
import { resolveSubOrderStatus } from '../utils/subOrderStatusEngine'

interface GroupItem {
  id: number
  business_id?: number | null
  business?: { id: number; name: string; address?: string } | null
  product_name: string
  quantity: number
  unit_price: number
  subtotal: number
  status?: string | null
  notes?: string | null
  offering?: { image?: string; images?: string[] } | null
  cancelled_quantity?: number
  cancelled_at?: string | null
  cancellation_reason?: string | null
}

interface GroupOrder {
  id: number
  order_number: string
  order_type: string
  status: string
  subtotal: number
  delivery_fee: number
  system_fee: number
  rider_financed_amount: number
  rider_delivery_earnings: number
  total: number
  paid_amount: number
  payment_status: string
  payment_method?: string | null
  refunded_amount?: number
  delivery_address?: string | null
  business?: { id: number; name: string; address?: string } | null
  items?: GroupItem[]
  delivery?: {
    id: number
    status: string
    dispatch_status?: string | null
    rider?: { id: number; name: string; profile?: { photo?: string } } | null
  } | null
}

interface GroupCheckoutData {
  id: number
  reference_number: string
  status: string
  payment_status: string
  payment_method?: string | null
  order_type: string
  subtotal: number
  delivery_total: number
  discount: number
  grand_total: number
  paid_amount: number
  refunded_amount?: number
  delivery_address?: string | null
  notes?: string | null
  created_at: string
  orders: GroupOrder[]
  delivery?: {
    id: number
    status: string
    dispatch_status?: string | null
    pickup_address?: string | null
    delivery_address?: string | null
    rider?: { id: number; name: string; profile?: { photo?: string } } | null
  } | null
}

const GROUP_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending Payment',
  partially_processing: 'Being Prepared',
  partially_completed: 'Partly Completed',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Waiting',
  waiting_restaurant: 'Waiting',
  pending: 'Waiting',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  picked_up: 'Picked Up',
  in_transit: 'On the Way',
  out_for_delivery: 'On the Way',
  on_the_way: 'On the Way',
  delivered: 'Delivered',
  completed: 'Delivered',
  rejected: 'Cancelled',
  cancelled: 'Cancelled',
  cancelled_by_restaurant: 'Cancelled',
  cancelled_by_tourist: 'Cancelled',
}

function statusBadgeClass(status: string): string {
  if (['completed', 'delivered'].includes(status)) return 'bg-[#E9F7EF] text-[#087F3F]'
  if (['cancelled', 'rejected', 'failed', 'cancelled_by_restaurant', 'cancelled_by_tourist'].includes(status)) return 'bg-red-50 text-red-600'
  if (['preparing', 'ready', 'picked_up', 'out_for_delivery', 'on_the_way', 'partially_processing', 'partially_completed'].includes(status)) return 'bg-amber-50 text-amber-600'
  return 'bg-blue-50 text-blue-600'
}

function activeQuantity(item: GroupItem): number {
  return item.quantity - (item.cancelled_quantity ?? 0)
}

function isOrderCancellable(status: string): boolean {
  return ['pending_payment', 'pending', 'waiting_restaurant'].includes(status)
}


export default function TouristGroupOrder() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading, isError } = useQuery<{ group_order: GroupCheckoutData }>({
    queryKey: ['group-order', id],
    queryFn: () => get(`/tourist/food/group-order/${id}`),
    enabled: !!id,
  })

  const group = data?.group_order

  const queryClient = useQueryClient()

  const cancelItemMutation = useMutation({
    mutationFn: ({ orderId, itemId, quantity, reason }: { orderId: number; itemId: number; quantity: number; reason?: string }) =>
      post(`/tourist/food/order/${orderId}/cancel-item`, { item_id: itemId, quantity, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-order', id] })
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-[#087F3F] animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#6B7280]">Loading group order...</p>
        </div>
      </div>
    )
  }

  if (isError || !group) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-bold text-[#17201B] mb-2">Group order not found</h2>
          <p className="text-sm text-[#6B7280] mb-5">We could not load this group order.</p>
          <Link to="/tourist/orders" className="inline-block bg-[#087F3F] hover:bg-[#056B35] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            Back to Orders
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto py-6">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#17201B] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      {/* Consolidated Receipt Header */}
      <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs text-[#6B7280] mb-1">Group Checkout Reference</p>
            <h1 className="text-2xl font-bold text-[#17201B]">{group.reference_number}</h1>
            <p className="text-sm text-[#6B7280] mt-1">Placed {formatDateTime(group.created_at)}</p>
          </div>
          <div className="text-right">
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${statusBadgeClass(group.status)}`}>
              {GROUP_STATUS_LABELS[group.status] || group.status}
            </span>
            <p className="text-xs text-[#6B7280] mt-2">{group.orders.length} restaurant order{group.orders.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 border-t border-[#E5E9E7] pt-5">
          <div>
            <p className="text-xs text-[#6B7280]">Subtotal</p>
            <p className="text-sm font-semibold text-[#17201B]">{formatCurrency(group.subtotal)}</p>
          </div>
          <div>
            <p className="text-xs text-[#6B7280]">Shared Delivery</p>
            <p className="text-sm font-semibold text-[#17201B]">{formatCurrency(group.delivery_total)}</p>
          </div>
          <div>
            <p className="text-xs text-[#6B7280]">Discount</p>
            <p className="text-sm font-semibold text-[#17201B]">{formatCurrency(group.discount)}</p>
          </div>
          <div>
            <p className="text-xs text-[#6B7280]">Grand Total</p>
            <p className="text-base font-bold text-[#087F3F]">{formatCurrency(group.grand_total)}</p>
          </div>
          {(group.refunded_amount ?? 0) > 0 && (
            <div>
              <p className="text-xs text-red-500">Refunded</p>
              <p className="text-sm font-semibold text-red-500">-{formatCurrency(group.refunded_amount!)}</p>
            </div>
          )}
        </div>

        <div className="mt-5 space-y-2 border-t border-[#E5E9E7] pt-4 text-sm">
          <div className="flex items-center gap-2 text-[#6B7280]">
            <MapPin className="w-4 h-4 shrink-0" />
            <span className="capitalize">{group.order_type}</span>
            {group.delivery_address ? <span className="text-[#17201B]">· {group.delivery_address}</span> : null}
          </div>
          <div className="flex items-center gap-2 text-[#6B7280]">
            <CreditCard className="w-4 h-4 shrink-0" />
            {group.payment_method ? <span className="capitalize text-[#17201B]">{group.payment_method}</span> : <span>{group.payment_status}</span>}
          </div>
          {group.paid_amount != null && group.paid_amount > 0 ? (
            <div className="flex items-center gap-2 text-[#6B7280]">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-[#087F3F]" />
              <span className="text-[#17201B]">Paid {formatCurrency(group.paid_amount)}</span>
            </div>
          ) : null}
        </div>
      </div>

      {group.delivery ? (
        <div className="bg-white border border-[#E5E9E7] rounded-2xl px-5 py-4 mb-6 flex flex-wrap items-center gap-3 text-sm">
          {group.delivery.status === 'delivered' || group.delivery.status === 'completed' ? (
            <CheckCircle2 className="w-4 h-4 text-[#087F3F] shrink-0" />
          ) : (
            <Truck className="w-4 h-4 text-[#087F3F] shrink-0" />
          )}
          <span className="font-semibold text-[#17201B]">Shared delivery</span>
          <span className="text-[#6B7280] capitalize">{ORDER_STATUS_LABELS[group.delivery.status] || group.delivery.status}</span>
          {group.delivery.dispatch_status === 'no_rider_available' && (
            <span className="text-amber-600 text-xs flex items-center gap-1">
              <Clock className="w-3 h-3" /> Finding rider...
            </span>
          )}
          {group.delivery.rider ? (
            <span className="flex items-center gap-1.5 text-xs text-[#6B7280] sm:ml-auto">
              <Phone className="w-3 h-3" />
              Rider: {group.delivery.rider.name || 'Rider'}
            </span>
          ) : null}
          <Link
            to={`/tourist/food/order/${group.orders[0]?.id}/status`}
            className="text-xs font-semibold text-[#087F3F] hover:text-[#056B35] underline underline-offset-2 sm:ml-2"
          >
            Track shared delivery →
          </Link>
        </div>
      ) : null}

      {/* Restaurant fulfillment groups within the shared order */}
      <div className="space-y-6">
        {group.orders.map((order, orderIdx) => {
          const biz = order.business
          const riderName = group.delivery?.rider?.name || null

          const resolution = resolveSubOrderStatus({
            orderStatus: order.status,
            deliveryStatus: group.delivery?.status,
            dispatchStatus: group.delivery?.dispatch_status,
            riderName: riderName,
            subOrderTotal: order.total,
            paymentMethod: order.payment_method || group.payment_method || 'cash',
          })

          const subOrderLetter = String.fromCharCode(65 + (orderIdx % 26))

          return (
            <div key={order.id} className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden shadow-sm">
              <div className="px-5 py-4 border-b border-[#E5E9E7] flex items-start justify-between gap-3 bg-[#FCFDFD]">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 bg-[#087F3F]/10 rounded-xl flex items-center justify-center shrink-0">
                    <Store className="w-5 h-5 text-[#087F3F]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-[#17201B] truncate">
                        {biz?.name || `Restaurant #${order.business?.id ?? ''}`} fulfillment
                      </p>
                      {riderName && (
                        <span className="text-xs bg-[#E9F7EF] text-[#087F3F] font-semibold px-2.5 py-0.5 rounded-full">
                          Rider: {riderName}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[#6B7280] mt-0.5">Items in shared order {group.reference_number}</p>
                  </div>
                </div>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold shrink-0 ${statusBadgeClass(order.status)}`}>
                  {ORDER_STATUS_LABELS[order.status] || order.status}
                </span>
              </div>

              {/* Progress Track & Sub-Status Message Matrix */}
              <div className="px-5 py-4 bg-[#F8FAF9] border-b border-[#E5E9E7]">
                <OrderProgressTrack resolution={resolution} />
              </div>

              <div className="px-5 py-4 space-y-3">
                {order.items?.map((item, idx) => {
                  const img = item.offering?.image || item.offering?.images?.[0]
                  const cancelled = item.cancelled_quantity ?? 0
                  const active = activeQuantity(item)
                  const isFullyCancelled = cancelled > 0 && active === 0
                  const isPartiallyCancelled = cancelled > 0 && active > 0
                  return (
                    <div key={idx} className={`flex items-center gap-3 ${isFullyCancelled ? 'opacity-50' : ''}`}>
                      {img ? (
                        <img src={toAssetUrl(img)} alt={item.product_name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                      ) : (
                        <div className="w-10 h-10 bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] rounded-lg shrink-0 flex items-center justify-center">
                          <UtensilsCrossed className="w-4 h-4 text-[#087F3F]/40" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className={`text-sm font-medium truncate ${isFullyCancelled ? 'line-through text-[#9CA3AF]' : 'text-[#17201B]'}`}>
                            {item.product_name}
                          </p>
                          {!isFullyCancelled && item.status === 'ready' && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#087F3F] bg-[#E9F7EF] px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" /> Ready
                            </span>
                          )}
                          {!isFullyCancelled && item.status === 'preparing' && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                              <Clock className="w-3 h-3" /> Preparing
                            </span>
                          )}
                          {!isFullyCancelled && item.status === 'pending' && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6B7280] bg-gray-100 px-2 py-0.5 rounded-full">
                              <Clock className="w-3 h-3" /> Pending
                            </span>
                          )}
                        </div>
                        {item.notes ? <p className="text-xs text-[#6B7280] truncate">{item.notes}</p> : null}
                        {isFullyCancelled && (
                          <p className="text-xs text-red-500 flex items-center gap-1 mt-0.5">
                            <XCircle className="w-3 h-3" /> Cancelled
                          </p>
                        )}
                        {isPartiallyCancelled && (
                          <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3" /> {cancelled} of {item.quantity} cancelled
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        {isFullyCancelled ? (
                          <span className="text-sm text-[#9CA3AF] line-through">{formatCurrency(item.subtotal)}</span>
                        ) : (
                          <>
                            <span className="text-sm text-[#6B7280] block">×{active}</span>
                            <span className="text-sm font-semibold text-[#17201B] block whitespace-nowrap">{formatCurrency(item.unit_price * active)}</span>
                          </>
                        )}
                        {active > 0 && isOrderCancellable(order.status) && (
                          <button
                            onClick={() => {
                              const qty = active
                              if (confirm(`Cancel ${qty} × ${item.product_name}? The refund will be returned to your original payment.`)) {
                                cancelItemMutation.mutate({
                                  orderId: order.id,
                                  itemId: item.id,
                                  quantity: qty,
                                  reason: 'Cancelled by tourist',
                                })
                              }
                            }}
                            disabled={cancelItemMutation.isPending}
                            className="text-xs text-red-500 hover:text-red-700 font-medium flex items-center gap-1 ml-auto"
                          >
                            <XCircle className="w-3 h-3" /> Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="px-5 py-4 border-t border-[#E5E9E7] space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#6B7280]">Subtotal</span>
                  <span className="font-medium text-[#17201B]">{formatCurrency(order.subtotal)}</span>
                </div>
                {(order.refunded_amount ?? 0) > 0 && (
                  <div className="flex justify-between">
                    <span className="text-red-500">Refunded</span>
                    <span className="font-medium text-red-500">-{formatCurrency(order.refunded_amount!)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-[#E5E9E7] pt-2">
                  <span className="font-semibold text-[#17201B]">Order Total</span>
                  <span className="font-bold text-[#17201B]">{formatCurrency(order.total)}</span>
                </div>
              </div>

            </div>
          )
        })}
      </div>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          to="/tourist/orders"
          className="inline-flex items-center gap-2 bg-[#087F3F] hover:bg-[#056B35] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition"
        >
          <ShoppingBag className="w-4 h-4" /> View All Orders
        </Link>
        <Link
          to="/tourist/food"
          className="inline-flex items-center gap-2 bg-white border border-[#E5E9E7] hover:bg-[#F8FAF9] text-[#17201B] px-5 py-2.5 rounded-xl text-sm font-semibold transition"
        >
          <Package className="w-4 h-4" /> Order More Food
        </Link>
      </div>
    </div>
  )
}
