import { useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, get, patch, post } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PreparationCountdown } from '@/shared/components/PreparationCountdown'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { deriveReadyAt, formatCurrency, formatDateTime } from '@/shared/utils'
import { useBusinessPortal } from '../services/business-portal'
import { useBusinessSocketNotifier } from '@/shared/hooks/useBusinessSocketNotifier'
import { ArrowLeft, User, Mail, Phone, Building2, Truck, Clock, MapPin, FileText, CheckCircle, XCircle, PackageCheck, Store } from 'lucide-react'

interface OrderItem {
  id: number
  offering_name?: string
  product_name?: string
  quantity: number
  unit_price: number
  subtotal?: number
  total_price?: number
  status?: string
  preparation_time?: number | null
  preparation_started_at?: string | null
}

interface OrderDetail {
  id: number
  order_number: string
  customer_name: string
  customer_email: string
  customer_phone: string
  business_name: string
  order_type: string
  status: string
  subtotal: number
  delivery_fee: number
  discount: number
  total: number
  delivery_address: string | null
  notes: string | null
  payment_method: string | null
  payment_status: string | null
  created_at: string
  updated_at: string
  group_order_id?: number | null
  group_reference_number?: string | null
  group_paid?: boolean
  restaurant_purchases?: {
    business_id: number
    status: 'paid' | 'pending'
    paid_at: string | null
    purchase_amount?: number | null
    /** The restaurant confirmed the rider's payment (unlocks READY for COD). */
    payment_confirmed_at?: string | null
    /** The rider checked in at this restaurant (≤ 50 m). */
    rider_arrived_at?: string | null
    can_confirm_payment?: boolean
  }[]
  rider_tip?: number | string | null
  delivery_speed?: string | null
  preparation_time?: number | null
  preparation_started_at?: string | null
  predicted_ready_at?: string | null
  food_ready_at?: string | null
  items: OrderItem[]
  /** Staff only: other restaurants share this order; their items are not listed. */
  shared_with_other_restaurants?: boolean
  /** Staff only: their restaurant's "Handed to rider" record. */
  my_handover?: { confirmed_at: string; confirmed_by: number } | null
  delivery?: {
    id: number
    rider?: { name?: string | null; first_name?: string | null; phone?: string | null } | null
    rider_name: string | null
    rider_phone: string | null
    status: string
    pickup_address: string
    delivery_address: string
    assigned_at: string | null
    picked_up_at: string | null
    delivered_at: string | null
  } | null
}

const ORDER_TRANSITIONS: Record<string, { next: string; label: string; color: string }[]> = {
  accepted: [
    { next: 'preparing', label: 'Start Preparing', color: 'bg-[#16803C] hover:bg-[#126B32] text-white' },
  ],
  preparing: [
    { next: 'ready', label: 'Ready for Pickup', color: 'bg-[#16803C] hover:bg-[#126B32] text-white' },
  ],
}

/** Per-item predicted readiness — the dish's own clock from its own
 * preparation window, independent of the order-level countdown. */
function itemPredictedReadyAt(item: OrderItem): string | null {
  if (item.status !== 'preparing') return null
  if (!item.preparation_started_at || item.preparation_time == null) return null
  return new Date(new Date(item.preparation_started_at).getTime() + item.preparation_time * 60_000).toISOString()
}

