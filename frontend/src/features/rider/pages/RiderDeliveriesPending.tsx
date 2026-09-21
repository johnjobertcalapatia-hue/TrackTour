import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { Delivery } from '@/shared/types'
import { MapPin, Navigation } from 'lucide-react'

export default function RiderDeliveriesPending() {
  const queryClient = useQueryClient()
  const currentService = useAuthStore((state) => state.user?.current_service)
  const isRideHailing = currentService === 'transport'

  const { data, isLoading } = useQuery({
    queryKey: ['rider-deliveries-pending'],
    queryFn: () => get<Delivery[]>('/rider/deliveries/pending'),
  })

  const acceptMutation = useMutation({
    mutationFn: (id: number) => patch('/rider/dispatch/accept', { delivery_id: id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rider-deliveries-pending'] }),
  })

  if (isLoading) return <DashboardSkeleton />

  const deliveries = data ?? []

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">
          {isRideHailing ? 'Available Bookings' : 'Available Deliveries'}
        </h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          {isRideHailing ? 'Accept bookings to start earning' : 'Accept deliveries to start earning'}
        </p>
      </div>

      {deliveries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] p-12 text-center">
          <Navigation className="w-12 h-12 text-[#9CA3AF] mx-auto mb-4" />
          <p className="text-[#6B7280]">
            No available {isRideHailing ? 'bookings' : 'deliveries'} right now. Check back soon!
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {deliveries.map((d) => (
            <div key={d.id} className="bg-white rounded-2xl border border-[#E5E9E7] p-5 hover:border-blue-500/30 transition-all duration-200">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-[#17201B]">
                      {isRideHailing ? 'Booking' : 'Order'} #{d.order_id}
                    </span>
                    <StatusBadge status={d.status} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-[#9CA3AF]">Pickup</p>
                        <p className="text-[#4B5563]">{d.pickup_address}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2 text-sm">
                      <MapPin className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-[#9CA3AF]">{isRideHailing ? 'Drop-off' : 'Delivery'}</p>
                        <p className="text-[#4B5563]">{d.delivery_address}</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-[#9CA3AF]">{formatDateTime(d.created_at)}</p>
                </div>
                <button
                  onClick={() => acceptMutation.mutate(d.id)}
                  disabled={acceptMutation.isPending}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition whitespace-nowrap"
                >
                  {acceptMutation.isPending
                    ? 'Accepting...'
                    : isRideHailing
                      ? 'Accept Booking'
                      : 'Accept Delivery'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
