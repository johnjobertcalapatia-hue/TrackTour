import { useCallback, useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { ChefHat, Clock, CheckCircle, ArrowRight, RefreshCw, AlertCircle, Utensils } from 'lucide-react'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { useBusinessSocketNotifier } from '@/shared/hooks/useBusinessSocketNotifier'

interface KitchenOrderItem {
  id: number
  product_name: string
  quantity: number
  notes: string | null
}

interface KitchenOrder {
  id: number
  order_number: string
  customer_name: string
  status: string
  order_type: string
  notes: string | null
  elapsed_minutes: number
  items: KitchenOrderItem[]
  created_at: string
  updated_at: string
}

interface KitchenResponse {
  orders: {
    preparing: KitchenOrder[]
    ready: KitchenOrder[]
    completed: KitchenOrder[]
  }
  counts: {
    preparing: number
    ready: number
    completed: number
  }
}

const statusIcons = {
  confirmed: Clock,
  preparing: ChefHat,
  ready: CheckCircle,
}

function elapsedDisplay(minutes: number): string {
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
}

function OrderCard({
  order,
  onStatus,
}: {
  order: KitchenOrder
  onStatus: (id: number, status: string) => void
}) {
  const elapsed = order.status === 'accepted' || order.status === 'preparing'
    ? elapsedDisplay(order.elapsed_minutes)
    : null

  const isAging = order.elapsed_minutes > 15 && (order.status === 'accepted' || order.status === 'preparing')

  return (
    <div className={`bg-white rounded-2xl border shadow-lg overflow-hidden transition-all ${isAging ? 'border-[#FECACA] ring-1 ring-red-500/20' : 'border-[#E2E8E3]'}`}>
      <div className={`px-4 py-3 border-b flex items-center justify-between ${isAging ? 'bg-[#FEF2F2] border-[#FECACA]' : 'bg-[#F3F8F4] border-[#E2E8E3]'}`}>
        <div className="flex items-center gap-2 min-w-0">
          <Utensils className="w-4 h-4 text-[#647067] shrink-0" />
          <span className="font-bold text-[#17201A] truncate">{order.order_number ?? `#${order.id}`}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {elapsed && (
            <span className={`flex items-center gap-1 text-xs font-medium ${isAging ? 'text-[#B91C1C]' : 'text-[#647067]'}`}>
              <Clock className="w-3 h-3" />
              {elapsed}
            </span>
          )}
          <span className="text-[10px] uppercase tracking-wider text-[#647067] bg-[#F3F8F4] px-2 py-0.5 rounded-md">
            {order.order_type}
          </span>
        </div>
      </div>

      {order.notes && (
        <div className="px-4 py-2 bg-[#FFF7D6] border-b border-[#F4B400]/40">
          <p className="text-xs text-[#A66F00] flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 shrink-0" />
            {order.notes}
          </p>
        </div>
      )}

      <div className="px-4 py-3 space-y-1.5">
        {order.items.map((item) => (
          <div key={item.id} className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-6 h-6 rounded-lg bg-[#F3F8F4] flex items-center justify-center text-xs font-bold text-[#16803C] shrink-0">
                {item.quantity}
              </span>
              <span className="text-sm font-medium text-[#17201A] truncate">{item.product_name}</span>
            </div>
            {item.notes && (
              <span className="text-[10px] text-[#647067] italic ml-2 shrink-0">({item.notes})</span>
            )}
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t border-[#E2E8E3]">
        {order.status === 'accepted' && (
          <button
            onClick={() => onStatus(order.id, 'preparing')}
            className="w-full py-2.5 rounded-xl bg-[#16803C] hover:bg-[#126B32] active:bg-[#126B32] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <ChefHat className="w-4 h-4" /> Start Preparing
          </button>
        )}
        {order.status === 'preparing' && (
          <button
            onClick={() => onStatus(order.id, 'ready')}
            className="w-full py-2.5 rounded-xl bg-[#16803C] hover:bg-[#126B32] active:bg-[#126B32] text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
          >
            <CheckCircle className="w-4 h-4" /> Mark as Ready
          </button>
        )}
        {order.status === 'ready' && (
          <div className="text-center py-1.5 text-[#16803C] text-xs font-medium flex items-center justify-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" /> Ready for Pickup
          </div>
        )}
      </div>
    </div>
  )
}

export default function BusinessOwnerKitchen() {
  const queryClient = useQueryClient()
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const [pollInterval, setPollInterval] = useState(10000)

  // P11.5 — realtime status events for the selected business; each event
  // immediately re-fetches the kitchen queue (HTTP remains the fallback).
  const { connection } = useBusinessSocketNotifier({
    businessId: selectedBusinessId ?? null,
    onStatusEvent: useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['bo-kitchen-orders'] })
    }, [queryClient]),
  })

  const queryParams = selectedBusinessId ? `?business_id=${selectedBusinessId}` : ''

  const { data, isLoading } = useQuery<KitchenResponse>({
    queryKey: ['bo-kitchen-orders', selectedBusinessId],
    queryFn: () => get<KitchenResponse>(`/business-owner/kitchen/orders${queryParams}`),
    refetchInterval: pollInterval,
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      patch(`/business-owner/kitchen/orders/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-kitchen-orders'] })
    },
  })

  const handleStatus = (id: number, status: string) => {
    statusMutation.mutate({ id, status })
  }

  const preparing = data?.orders?.preparing ?? []
  const ready = data?.orders?.ready ?? []
  const counts = data?.counts ?? { preparing: 0, ready: 0, completed: 0 }
  const hasOrders = preparing.length > 0 || ready.length > 0

  const togglePolling = () => {
    setPollInterval((prev) => (prev === 0 ? 10000 : 0))
  }

  return (
    <div className="min-h-screen">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ChefHat className="w-8 h-8 text-[#16803C]" />
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Kitchen Display</h1>
            <p className="text-sm text-[#647067]">Live kitchen order queue</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={togglePolling}
            className={`p-2 rounded-xl border transition ${
              pollInterval === 0
                ? 'border-[#D7E8DB] text-[#647067] bg-white'
                : 'border-[#BFE3CB] text-[#16803C] bg-[#EAF6ED]'
            }`}
            title={pollInterval === 0 ? 'Auto-refresh is paused' : 'Auto-refreshing every 10s'}
          >
            <RefreshCw className={`w-4 h-4 ${pollInterval === 0 ? '' : 'animate-spin'}`} />
          </button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-[#FFF7D6] border border-[#F4B400]/40 rounded-2xl p-5 text-center">
          <p className="text-3xl font-bold text-[#A66F00]">{counts.preparing}</p>
          <p className="text-sm text-[#A66F00]/70 mt-1">Preparing</p>
        </div>
        <div className="bg-[#EAF6ED] border border-[#BFE3CB] rounded-2xl p-5 text-center">
          <p className="text-3xl font-bold text-[#16803C]">{counts.ready}</p>
          <p className="text-sm text-[#16803C]/70 mt-1">Ready</p>
        </div>
        <div className="bg-[#F3F8F4] border border-[#E2E8E3] rounded-2xl p-5 text-center">
          <p className="text-3xl font-bold text-[#647067]" id="completed-count">{counts.completed}</p>
          <p className="text-sm text-[#647067] mt-1">Completed Today</p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#16803C]" />
        </div>
      ) : !hasOrders ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] py-20 text-center">
          <ChefHat className="w-16 h-16 text-[#647067] mx-auto mb-4" />
          <p className="text-[#647067] text-lg font-medium">No active orders</p>
          <p className="text-[#647067] text-sm mt-1">New orders will appear here once customers place them</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-4">
              <ChefHat className="w-5 h-5 text-[#A66F00]" />
              <h2 className="text-lg font-bold text-[#17201A]">Preparing</h2>
              <span className="text-xs text-[#647067] bg-[#F3F8F4] px-2 py-0.5 rounded-full">{preparing.length}</span>
            </div>
            <div className="space-y-4">
              {preparing.map((order) => (
                <OrderCard key={order.id} order={order} onStatus={handleStatus} />
              ))}
              {preparing.length === 0 && (
                <div className="text-center py-12 text-[#647067] text-sm border-2 border-dashed border-[#E2E8E3] rounded-2xl">
                  No orders in preparation
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle className="w-5 h-5 text-[#16803C]" />
              <h2 className="text-lg font-bold text-[#17201A]">Ready to Serve</h2>
              <span className="text-xs text-[#647067] bg-[#F3F8F4] px-2 py-0.5 rounded-full">{ready.length}</span>
            </div>
            <div className="space-y-4">
              {ready.map((order) => (
                <OrderCard key={order.id} order={order} onStatus={handleStatus} />
              ))}
              {ready.length === 0 && (
                <div className="text-center py-12 text-[#647067] text-sm border-2 border-dashed border-[#E2E8E3] rounded-2xl">
                  No ready orders
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Auto-scroll sound-less animation - subtle pulse on new orders */}
      {pollInterval > 0 && hasOrders && (
        <div className="fixed bottom-4 right-4 flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E2E8E3] rounded-full text-xs text-[#647067]">
          <span className={`w-2 h-2 rounded-full animate-pulse ${connection === 'connected' ? 'bg-[#16803C]' : 'bg-[#F4B400]'}`} />
          {connection === 'connected' ? 'Live' : connection === 'reconnecting' ? 'Reconnecting…' : `Polling ${pollInterval / 1000}s`}
        </div>
      )}
    </div>
  )
}
