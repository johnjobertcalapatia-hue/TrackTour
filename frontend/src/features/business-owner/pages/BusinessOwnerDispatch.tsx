import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Package, Bike, ChevronRight, User, Clock, MapPin, Phone } from 'lucide-react'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import type { Business } from '@/shared/types'

interface OrderItem {
  id: number
  product_name: string
  quantity: number
}

interface Order {
  id: number
  order_number: string
  customer_name: string
  customer_phone: string
  status: string
  order_type: string
  delivery_address: string | null
  total: number
  items: OrderItem[]
  business_id: number
  business?: { id: number; business_name: string }
}

interface Rider {
  id: number
  name: string
}

interface Delivery {
  id: number
  order_id: number
  rider_id: number
  status: string
  assigned_at: string
  order?: Order
  rider?: { id: number; name: string }
}

export default function BusinessOwnerDispatch() {
  const queryClient = useQueryClient()
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const [assigning, setAssigning] = useState<{ orderId: number; businessId: number } | null>(null)

  const { data: ordersData, isLoading: ordersLoading } = useQuery<{ data: Order[] }>({
    queryKey: ['bo-dispatch-orders', selectedBusinessId],
    queryFn: () => {
      const params = new URLSearchParams({ status: 'ready', perPage: '50' })
      if (selectedBusinessId) params.set('business_id', String(selectedBusinessId))
      return get<{ data: Order[] }>(`/business-owner/orders?${params.toString()}`)
    },
  })

  const { data: businessesData } = useQuery({
    queryKey: ['bo-businesses'],
    queryFn: () => get<{ data: Business[] }>('/business-owner/businesses'),
  })
  const businesses = businessesData?.data ?? []

  const { data: ridersData } = useQuery<{ data: Rider[] }>({
    queryKey: ['bo-riders', assigning?.businessId],
    queryFn: () => get<{ data: Rider[] }>(`/business-owner/staff/riders/${assigning?.businessId}`),
    enabled: !!assigning,
  })
  const riders = ridersData?.data ?? []

  const { data: deliveriesData, isLoading: deliveriesLoading } = useQuery<{ data: Delivery[] }>({
    queryKey: ['bo-dispatch-deliveries', selectedBusinessId],
    queryFn: () => {
      const params = new URLSearchParams({ perPage: '50' })
      if (selectedBusinessId) params.set('business_id', String(selectedBusinessId))
      return get<{ data: Delivery[] }>(`/business-owner/orders/deliveries?${params.toString()}`)
    },
  })

  const assignMutation = useMutation({
    mutationFn: ({ orderId, riderId }: { orderId: number; riderId: number }) =>
      post(`/business-owner/orders/${orderId}/assign-rider`, { rider_id: riderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-dispatch-orders'] })
      queryClient.invalidateQueries({ queryKey: ['bo-dispatch-deliveries'] })
      setAssigning(null)
    },
  })

  const readyOrders = ordersData?.data?.filter((o) => o.status === 'ready') ?? []
  const deliveries = deliveriesData?.data ?? []

  const isLoading = ordersLoading || deliveriesLoading

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Bike className="w-8 h-8 text-[#16803C]" />
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Rider Dispatch</h1>
          <p className="text-sm text-[#647067]">Assign delivery riders to ready orders</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Ready Orders */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Package className="w-5 h-5 text-[#A66F00]" />
            <h2 className="text-lg font-bold text-[#17201A]">Ready for Dispatch</h2>
            <span className="text-xs text-[#647067] bg-[#F3F8F4] px-2 py-0.5 rounded-full">{readyOrders.length}</span>
          </div>

          {isLoading ? (
            <DashboardSkeleton />
          ) : readyOrders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] py-12 text-center">
              <Package className="w-10 h-10 text-[#647067] mx-auto mb-2" />
              <p className="text-[#647067] font-medium">No orders ready for dispatch</p>
              <p className="text-xs text-[#647067] mt-1">Prepared orders will appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {readyOrders.map((order) => {
                const biz = businesses.find((b) => b.id === order.business_id)
                return (
                  <div key={order.id} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="font-bold text-[#17201A]">{order.order_number}</p>
                        <p className="text-xs text-[#647067]">{biz?.name ?? `Business #${order.business_id}`}</p>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider text-[#A66F00] bg-[#FFF7D6] px-2 py-0.5 rounded-md border border-[#F4B400]/40">
                        {order.order_type}
                      </span>
                    </div>

                    <div className="space-y-1 mb-3">
                      {order.items?.slice(0, 3).map((item) => (
                        <div key={item.id} className="flex items-center gap-2 text-sm">
                          <span className="text-xs font-bold text-[#16803C] w-5">x{item.quantity}</span>
                          <span className="text-[#4B5563]">{item.product_name}</span>
                        </div>
                      ))}
                      {order.items && order.items.length > 3 && (
                        <p className="text-xs text-[#647067]">+{order.items.length - 3} more items</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-[#647067] mb-3">
                      <User className="w-3 h-3" />
                      {order.customer_name}
                      {order.delivery_address && (
                        <>
                          <MapPin className="w-3 h-3 ml-2" />
                          <span className="truncate">{order.delivery_address}</span>
                        </>
                      )}
                    </div>

                    {assigning?.orderId === order.id ? (
                      <div className="space-y-2">
                        <select
                          className="w-full px-3 py-2 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C]"
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              assignMutation.mutate({ orderId: order.id, riderId: Number(e.target.value) })
                            }
                          }}
                        >
                          <option value="" disabled>Select a rider...</option>
                          {riders.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => setAssigning(null)}
                          className="w-full text-xs text-[#647067] hover:text-[#17201A] transition"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setAssigning({ orderId: order.id, businessId: order.business_id })}
                        className="w-full py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] active:bg-[#126B32] text-white text-sm font-semibold transition flex items-center justify-center gap-2"
                      >
                        <Bike className="w-4 h-4" /> Assign Rider
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Right: Active Deliveries */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Bike className="w-5 h-5 text-[#16803C]" />
            <h2 className="text-lg font-bold text-[#17201A]">Active Deliveries</h2>
            <span className="text-xs text-[#647067] bg-[#F3F8F4] px-2 py-0.5 rounded-full">{deliveries.length}</span>
          </div>

          {isLoading ? (
            <DashboardSkeleton />
          ) : deliveries.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] py-12 text-center">
              <Bike className="w-10 h-10 text-[#647067] mx-auto mb-2" />
              <p className="text-[#647067] font-medium">No active deliveries</p>
              <p className="text-xs text-[#647067] mt-1">Dispatch a rider to start tracking</p>
            </div>
          ) : (
            <div className="space-y-3">
              {deliveries.map((delivery) => (
                <div key={delivery.id} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-4">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-semibold text-[#17201A]">{delivery.order?.order_number ?? `Order #${delivery.order_id}`}</p>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${
                      delivery.status === 'assigned' ? 'bg-[#EAF6ED] text-[#16803C] border border-[#BFE3CB]' :
                      delivery.status === 'picked_up' ? 'bg-[#FFF7D6] text-[#A66F00] border border-[#F4B400]/40' :
                      delivery.status === 'in_transit' ? 'bg-[#EAF6ED] text-[#16803C] border border-[#BFE3CB]' :
                      delivery.status === 'delivered' ? 'bg-[#EAF6ED] text-[#16803C] border border-[#BFE3CB]' :
                      'bg-[#F3F4F6] text-[#647067] border border-[#E5E7EB]'
                    }`}>
                      {delivery.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#647067]">
                    <Bike className="w-3 h-3" />
                    {delivery.rider?.name ?? 'Unassigned'}
                    {delivery.assigned_at && (
                      <>
                        <Clock className="w-3 h-3 ml-2" />
                        {new Date(delivery.assigned_at).toLocaleTimeString()}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
