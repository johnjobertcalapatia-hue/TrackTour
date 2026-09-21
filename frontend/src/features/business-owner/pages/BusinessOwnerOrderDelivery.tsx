import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency } from '@/shared/utils'
import { Link } from 'react-router-dom'
import { Truck, MapPin, User, Package, Eye } from 'lucide-react'

interface DeliveryWithOrder {
  id: number
  order_id: number
  order_number: string
  rider_name: string | null
  rider_phone: string | null
  status: string
  pickup_address: string
  delivery_address: string
  amount: number
  business_name: string
  customer_name: string
  assigned_at: string | null
  picked_up_at: string | null
  delivered_at: string | null
  created_at: string
}

const DELIVERY_STEPS = [
  { key: 'pending', label: 'Pending' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
]

const STEP_INDEX = DELIVERY_STEPS.reduce((acc, step, i) => ({ ...acc, [step.key]: i }), {} as Record<string, number>)

function DeliveryTimeline({ status }: { status: string }) {
  const currentIdx = STEP_INDEX[status] ?? 0

  return (
    <div className="flex items-center w-full gap-1">
      {DELIVERY_STEPS.map((step, i) => {
        const isActive = i <= currentIdx
        const isCurrent = step.key === status
        return (
          <div key={step.key} className="flex-1 flex flex-col items-center">
            <div className="flex items-center w-full">
              <div className={`w-full h-1.5 rounded-full transition ${i === 0 ? 'rounded-l-full' : ''} ${i === DELIVERY_STEPS.length - 1 ? 'rounded-r-full' : ''} ${
                isActive ? 'bg-[#16803C]' : 'bg-[#E2E8E3]'
              }`} />
            </div>
            <span className={`text-[10px] mt-1.5 whitespace-nowrap ${isCurrent ? 'text-[#16803C] font-semibold' : isActive ? 'text-[#4B5563]' : 'text-[#647067]'}`}>
              {step.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function BusinessOwnerOrderDelivery() {
  const { data, isLoading } = useQuery({
    queryKey: ['bo-deliveries'],
    queryFn: () => get<DeliveryWithOrder[]>('/business-owner/orders/deliveries'),
  })

  if (isLoading) return <DashboardSkeleton />

  const deliveries = data ?? []

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Deliveries</h1>
        <p className="mt-1 text-sm text-[#647067]">Track and manage active deliveries</p>
      </div>

      {deliveries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <Truck className="w-12 h-12 text-[#647067] mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-[#17201A] mb-2">No Active Deliveries</h3>
          <p className="text-[#647067]">There are no deliveries to display at this time.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {deliveries.map((delivery) => (
            <div key={delivery.id} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-[#EAF6ED] border border-[#D7E8DB] rounded-xl flex items-center justify-center">
                    <Package className="w-5 h-5 text-[#16803C]" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[#17201A]">{delivery.order_number}</h3>
                    <p className="text-xs text-[#647067]">{delivery.business_name}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={delivery.status} size="md" />
                  <Link
                    to={`/business-owner/orders/${delivery.order_id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-[#16803C] hover:bg-[#F3F8F4] transition border border-[#D7E8DB]"
                  >
                    <Eye className="w-3.5 h-3.5" /> View Order
                  </Link>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                <div className="flex items-start gap-2">
                  <User className="w-4 h-4 text-[#647067] mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-[#647067] uppercase tracking-wider">Customer</p>
                    <p className="text-sm text-[#17201A] mt-0.5">{delivery.customer_name}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-[#647067] mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-[#647067] uppercase tracking-wider">Pickup</p>
                    <p className="text-sm text-[#17201A] mt-0.5">{delivery.pickup_address}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-[#647067] mt-0.5" />
                  <div>
                    <p className="text-[11px] font-medium text-[#647067] uppercase tracking-wider">Delivery</p>
                    <p className="text-sm text-[#17201A] mt-0.5">{delivery.delivery_address}</p>
                  </div>
                </div>
              </div>

              {delivery.rider_name && (
                <div className="flex items-center gap-2 mb-4 text-sm">
                  <Truck className="w-4 h-4 text-[#647067]" />
                  <span className="text-[#647067]">Rider:</span>
                  <span className="text-[#17201A]">{delivery.rider_name}</span>
                  {delivery.rider_phone && <span className="text-[#647067]">({delivery.rider_phone})</span>}
                </div>
              )}

              <div className="mb-3">
                <DeliveryTimeline status={delivery.status} />
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[#E2E8E3]">
                <span className="text-xs text-[#647067]">Amount</span>
                <span className="text-sm font-semibold text-[#16803C]">{formatCurrency(delivery.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
