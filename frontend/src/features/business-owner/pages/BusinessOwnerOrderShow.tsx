import { useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { PreparationCountdown } from '@/shared/components/PreparationCountdown'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { deriveReadyAt, formatCurrency, formatDateTime } from '@/shared/utils'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { useBusinessSocketNotifier } from '@/shared/hooks/useBusinessSocketNotifier'
import { ArrowLeft, User, Mail, Phone, Building2, Truck, Clock, MapPin, FileText, CheckCircle, XCircle } from 'lucide-react'

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
  rider_tip?: number | string | null
  delivery_speed?: string | null
  preparation_time?: number | null
  preparation_started_at?: string | null
  predicted_ready_at?: string | null
  food_ready_at?: string | null
  items: OrderItem[]
  delivery?: {
    id: number
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
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  // P11.8 — live updates on the order detail page: rider acceptance (→
  // preparing + countdown) and the timer reaching 00:00 (→ ready, items →
  // ready) arrive on the authorized business room and trigger an immediate
  // refetch. HTTP remains the fallback when no socket/token is available.
  const { connection } = useBusinessSocketNotifier({
    businessId: selectedBusinessId ?? null,
    onStatusEvent: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['bo-order', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-orders'] })
    }, [queryClient, id]),
  })

  const { data: order, isLoading } = useQuery({
    queryKey: ['bo-order', id],
    queryFn: () => get<OrderDetail>(`/business-owner/orders/${id}`),
  })

  const statusMutation = useMutation({
    mutationFn: (status: string) => patch(`/business-owner/orders/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-order', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-orders'] })
    },
  })

  const updateItemStatusMutation = useMutation({
    mutationFn: ({ itemId, status }: { itemId: number; status: string }) =>
      patch(`/business-owner/orders/${id}/items/${itemId}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-order', id] })
      queryClient.invalidateQueries({ queryKey: ['bo-orders'] })
    },
  })

  if (isLoading) return <DashboardSkeleton />
  if (!order) return <div className="text-center py-20 text-[#647067]">Order not found.</div>

  const transitions = ORDER_TRANSITIONS[order.status] || []

  const readyAt = deriveReadyAt(order)
  const postPrep = ['ready', 'picked_up', 'in_transit', 'out_for_delivery', 'arrived_destination', 'delivered', 'completed', 'cancelled', 'cancelled_by_tourist', 'rejected']
  const prepStarted = Boolean(order.preparation_started_at) && !postPrep.includes(order.status)
  const readyItems = (order.items ?? []).filter(
    (item) => !['cancelled', 'rejected'].includes(item.status ?? '')
  )

  return (
    <div>
      <Link to="/business-owner/orders" className="inline-flex items-center gap-2 text-sm text-[#647067] hover:text-[#17201A] mb-6 transition">
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
                    {['accepted', 'preparing'].includes(order.status) && (
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
                        {['accepted', 'preparing'].includes(order.status) && (
                          <td className="px-6 py-3 text-center">
                            {!isReady ? (
                              <button
                                onClick={() => updateItemStatusMutation.mutate({ itemId: item.id, status: 'ready' })}
                                disabled={updateItemStatusMutation.isPending}
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
                  <tr>
                    <td colSpan={['accepted', 'preparing'].includes(order.status) ? 5 : 4} className="px-6 py-2 text-right text-xs text-[#647067] uppercase tracking-wider">Subtotal</td>
                    <td className="px-6 py-2 text-right text-sm text-[#17201A]">{formatCurrency(order.subtotal)}</td>
                  </tr>
                  <tr>
                    <td colSpan={['accepted', 'preparing'].includes(order.status) ? 5 : 4} className="px-6 py-2 text-right text-xs text-[#647067] uppercase tracking-wider">Delivery Fee</td>
                    <td className="px-6 py-2 text-right text-sm text-[#17201A]">{formatCurrency(order.delivery_fee)}</td>
                  </tr>
                  {order.discount > 0 && (
                    <tr>
                      <td colSpan={['accepted', 'preparing'].includes(order.status) ? 5 : 4} className="px-6 py-2 text-right text-xs text-[#647067] uppercase tracking-wider">Discount</td>
                      <td className="px-6 py-2 text-right text-sm text-[#B91C1C]">-{formatCurrency(order.discount)}</td>
                    </tr>
                  )}
                  <tr className="border-t border-[#E2E8E3]">
                    <td colSpan={['accepted', 'preparing'].includes(order.status) ? 5 : 4} className="px-6 py-3 text-right text-sm font-semibold text-[#17201A]">Total</td>
                    <td className="px-6 py-3 text-right text-lg font-bold text-[#16803C]">{formatCurrency(order.total)}</td>
                  </tr>
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
                    <p className="text-sm text-[#17201A] mt-1">{order.delivery.rider_name || 'Unassigned'}</p>
                    {order.delivery.rider_phone && (
                      <p className="text-xs text-[#647067] mt-0.5">{order.delivery.rider_phone}</p>
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
                  {transitions.map((t) => (
                    <button
                      key={t.next}
                      onClick={() => statusMutation.mutate(t.next)}
                      disabled={statusMutation.isPending}
                      className={`w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-50 ${t.color}`}
                    >
                      {statusMutation.isPending ? 'Updating...' : t.label}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#647067]">No actions available for this status.</p>
              )
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
                <span className="text-[#647067]">Total</span>
                <span className="text-[#16803C] font-bold">{formatCurrency(order.total)}</span>
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
