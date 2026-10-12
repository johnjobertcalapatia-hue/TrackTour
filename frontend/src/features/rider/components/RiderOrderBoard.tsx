import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, MapPin, Store, CheckCircle2, Wallet, Navigation } from 'lucide-react'
import { get, patch } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { cn } from '@/shared/utils'

export interface BoardRestaurantItem {
  name: string
  quantity: number
  price: number
  subtotal: number
}

export interface BoardRestaurant {
  business_id?: number | null
  name: string
  address?: string | null
  latitude?: number | null
  longitude?: number | null
  items: BoardRestaurantItem[]
}

export interface BoardOrder {
  id?: number | null
  delivery_id: number | null
  order_id?: number | null
  order_number?: string
  business_name?: string
  business_address?: string | null
  subtotal?: number
  pickup_address?: string | null
  delivery_address?: string | null
  rider_commission?: number | null
  rider_payout?: number
  distance_km?: number | null
  duration_minutes?: number
  stops?: number
  restaurant_count?: number
  delivery_fee?: number
  cod_amount?: number
  cod?: boolean
  items?: BoardRestaurantItem[]
  restaurants?: BoardRestaurant[]
  dispatched_at?: string | null
  expires_in?: number | null
  rider_status: string
  can_accept?: boolean
  accept_blocked_reason?: string | null
}

export interface BoardEligibility {
  online?: boolean
  available?: boolean
  account_approved?: boolean
  suspended?: boolean
  has_active_delivery?: boolean
  active_orders?: number
  active_order_limit?: number
  rider_status?: string | null
  current_service?: string | null
  location_ok?: boolean
  location_age_seconds?: number | null
  max_pickup_distance_km?: number
}

interface BoardResponse {
  eligibility?: BoardEligibility
  orders?: BoardOrder[]
}

const BOARD_QUERY_KEY = ['rider-board']

export function useRiderBoard() {
  return useQuery({
    queryKey: BOARD_QUERY_KEY,
    queryFn: async () => {
      const res = await get<BoardResponse>('/rider/dispatch/board')
      return { eligibility: res?.eligibility, orders: res?.orders ?? [] }
    },
    refetchInterval: 5000,
    staleTime: 3000,
    retry: false,
  })
}

export function boardBlockedLabel(reason?: string | null): string {
  switch (reason) {
    case 'offline':
      return 'Go online to accept'
    case 'unavailable':
      return 'Set availability to available'
    case 'location_stale':
      return 'Waiting for a fresh GPS location'
    case 'active_delivery':
      return 'Finish your active delivery first'
    case 'account_not_approved':
      return 'Account not approved'
    case 'out_of_range':
      return 'Too far to accept'
    case 'accepted_by_other':
      return 'Accepted by another rider'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Unavailable'
  }
}

function money(value?: number | null): string {
  return `₱${(value ?? 0).toFixed(2)}`
}

function readonlyLabel(order: BoardOrder): string {
  if (order.rider_status === 'accepted_by_other') return 'Accepted by another rider'
  if (order.rider_status === 'cancelled') return 'Cancelled'
  return 'Unavailable'
}