export default function BusinessOwnerOrderShow() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  // The owner's page, also in the staff portal (2026-11-24): /staff prefix,
  // their one restaurant, and only the buttons their roles allow.
  const { prefix, isStaff, can, businessId: selectedBusinessId } = useBusinessPortal()

  // P11.8 — live updates on the order detail page: rider acceptance (→
  // preparing + countdown) and the timer reaching 00:00 (→ ready, items →
  // ready) arrive on the authorized business room and trigger an immediate
  // refetch. HTTP remains the fallback when no socket/token is available.
  const { connection } = useBusinessSocketNotifier({
    businessId: isStaff ? null : (selectedBusinessId ?? null),
    onStatusEvent: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['bo-order', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-orders'] })
    }, [queryClient, id]),
  })

  const { data: order, isLoading } = useQuery({
    queryKey: ['bo-order', id],
    queryFn: () => get<OrderDetail>(`${prefix}/orders/${id}`),
    // Staff have no business socket token: refresh every 30 s instead.
    refetchInterval: isStaff ? 30_000 : false,
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => patch(`${prefix}/orders/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-order', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-orders'] })
    },
  })

  // COD "paid before ready": the restaurant confirms it received the rider's payment.
  const codPaymentMutation = useMutation({
    mutationFn: (businessId: number | null) =>
      post(`${prefix}/orders/${id}/cod-payment-received`, businessId ? { business_id: businessId } : {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-order', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-orders'] })
    },
  })

  const updateItemStatusMutation = useMutation({
    mutationFn: ({ itemId, status }: { itemId: number; status: string }) =>
      patch(`${prefix}/orders/${id}/items/${itemId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-order', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-orders'] })
    },
  })

  // Staff: "Handed to rider" (a record only; the rider still confirms pickup).
  const handoverMutation = useMutation({
    mutationFn: () => post(`${prefix}/orders/${id}/handover`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-order', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-orders'] })
    },
  })

  if (isLoading) return <DashboardSkeleton />
  if (!order) return <div className="text-center py-20 text-[#647067]">Order not found.</div>

  // A shared (group) order is updated item by item; whole-order steps would
  // touch another restaurant's food.
  const shared = Boolean(order.shared_with_other_restaurants)
  const canUpdate = can('orders.update')
  const transitions = canUpdate && !shared ? (ORDER_TRANSITIONS[order.status] || []) : []
  const showItemActions = canUpdate && ['accepted', 'preparing'].includes(order.status)
  const activeItems = (order.items ?? []).filter((item) => !['cancelled', 'rejected'].includes(item.status ?? ''))
  const myItemsTotal = activeItems.reduce((sum, item) => sum + Number(item.total_price ?? item.subtotal ?? item.unit_price * item.quantity), 0)
  const rider = order.delivery?.rider
  const riderName = rider?.first_name || rider?.name || order.delivery?.rider_name || null
  const allMineReady = activeItems.length > 0 && activeItems.every((item) => ['ready', 'picked_up', 'in_transit', 'delivered', 'completed'].includes(item.status ?? ''))
  const canHandover = isStaff && can('handover.confirm') && order.order_type === 'delivery' && !!riderName && allMineReady && !order.my_handover

  const readyAt = deriveReadyAt(order)
  const postPrep = ['ready', 'picked_up', 'in_transit', 'out_for_delivery', 'arrived_destination', 'delivered', 'completed', 'cancelled', 'cancelled_by_tourist', 'rejected']
  const prepStarted = Boolean(order.preparation_started_at) && !postPrep.includes(order.status)
  const readyItems = (order.items ?? []).filter(
    (item) => !['cancelled', 'rejected'].includes(item.status ?? '')
  )
  const restaurantPurchase = order.restaurant_purchases?.find(
    (purchase) => purchase.business_id === selectedBusinessId
  )
  const isCodDelivery = order.order_type === 'delivery' && order.payment_method === 'cash'
  // Food can't be marked ready until this restaurant confirmed the rider's payment.
  const awaitingPayment = isCodDelivery && !!restaurantPurchase && !restaurantPurchase.payment_confirmed_at
  const PAYMENT_LOCK_TITLE = 'Confirm "Payment received" from the rider first'
  const actionError =
    (statusMutation.isError && apiErrorMessage(statusMutation.error)) ||
    (updateItemStatusMutation.isError && apiErrorMessage(updateItemStatusMutation.error)) ||
    (codPaymentMutation.isError && apiErrorMessage(codPaymentMutation.error)) ||
    (handoverMutation.isError && apiErrorMessage(handoverMutation.error)) ||
    null

  return (
    <div>
      <Link to={`${prefix}/orders`} className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back to Orders
      </Link>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">{order.order_number}</h1>
          <StatusBadge status={order.status} size="md" />
          {connection === 'connected' && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EAF6ED] px-2.5 py-1 text-[11px] font-medium text-[#16803C]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#16803C] animate-pulse" />
              Live
            </span>
          )}
          {order.group_reference_number && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
              Part of {order.group_reference_number}
            </span>
          )}
        </div>
        <p className="text-sm text-[#647067]">Order Details</p>
        {shared && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-[#B45309]">
            <Store className="h-3.5 w-3.5" aria-hidden="true" /> Shared order: other restaurants prepare their own items. Only yours are listed.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4">Customer Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3">
                <User className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Name</p>
                  <p className="text-sm text-[#17201A] mt-1">{order.customer_name}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Mail className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Email</p>
                  <p className="text-sm text-[#17201A] mt-1">{order.customer_email}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Phone className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Phone</p>
                  <p className="text-sm text-[#17201A] mt-1">{order.customer_phone || '—'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Building2 className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Business</p>
                  <p className="text-sm text-[#17201A] mt-1">{order.business_name}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <FileText className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Order Type</p>
                  <p className="text-sm text-[#17201A] mt-1 capitalize">{order.order_type?.replace(/_/g, ' ')}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Clock className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Created</p>
                  <p className="text-sm text-[#17201A] mt-1">{formatDateTime(order.created_at)}</p>
                </div>
              </div>
            </div>
            {order.delivery_address && (
              <div className="mt-4 flex items-start gap-3">
                <MapPin className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Delivery Address</p>
                  <p className="text-sm text-[#17201A] mt-1">{order.delivery_address}</p>
                </div>
              </div>
            )}
            {order.notes && (
              <div className="mt-4 flex items-start gap-3">
                <FileText className="w-4 h-4 text-[#647067] mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Notes</p>
                  <p className="text-sm text-[#17201A] mt-1">{order.notes}</p>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E2E8E3]">
              <h2 className="text-lg font-semibold text-[#17201A]">Order Items</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Offering</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Prep Status</th>
                    <th className="text-center px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Qty</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Unit Price</th>
                    <th className="text-right px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Subtotal</th>
                    {showItemActions && (
                      <th className="text-center px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Action</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {order.items?.map((item) => {
                    const isReady = item.status === 'ready'
                    const isPreparing = item.status === 'preparing'
                    const isPending = item.status === 'pending' || !item.status
                    const itemTimer = itemPredictedReadyAt(item)
                    return (
                      <tr key={item.id} className="hover:bg-[#F6F8F4] transition-colors">
                        <td className="px-6 py-3 font-medium text-[#17201A]">{item.product_name || item.offering_name}</td>
                        <td className="px-6 py-3">
                          {isReady && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#087F3F] bg-[#E9F7EF] px-2.5 py-1 rounded-full">
                              <CheckCircle className="w-3 h-3" /> Ready
                            </span>
                          )}
                          {isPreparing && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
                              <Clock className="w-3 h-3" /> Preparing
                            </span>
                          )}
                          {itemTimer && (
                            <div className="mt-1.5 font-mono text-xs font-semibold text-[#16803C]">
                              <PreparationCountdown readyAt={itemTimer} />
                            </div>
                          )}
                          {isPending && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#647067] bg-gray-100 px-2.5 py-1 rounded-full">
                              <Clock className="w-3 h-3" /> Pending
                            </span>
                          )}
                          {item.status === 'cancelled' && (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2.5 py-1 rounded-full">
                              <XCircle className="w-3 h-3" /> Cancelled
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-3 text-center text-[#4B5563]">{item.quantity}</td>
                        <td className="px-6 py-3 text-right text-[#4B5563]">{formatCurrency(item.unit_price)}</td>
                        <td className="px-6 py-3 text-right font-medium text-[#17201A]">{formatCurrency(item.total_price ?? item.subtotal)}</td>
                        {showItemActions && (
                          <td className="px-6 py-3 text-center">
                            {!isReady ? (
                              <button
                                onClick={() => updateItemStatusMutation.mutate({ itemId: item.id, status: 'ready' })}
                                disabled={updateItemStatusMutation.isPending || awaitingPayment}
                                title={awaitingPayment ? PAYMENT_LOCK_TITLE : undefined}
                                className="px-3 py-1 rounded-lg text-xs font-semibold bg-[#16803C] hover:bg-[#126B32] text-white transition disabled:opacity-50 inline-flex items-center gap-1"
                              >
                                <CheckCircle className="w-3 h-3" /> Mark Ready
                              </button>
                            ) : (
                              <span className="text-xs text-[#087F3F] font-medium">All Set</span>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="border-t border-[#E2E8E3]">
                  {shared ? (
                    <tr>
                      <td colSpan={showItemActions ? 5 : 4} className="px-6 py-3 text-right text-sm font-semibold text-[#17201A]">Your items</td>
                      <td className="px-6 py-3 text-right text-lg font-bold text-[#16803C]">{formatCurrency(myItemsTotal)}</td>
                    </tr>
                  ) : (<>
                  <tr>
                    <td colSpan={showItemActions ? 5 : 4} className="px-6 py-2 text-right text-xs text-[#647067] uppercase tracking-wider">Subtotal</td>
                    <td className="px-6 py-2 text-right text-sm text-[#17201A]">{formatCurrency(order.subtotal)}</td>
                  </tr>
                  <tr>
                    <td colSpan={showItemActions ? 5 : 4} className="px-6 py-2 text-right text-xs text-[#647067] uppercase tracking-wider">Delivery Fee</td>
                    <td className="px-6 py-2 text-right text-sm text-[#17201A]">{formatCurrency(order.delivery_fee)}</td>
                  </tr>
                  {order.discount > 0 && (
                    <tr>
                      <td colSpan={showItemActions ? 5 : 4} className="px-6 py-2 text-right text-xs text-[#647067] uppercase tracking-wider">Discount</td>
                      <td className="px-6 py-2 text-right text-sm text-[#B91C1C]">-{formatCurrency(order.discount)}</td>
                    </tr>
                  )}
                  <tr className="border-t border-[#E2E8E3]">
                    <td colSpan={showItemActions ? 5 : 4} className="px-6 py-3 text-right text-sm font-semibold text-[#17201A]">Total</td>
                    <td className="px-6 py-3 text-right text-lg font-bold text-[#16803C]">{formatCurrency(order.total)}</td>
                  </tr>
                  </>)}
                </tfoot>
              </table>
            </div>
          </div>

          {order.delivery && (
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
              <h2 className="text-lg font-semibold text-[#17201A] mb-4">Delivery Information</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex items-start gap-3">
                  <Truck className="w-4 h-4 text-[#647067] mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Rider</p>
                    <p className="text-sm text-[#17201A] mt-1">{riderName || 'Unassigned'}</p>
                    {(order.delivery.rider_phone || rider?.phone) && (
                      <p className="text-xs text-[#647067] mt-0.5">{order.delivery.rider_phone || rider?.phone}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-[#647067] mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Pickup Address</p>
                    <p className="text-sm text-[#17201A] mt-1">{order.delivery.pickup_address}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="w-4 h-4 text-[#647067] mt-0.5" />
                  <div>
                    <p className="text-xs font-medium text-[#647067] uppercase tracking-wider">Delivery Address</p>
                    <p className="text-sm text-[#17201A] mt-1">{order.delivery.delivery_address}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <StatusBadge status={order.delivery.status} size="md" />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-[#647067]">
                {order.delivery.assigned_at && (
                  <span>Assigned: {formatDateTime(order.delivery.assigned_at)}</span>
                )}
                {order.delivery.picked_up_at && (
                  <span>Picked Up: {formatDateTime(order.delivery.picked_up_at)}</span>
                )}
                {order.delivery.delivered_at && (
                  <span>Delivered: {formatDateTime(order.delivery.delivered_at)}</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          {/* Preparation countdown (starts when a rider accepts) */}
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4">Food Preparation</h2>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[#647067]">Preparation Time</span>
                <span className="text-[#17201A] font-medium">
                  {order.preparation_time ? `${order.preparation_time} minutes` : '—'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[#647067]">Time Remaining</span>
                {prepStarted && readyAt ? (
                  <PreparationCountdown
                    readyAt={readyAt}
                    className="font-mono text-lg font-bold text-[#16803C]"
                  />
                ) : (
                  <span className="text-[#9CA3AF]">—</span>
                )}
              </div>
              {prepStarted && readyAt && (
                <div className="flex justify-between">
                  <span className="text-[#647067]">Estimated Ready</span>
                  <span className="text-[#17201A]">{formatDateTime(readyAt)}</span>
                </div>
              )}
              {readyItems.length > 0 && (
                <div className="border-t border-[#E2E8E3] pt-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[#647067] mb-2">Item Readiness</p>
                  <div className="space-y-2">
                    {readyItems.map((item) => {
                      const isReadyItem = item.status === 'ready'
                      const isPreparingItem = item.status === 'preparing'
                      const isPendingItem = item.status === 'pending' || !item.status
                      const itemTimer = itemPredictedReadyAt(item)
                      return (
                        <div key={item.id} className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-[#17201A] truncate">
                            {item.quantity}× {item.product_name || item.offering_name}
                          </p>
                          {isReadyItem && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#087F3F] bg-[#E9F7EF] px-2 py-0.5 rounded-full shrink-0">
                              <CheckCircle className="w-3 h-3" /> Ready
                            </span>
                          )}
                          {isPreparingItem && (
                            <span className="shrink-0 text-right">
                              {itemTimer ? (
                                <PreparationCountdown readyAt={itemTimer} className="font-mono text-xs font-semibold text-[#16803C]" />
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                  <Clock className="w-3 h-3" /> Preparing
                                </span>
                              )}
                            </span>
                          )}
                          {isPendingItem && (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#647067] bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
                              <Clock className="w-3 h-3" /> Pending
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
            {order.status === 'waiting_restaurant' && (
              <p className="text-xs text-[#647067] mt-4">
                Finding a rider — the preparation timer starts automatically once a rider accepts this delivery.
              </p>
            )}
            {prepStarted && (
              <p className="text-xs text-[#647067] mt-4">
                The order becomes Ready automatically when the timer reaches 00:00.
              </p>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
            <h2 className="text-lg font-semibold text-[#17201A] mb-4">Actions</h2>

            {/* Finding rider: no restaurant action exists in this state */}
            {order.status === 'waiting_restaurant' ? (
              <p className="text-sm text-[#647067]">
                No action needed — the system is dispatching this order to nearby riders. Preparation starts as soon as a rider accepts.
              </p>
            ) : (
              transitions.length > 0 ? (
                <div className="space-y-3">
                  {actionError && (
                    <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{actionError}</p>
                  )}
                  {transitions.map((t) => (
                    <button
                      key={t.next}
                      onClick={() => statusMutation.mutate(t.next)}
                      disabled={statusMutation.isPending || (t.next === 'ready' && awaitingPayment)}
                      title={t.next === 'ready' && awaitingPayment ? PAYMENT_LOCK_TITLE : undefined}
                      className={`w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50 ${t.color}`}
                    >
                      {statusMutation.isPending ? 'Updating...' : t.label}
                    </button>
                  ))}
                </div>
              ) : !canHandover && !order.my_handover ? (
                <p className="text-sm text-[#647067]">
                  {shared && canUpdate ? 'Mark your items ready one by one in Order Items.' : 'No actions available for this status.'}
                </p>
              ) : null
            )}
            {(canHandover || order.my_handover) && (
              <div className="mt-3 space-y-2">
                {actionError && transitions.length === 0 && (
                  <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{actionError}</p>
                )}
                {order.my_handover ? (
                  <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#16803C]">
                    <PackageCheck className="h-4 w-4" aria-hidden="true" /> Handed to the rider {formatDateTime(order.my_handover.confirmed_at)}
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => handoverMutation.mutate()}
                    disabled={handoverMutation.isPending}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32] disabled:opacity-50"
                  >
                    <PackageCheck className="h-4 w-4" aria-hidden="true" />
                    {handoverMutation.isPending ? 'Saving…' : 'Handed to rider'}
                  </button>
                )}
                <p className="text-[11px] text-[#8A948E]">The rider still confirms the pickup on their side.</p>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
            <h2 className="text-sm font-semibold text-[#647067] uppercase tracking-wider mb-3">Order Summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[#647067]">Status</span>
                <StatusBadge status={order.status} />
              </div>
              <div className="flex justify-between">
                <span className="text-[#647067]">Type</span>
                <span className="text-[#17201A] capitalize">{order.order_type?.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#647067]">{shared ? 'Your items' : 'Total'}</span>
                <span className="text-[#16803C] font-bold">{formatCurrency(shared ? myItemsTotal : order.total)}</span>
              </div>
              {order.payment_method && (
                <div className="flex justify-between">
                  <span className="text-[#647067]">Payment</span>
                  <span className="text-[#17201A] capitalize">{order.payment_method}</span>
                </div>
              )}
              {order.payment_status && (
                <div className="flex justify-between">
                  <span className="text-[#647067]">Payment Status</span>
                  <StatusBadge status={order.payment_status} />
                </div>
              )}
              {isCodDelivery && (
                <div>
                  <div className="flex justify-between">
                    <span className="text-[#647067]">Restaurant Purchase</span>
                    <span className={`font-semibold ${restaurantPurchase?.payment_confirmed_at ? 'text-[#16803C]' : 'text-[#B45309]'}`}>
                      {restaurantPurchase?.payment_confirmed_at ? 'Payment received' : 'Awaiting rider payment'}
                    </span>
                  </div>
                  {restaurantPurchase?.payment_confirmed_at ? (
                    <p className="mt-1 text-[11px] text-[#16803C]">Confirmed {formatDateTime(restaurantPurchase.payment_confirmed_at)} — you can mark the food ready.</p>
                  ) : restaurantPurchase?.can_confirm_payment && !can('payments.confirm_rider_cash') ? (
                    <p className="mt-1 text-[11px] text-[#4B5563]">The rider is at your restaurant. A teammate who handles cash confirms the payment.</p>
                  ) : restaurantPurchase?.can_confirm_payment ? (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-[11px] text-[#4B5563]">
                        The rider is at your restaurant.{restaurantPurchase.purchase_amount != null && ` Collect ${formatCurrency(restaurantPurchase.purchase_amount)}`}, then confirm.
                      </p>
                      <button
                        type="button"
                        onClick={() => codPaymentMutation.mutate(selectedBusinessId ?? null)}
                        disabled={codPaymentMutation.isPending}
                        className="w-full px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#16803C] hover:bg-[#126B32] text-white transition disabled:opacity-50"
                      >
                        {codPaymentMutation.isPending ? 'Confirming…' : 'Payment received'}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-[#8A948E]">Waiting for the rider to arrive and pay. The food can be marked ready after you confirm the payment.</p>
                  )}
                  <p className="mt-1 text-[11px] text-[#8A948E]">
                    Tourism Office purchasing cash is separate from the tourist's COD payment.
                  </p>
                </div>
              )}
              {order.group_reference_number && (
                <div className="flex justify-between">
                  <span className="text-[#647067]">Group Order</span>
                  <span className="text-purple-700 text-xs font-semibold">{order.group_reference_number}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[#647067]">Created</span>
                <span className="text-[#4B5563] text-xs">{formatDateTime(order.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#647067]">Updated</span>
                <span className="text-[#4B5563] text-xs">{formatDateTime(order.updated_at)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
