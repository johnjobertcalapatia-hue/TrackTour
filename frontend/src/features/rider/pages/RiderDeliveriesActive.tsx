import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch, post } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime, formatCurrency } from '@/shared/utils'
import type { Delivery } from '@/shared/types'
import { MapPin, Navigation, X, Banknote, Loader2 } from 'lucide-react'

export default function RiderDeliveriesActive() {
  const queryClient = useQueryClient()
  const fetchUser = useAuthStore((s) => s.fetchUser)
  const [settleDelivery, setSettleDelivery] = useState<Delivery | null>(null)
  const [cashReceived, setCashReceived] = useState('')
  const [cancelRideDelivery, setCancelRideDelivery] = useState<Delivery | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['rider-deliveries-active'],
    queryFn: () => get<{ data: Delivery[] }>('/rider/deliveries/active'),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      patch(`/rider/deliveries/${id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['rider-deliveries-active'] }),
  })

  const settleMutation = useMutation({
    mutationFn: ({ id, cash_received }: { id: number; cash_received: number }) =>
      post(`/rider/deliveries/${id}/settle-cod`, { cash_received }),
    onSuccess: () => {
      setSettleDelivery(null)
      setCashReceived('')
      queryClient.invalidateQueries({ queryKey: ['rider-deliveries-active'] })
      // Settling the last COD delivery ends the trip on the backend —
      // reconcile rider_status from the server instead of assuming it.
      void fetchUser()
    },
  })

  // Phase 6 — driver-cancelled handler: release an accepted ride BEFORE pickup.
  const cancelRideMutation = useMutation({
    mutationFn: (id: number) => post(`/rider/deliveries/${id}/cancel-ride`, { reason: 'Driver unavailable' }),
    onSuccess: () => {
      setCancelRideDelivery(null)
      queryClient.invalidateQueries({ queryKey: ['rider-deliveries-active'] })
      // The backend released rider_status — reconcile from the server.
      void fetchUser()
    },
  })

  if (isLoading) return <DashboardSkeleton />

  const deliveries = data?.data ?? []

  const cashDue = settleDelivery?.cash_due ?? 0
  const received = parseFloat(cashReceived) || 0
  const changePreview = received >= cashDue ? received - cashDue : 0

  const confirmSettlement = () => {
    if (settleDelivery && received >= cashDue) {
      settleMutation.mutate({ id: settleDelivery.id, cash_received: received })
    }
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Active Deliveries</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Your current deliveries in progress</p>
      </div>

      {deliveries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E5E9E7] p-12 text-center">
          <Navigation className="w-12 h-12 text-[#9CA3AF] mx-auto mb-4" />
          <p className="text-[#6B7280]">No active deliveries. Accept a delivery to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {deliveries.map((d) => (
            <div key={d.id} className="bg-white rounded-2xl border border-[#E5E9E7] p-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-[#17201B]">Order #{d.order_id}</span>
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
                        <p className="text-xs text-[#9CA3AF]">Delivery</p>
                        <p className="text-[#4B5563]">{d.delivery_address}</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-[#9CA3AF]">{formatDateTime(d.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  {d.status === 'assigned' && (
                    <button
                      onClick={() => updateMutation.mutate({ id: d.id, status: 'arrived_pickup' })}
                      disabled={updateMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
                    >
                      Start Delivery
                    </button>
                  )}
                  {d.status === 'arrived_pickup' && (
                    <span className="text-xs text-[#9CA3AF] font-medium">
                      Confirm pickup on the delivery map after all food is collected.
                    </span>
                  )}
                  {d.status === 'picked_up' && (
                    <button
                      onClick={() => updateMutation.mutate({ id: d.id, status: 'arrived_destination' })}
                      disabled={updateMutation.isPending}
                      className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
                    >
                      Arrived at Destination
                    </button>
                  )}
                  {d.status === 'arrived_destination' && (
                    <button
                      onClick={() => updateMutation.mutate({ id: d.id, status: 'delivered' })}
                      disabled={updateMutation.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
                    >
                      Mark Delivered
                    </button>
                  )}
                  {d.order_type === 'transport' && ['assigned', 'arrived_pickup'].includes(d.status) && (
                    <button
                      onClick={() => {
                        setCancelRideDelivery(d)
                      }}
                      disabled={cancelRideMutation.isPending}
                      className="border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 px-4 py-2.5 rounded-xl text-sm font-semibold transition"
                    >
                      Cancel Ride
                    </button>
                  )}
                  {d.status === 'delivered' && d.is_cod && (
                    <button
                      onClick={() => {
                        setSettleDelivery(d)
                        setCashReceived('')
                      }}
                      className="bg-[#FFD700] hover:bg-[#E6C200] text-[#17201B] px-4 py-2.5 rounded-xl text-sm font-semibold transition flex items-center gap-2"
                    >
                      <Banknote className="w-4 h-4" />
                      Collect Cash
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* COD Cash Settlement Modal */}
      {settleDelivery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl border border-[#E5E9E7] shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E9E7]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                  <Banknote className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-[#17201B]">Cash on Delivery</h3>
                  <p className="text-xs text-[#6B7280]">Order #{settleDelivery.order_id}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setSettleDelivery(null)
                  setCashReceived('')
                }}
                className="text-[#9CA3AF] hover:text-[#374151] transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-5 space-y-4">
              <div className="bg-[#F8FAF9] rounded-xl p-4">
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Amount due</span>
                  <span className="font-semibold text-[#17201B]">{formatCurrency(cashDue)}</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#6B7280] mb-1.5">
                  Cash received from customer
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280] font-medium">₱</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashReceived}
                    onChange={(e) => setCashReceived(e.target.value)}
                    placeholder="0.00"
                    className="w-full pl-8 pr-4 py-3 bg-[#F8FAF9] border border-[#E5E9E7] rounded-xl text-[#17201B] placeholder-[#9CA3AF] focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                  />
                </div>
                <button
                  onClick={() => setCashReceived(cashDue.toString())}
                  className="mt-2 text-xs text-emerald-600 hover:text-emerald-700 transition"
                >
                  Exact amount: {formatCurrency(cashDue)}
                </button>
              </div>

              {received > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280]">Change to give</span>
                  <span className={`font-semibold ${received >= cashDue ? 'text-emerald-600' : 'text-red-600'}`}>
                    {received >= cashDue
                      ? formatCurrency(changePreview)
                      : `Short by ${formatCurrency(cashDue - received)}`}
                  </span>
                </div>
              )}

              {settleMutation.isError && (
                <div className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
                  {(settleMutation.error as Error)?.message ?? 'Settlement failed. Please try again.'}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-[#E5E9E7]">
              <button
                onClick={confirmSettlement}
                disabled={received < cashDue || settleMutation.isPending}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-[#D1D5DB] disabled:cursor-not-allowed text-white font-bold rounded-xl transition flex items-center justify-center gap-2"
              >
                {settleMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Settling...
                  </>
                ) : (
                  <>
                    <Banknote className="w-4 h-4" />
                    Confirm Cash Received
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Ride Confirmation Modal */}
      {cancelRideDelivery && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-ride-title"
        >
          <div className="bg-white rounded-2xl border border-[#E5E9E7] shadow-2xl w-full max-w-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E9E7]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                  <X className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 id="cancel-ride-title" className="font-semibold text-[#17201B]">
                    Cancel ride
                  </h3>
                  <p className="text-xs text-[#6B7280]">Ride #{cancelRideDelivery.order_id}</p>
                </div>
              </div>
              <button
                onClick={() => setCancelRideDelivery(null)}
                aria-label="Close cancellation dialog"
                className="text-[#9CA3AF] hover:text-[#374151] transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-5 py-5">
              <p className="text-sm text-[#4B5563]">
                Cancelling releases this ride back to the tourist. You will be notified when a new trip is
                available.
              </p>
              {cancelRideMutation.isError && (
                <div className="mt-4 text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3">
                  {(cancelRideMutation.error as Error)?.message ?? 'Cancellation failed. Please try again.'}
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-[#E5E9E7] flex gap-3">
              <button
                onClick={() => setCancelRideDelivery(null)}
                className="flex-1 py-3 border border-[#E5E9E7] hover:bg-[#F8FAF9] text-[#374151] font-semibold rounded-xl transition"
              >
                Keep ride
              </button>
              <button
                onClick={() => cancelRideMutation.mutate(cancelRideDelivery.id)}
                disabled={cancelRideMutation.isPending}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 disabled:bg-[#FECACA] disabled:cursor-not-allowed text-white font-bold rounded-xl transition flex items-center justify-center gap-2"
              >
                {cancelRideMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cancelling...
                  </>
                ) : (
                  'Cancel ride'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}