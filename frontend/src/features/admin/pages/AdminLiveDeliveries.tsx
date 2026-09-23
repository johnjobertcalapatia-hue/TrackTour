import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDateTime } from '@/shared/utils'
import { Truck, MapPin, Package, Clock, Banknote, Wallet } from 'lucide-react'

interface LiveOrder {
  payment_method?: string | null
}

interface LiveCodPurchase {
  id: number
  business_id: number
  business_name?: string | null
  purchase_amount: number
  status: 'pending' | 'purchased' | 'collected'
}

interface LiveDelivery {
  id: number
  order_number: string
  rider_name: string | null
  rider_phone: string | null
  status: string
  pickup_address: string
  delivery_address: string
  customer_name: string
  created_at: string
  updated_at: string
  order?: LiveOrder | null
  purchasing_cash?: number | null
  purchasing_cash_issued_at?: string | null
  purchasing_cash_received_at?: string | null
  cod_purchases?: LiveCodPurchase[]
}

const PICKUP_STAGE_STATUSES = ['assigned', 'arrived_pickup']

export default function AdminLiveDeliveries() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-live-deliveries'],
    queryFn: () => get<{ data: LiveDelivery[] }>('/admin/live/deliveries'),
    refetchInterval: 10000,
  })

  const issueCashMutation = useMutation({
    mutationFn: (deliveryId: number) => post(`/admin/deliveries/${deliveryId}/issue-purchasing-cash`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-live-deliveries'] }),
  })

  if (isLoading) return <TableSkeleton rows={6} cols={5} />

  const deliveries = data?.data ?? []
  const isCod = (delivery: LiveDelivery) => (delivery.order?.payment_method ?? '').toLowerCase() === 'cash'
  const deliverable = (delivery: LiveDelivery) =>
    PICKUP_STAGE_STATUSES.includes(delivery.status) &&
    delivery.purchasing_cash_issued_at == null &&
    (delivery.cod_purchases?.length ?? 0) > 0

  const purchasingStatus = (delivery: LiveDelivery) => {
    if (delivery.purchasing_cash_issued_at == null) {
      return (
        <button
          type="button"
          disabled={!deliverable(delivery) || issueCashMutation.isPending}
          onClick={() => issueCashMutation.mutate(delivery.id)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#B45309] hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white px-3 py-1.5 text-xs font-semibold transition"
        >
          <Wallet className="w-3.5 h-3.5" /> Issue Cash
        </button>
      )
    }
    return (
      <div className="flex items-center gap-1.5 text-xs font-semibold text-[#B45309]">
        <Banknote className="w-3.5 h-3.5" />
        ₱{Number(delivery.purchasing_cash ?? 0).toFixed(2)} · {delivery.purchasing_cash_received_at ? 'Received' : 'Issued'}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Live Deliveries</h1>
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#16803C] opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#16803C]" />
          </span>
        </div>
        <p className="mt-1 text-sm lg:text-base text-[#6B7280]">
          Real-time view of active deliveries
          <span className="text-[#9CA3AF] ml-2">(auto-refreshes every 10s)</span>
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-tourism">
        {deliveries.length === 0 ? (
          <div className="p-12 text-center">
            <Truck className="w-10 h-10 mx-auto mb-3 text-[#9CA3AF]" />
            <p className="text-[#6B7280] font-medium">No Active Deliveries</p>
            <p className="text-sm text-[#9CA3AF] mt-1">
              There are currently no active deliveries in progress.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8E3] bg-[#F9FAFB]">
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Order
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Rider
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Pickup
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Delivery
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Status
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Purchasing Cash
                  </th>
                  <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E3]">
                {deliveries.map((delivery) => (
                  <tr key={delivery.id} className="hover:bg-[#F9FAFB] transition-colors">
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#EAF6ED] flex items-center justify-center">
                          <Package className="w-4 h-4 text-[#16803C]" />
                        </div>
                        <div>
                          <div className="font-medium text-[#17201A]">{delivery.order_number}</div>
                          <div className="text-xs text-[#6B7280]">{delivery.customer_name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      {delivery.rider_name ? (
                        <div>
                          <div className="text-[#17201A]">{delivery.rider_name}</div>
                          {delivery.rider_phone && (
                            <div className="text-xs text-[#6B7280]">{delivery.rider_phone}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-[#9CA3AF] text-xs">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 lg:px-6 py-3">
                      <div className="flex items-start gap-2 max-w-xs">
                        <MapPin className="w-3.5 h-3.5 text-[#16803C] mt-0.5 flex-shrink-0" />
                        <span className="text-[#6B7280] text-xs leading-relaxed">{delivery.pickup_address}</span>
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3">
                      <div className="flex items-start gap-2 max-w-xs">
                        <MapPin className="w-3.5 h-3.5 text-[#DC2626] mt-0.5 flex-shrink-0" />
                        <span className="text-[#6B7280] text-xs leading-relaxed">{delivery.delivery_address}</span>
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <StatusBadge status={delivery.status} />
                        {isCod(delivery) && PICKUP_STAGE_STATUSES.includes(delivery.status) && (
                          <span className="text-[10px] font-bold uppercase tracking-wide text-[#B45309] rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5">
                            COD
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">{purchasingStatus(delivery)}</td>
                    <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-[#6B7280] text-xs">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(delivery.updated_at)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}