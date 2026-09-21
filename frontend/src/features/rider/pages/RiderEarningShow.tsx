import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Bike, MapPin, Package, Wallet } from 'lucide-react'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'

interface EarningDetail {
  id: number
  order_number: string
  business_name: string
  status: string
  payment_method: string
  payment_status: string
  customer_payment: number
  delivery_fee: number
  tip: number
  rider_commission: number
  earnings: number
  pickup_address: string | null
  delivery_address: string | null
  distance_km: number | null
  estimated_duration_minutes: number | null
  assigned_at: string | null
  picked_up_at: string | null
  completed_at: string | null
  items: { name: string; quantity: number; subtotal: number }[]
}

export default function RiderEarningShow() {
  const navigate = useNavigate()
  const { deliveryId } = useParams()
  const { data, isLoading, isError } = useQuery<EarningDetail>({
    queryKey: ['rider-earning', deliveryId],
    queryFn: () => get(`/rider/earnings/${deliveryId}`),
    enabled: Boolean(deliveryId),
  })

  if (isLoading) return <DashboardSkeleton />

  if (isError || !data) {
    return (
      <div className="bg-white rounded-2xl border border-[#E5E9E7] p-10 text-center">
        <p className="text-[#6B7280]">This delivery earning could not be found.</p>
        <button onClick={() => navigate('/rider/earnings')} className="mt-4 text-sm font-semibold text-[#087F3F] hover:underline">
          Back to Earnings
        </button>
      </div>
    )
  }

  return (
    <div>
      <button onClick={() => navigate('/rider/earnings')} className="inline-flex items-center gap-2 text-sm font-medium text-[#087F3F] hover:text-[#065F2F]">
        <ArrowLeft className="w-4 h-4" /> Back to Earnings
      </button>

      <div className="mt-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#E9F7EF] flex items-center justify-center">
              <Bike className="w-6 h-6 text-[#087F3F]" />
            </div>
            <div>
              <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">{data.order_number}</h1>
              <p className="mt-1 text-sm text-[#6B7280]">{data.business_name}</p>
            </div>
          </div>
        </div>
        <span className="self-start rounded-full bg-[#E9F7EF] px-3 py-1.5 text-xs font-semibold capitalize text-[#087F3F]">
          {data.status.replaceAll('_', ' ')}
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          <section className="bg-white rounded-2xl border border-[#E5E9E7] p-5">
            <h2 className="font-semibold text-[#17201B] flex items-center gap-2"><MapPin className="w-4 h-4 text-[#087F3F]" /> Delivery Information</h2>
            <div className="mt-4 space-y-3 text-sm">
              <div><p className="text-xs text-[#6B7280]">Pickup</p><p className="text-[#17201B]">{data.pickup_address || 'Not available'}</p></div>
              <div><p className="text-xs text-[#6B7280]">Customer delivery address</p><p className="text-[#17201B]">{data.delivery_address || 'Not available'}</p></div>
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-[#6B7280]">Distance</p><p className="text-[#17201B]">{data.distance_km != null ? `${Number(data.distance_km).toFixed(2)} km` : 'Not available'}</p></div>
                <div><p className="text-xs text-[#6B7280]">Estimated duration</p><p className="text-[#17201B]">{data.estimated_duration_minutes ? `${data.estimated_duration_minutes} minutes` : 'Not available'}</p></div>
              </div>
            </div>
          </section>

          <section className="bg-white rounded-2xl border border-[#E5E9E7] p-5">
            <h2 className="font-semibold text-[#17201B] flex items-center gap-2"><Package className="w-4 h-4 text-[#087F3F]" /> Order Items</h2>
            <div className="mt-4 divide-y divide-[#E5E9E7]">
              {data.items.length > 0 ? data.items.map((item, index) => (
                <div key={`${item.name}-${index}`} className="flex justify-between gap-3 py-3 text-sm">
                  <span className="text-[#4B5563]">{item.quantity} × {item.name}</span>
                  <span className="font-medium text-[#17201B]">{formatCurrency(item.subtotal)}</span>
                </div>
              )) : <p className="text-sm text-[#6B7280]">No item details available.</p>}
            </div>
          </section>
        </div>

        <section className="bg-white rounded-2xl border border-[#E5E9E7] p-5 h-fit">
          <h2 className="font-semibold text-[#17201B] flex items-center gap-2"><Wallet className="w-4 h-4 text-[#F4B400]" /> Payment & Earnings</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-[#6B7280]">Payment method</span><span className="capitalize text-[#17201B]">{data.payment_method}</span></div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Payment status</span><span className="capitalize text-[#17201B]">{data.payment_status}</span></div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Cash to collect</span><span className="text-[#17201B]">{data.customer_payment > 0 ? formatCurrency(data.customer_payment) : 'Online'}</span></div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Rider commission</span><span className="text-[#17201B]">{formatCurrency(data.rider_commission)}</span></div>
            <div className="flex justify-between"><span className="text-[#6B7280]">Rider tip</span><span className="text-[#A87500]">{formatCurrency(data.tip)}</span></div>
            <div className="flex justify-between border-t border-[#E5E9E7] pt-3 font-bold"><span className="text-[#17201B]">Total earned</span><span className="text-[#087F3F]">{formatCurrency(data.earnings)}</span></div>
          </div>
        </section>
      </div>

      <section className="mt-4 bg-white rounded-2xl border border-[#E5E9E7] p-5">
        <h2 className="font-semibold text-[#17201B]">Delivery Timeline</h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div><p className="text-xs text-[#6B7280]">Assigned</p><p className="text-[#17201B]">{data.assigned_at ? formatDateTime(data.assigned_at) : 'Not available'}</p></div>
          <div><p className="text-xs text-[#6B7280]">Picked up</p><p className="text-[#17201B]">{data.picked_up_at ? formatDateTime(data.picked_up_at) : 'Not available'}</p></div>
          <div><p className="text-xs text-[#6B7280]">Completed</p><p className="text-[#17201B]">{data.completed_at ? formatDateTime(data.completed_at) : 'Not completed'}</p></div>
        </div>
      </section>
    </div>
  )
}