function OrderHeader({ order }: { order: BoardOrder }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-extrabold text-[#17202A]">
            {order.order_number ? `Order #${order.order_number}` : `Delivery #${order.delivery_id}`}
          </span>
          {order.cod && (
            <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">COD</span>
          )}
        </div>
        <p className="mt-0.5 truncate text-[11px] font-semibold text-[#68727C]">
          {order.business_name || 'Restaurant'}
          {order.restaurant_count && order.restaurant_count > 1 ? ` · ${order.restaurant_count} restaurants` : ''}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs font-bold text-[#087F3F]">{money(order.rider_payout ?? order.rider_commission)}</p>
        <p className="text-[10px] font-medium text-[#9CA3AF]">
          {order.distance_km != null ? `${order.distance_km.toFixed(1)} km` : ''}
          {order.distance_km != null && order.duration_minutes ? ' · ' : ''}
          {order.duration_minutes ? `~${order.duration_minutes} min` : ''}
        </p>
      </div>
    </div>
  )
}

function RestaurantCard({ restaurant }: { restaurant: BoardRestaurant }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-[#E4E9E6] bg-white px-3 py-2.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#EAF6ED]">
          <Store className="h-3.5 w-3.5 text-[#087F3F]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-[#17202A]">{restaurant.name}</span>
          <span className="block truncate text-[10px] font-medium text-[#9CA3AF]">{restaurant.address || '—'}</span>
        </span>
        <span className="shrink-0 text-[10px] font-semibold text-[#6B7280]">
          {restaurant.items.length} item{restaurant.items.length === 1 ? '' : 's'}
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-[#9CA3AF] transition-transform', open && 'rotate-180')} />
      </button>
      {open && restaurant.items.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-[#E4E9E6]/70 pt-2">
          {restaurant.items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[11px] font-medium text-[#68727C]">
                {item.quantity}× {item.name}
              </span>
              <span className="shrink-0 text-[11px] font-semibold text-[#17202A]">{money(item.subtotal ?? item.price * item.quantity)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionableOrderCard({
  order,
  accepting,
  onAccept,
}: {
  order: BoardOrder
  accepting: boolean
  onAccept: (order: BoardOrder) => void
}) {
  const [open, setOpen] = useState(false)
  const restaurants = order.restaurants ?? []
  const blocked = order.can_accept === false

  return (
    <div className="overflow-hidden rounded-xl border border-[#D7E8DB] bg-[#F5FBF7]">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full px-3 py-2.5 text-left">
        <div className="flex items-start gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#E9F7EF]">
            <Navigation className="h-3.5 w-3.5 text-[#087F3F]" />
          </span>
          <div className="min-w-0 flex-1">
            <OrderHeader order={order} />
          </div>
          <ChevronDown className={cn('mt-1 h-3.5 w-3.5 shrink-0 text-[#9CA3AF] transition-transform', open && 'rotate-180')} />
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 pl-9">
          <span className="rounded-md bg-[#EAF6ED] px-1.5 py-0.5 text-[10px] font-bold text-[#087F3F]">
            Looking for riders
          </span>
          {blocked && (
            <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
              {boardBlockedLabel(order.accept_blocked_reason)}
            </span>
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-2 border-t border-[#D7E8DB] px-3 py-2.5">
          {restaurants.length > 0 ? (
            restaurants.map((restaurant, index) => (
              <RestaurantCard key={restaurant.business_id ?? index} restaurant={restaurant} />
            ))
          ) : (
            <p className="text-[11px] font-medium text-[#68727C]">No item detail available.</p>
          )}

          <div className="flex items-start gap-1.5 pt-0.5">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
            <p className="min-w-0 flex-1 text-[11px] font-medium text-[#68727C]">
              {order.pickup_address || 'Pickup address unavailable'}
            </p>
          </div>
          <div className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
            <p className="min-w-0 flex-1 text-[11px] font-medium text-[#68727C]">
              {order.delivery_address || 'Drop-off address unavailable'}
            </p>
          </div>

          {order.cod && order.cod_amount != null && (
            <div className="flex items-center gap-1.5">
              <Wallet className="h-3 w-3 shrink-0 text-amber-600" />
              <p className="text-[11px] font-semibold text-amber-700">Collect {money(order.cod_amount)} cash on delivery</p>
            </div>
          )}

          <button
            type="button"
            disabled={blocked || accepting}
            onClick={() => onAccept(order)}
            className={cn(
              'mt-1 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition',
              blocked || accepting
                ? 'cursor-not-allowed bg-[#E5E9E7] text-[#9CA3AF]'
                : 'bg-[#087F3F] text-white hover:bg-[#06672F]'
            )}
          >
            {accepting ? 'Accepting…' : blocked ? boardBlockedLabel(order.accept_blocked_reason) : 'Accept order'}
          </button>
        </div>
      )}
    </div>
  )
}

function ReadOnlyOrderCard({ order }: { order: BoardOrder }) {
  return (
    <div className="rounded-xl border border-[#E4E9E6] bg-[#FAFBFB] px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-xs font-extrabold text-[#17202A]">
            {order.order_number ? `Order #${order.order_number}` : `Delivery #${order.delivery_id}`}
          </span>
          <p className="mt-0.5 truncate text-[11px] font-semibold text-[#68727C]">
            {order.business_name || 'Restaurant'}
            {order.restaurant_count && order.restaurant_count > 1 ? ` · ${order.restaurant_count} restaurants` : ''}
          </p>
        </div>
        <span className="shrink-0 text-[10px] font-medium text-[#9CA3AF]">
          {order.distance_km != null ? `${order.distance_km.toFixed(1)} km` : ''}
        </span>
      </div>
      <div className="mt-1.5">
        <span className="rounded-md bg-[#EEF1F0] px-1.5 py-0.5 text-[10px] font-semibold text-[#6B7280]">
          {readonlyLabel(order)}
        </span>
      </div>
    </div>
  )
}

export default function RiderOrderBoard() {
  const { data } = useRiderBoard()
  const queryClient = useQueryClient()
  const fetchUser = useAuthStore((s) => s.fetchUser)
  const [acceptingId, setAcceptingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const acceptMutation = useMutation({
    mutationFn: (deliveryId: number) => patch('/rider/dispatch/accept', { delivery_id: deliveryId }),
    onSuccess: () => {
      void fetchUser()
      setAcceptingId(null)
      setError(null)
      queryClient.invalidateQueries({ queryKey: BOARD_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['rider-map-location'] })
      queryClient.invalidateQueries({ queryKey: ['rider-active-trip'] })
      queryClient.invalidateQueries({ queryKey: ['rider-dashboard'] })
    },
    onError: (err) => {
      const e = err as { response?: { data?: { message?: string } } }
      setAcceptingId(null)
      setError(e.response?.data?.message || 'Failed to accept the order. Please try again.')
      queryClient.invalidateQueries({ queryKey: BOARD_QUERY_KEY })
    },
  })

  const orders = data?.orders ?? []
  if (orders.length === 0) return null

  const actionable = orders.filter((o) => o.rider_status === 'looking_for_riders')
  const readOnly = orders.filter((o) => o.rider_status !== 'looking_for_riders')
  const noneAcceptable = actionable.length > 0 && actionable.every((o) => o.can_accept === false)

  const handleAccept = (order: BoardOrder) => {
    if (!order.delivery_id) return
    setError(null)
    setAcceptingId(order.delivery_id)
    acceptMutation.mutate(order.delivery_id)
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7280]">Available orders</p>
        <span className="text-[10px] font-semibold text-[#9CA3AF]">{actionable.length}</span>
      </div>

      {noneAcceptable && data?.eligibility && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-[#FFF7ED] px-3 py-2">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-amber-600" />
          <p className="text-[11px] font-semibold text-amber-700">
            {!data.eligibility.location_ok
              ? 'Waiting for a fresh GPS location before you can accept.'
              : data.eligibility.has_active_delivery
                ? 'Finish your active delivery before accepting another.'
                : !data.eligibility.online
                  ? 'Go online to accept orders.'
                  : 'You are not eligible for these orders right now.'}
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-[11px] font-semibold text-red-700">{error}</p>
        </div>
      )}

      {actionable.map((order) => (
        <ActionableOrderCard
          key={`actionable-${order.delivery_id}`}
          order={order}
          accepting={acceptingId === order.delivery_id}
          onAccept={handleAccept}
        />
      ))}

      {readOnly.map((order) => (
        <ReadOnlyOrderCard key={`readonly-${order.delivery_id}`} order={order} />
      ))}
    </div>
  )
}
