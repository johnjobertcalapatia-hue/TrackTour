import { useEffect, useState } from 'react'
import { Truck, MapPin, Clock, Navigation, CheckCircle, XCircle, Zap } from 'lucide-react'

export interface ModifierLine {
  name: string
  quantity?: number
  price?: number
}

export interface ReceiptItem {
  name: string
  quantity: number
  price: number
  subtotal?: number
  modifiers?: ModifierLine[]
}

export interface RiderDeliveryRequestData {
  id?: number
  delivery_id?: number
  order_id?: number
  order_number?: string
  business_name?: string
  business_address?: string
  subtotal?: number
  pickup_address?: string | null
  delivery_address?: string | null
  rider_commission?: number | null
  rider_payout?: number
  distance_km?: number | null
  duration_minutes?: number
  items?: ReceiptItem[]
  stops?: number
  restaurant_count?: number
  cod_amount?: number
  expires_in?: number
  initial_timeout?: number
}

interface Props {
  orderData: RiderDeliveryRequestData | null
  onAccept: () => void
  onDecline: () => void
  acceptPending?: boolean
  declinePending?: boolean
}

export default function RiderDeliveryRequestAlert({
  orderData,
  onAccept,
  onDecline,
  acceptPending = false,
  declinePending = false,
}: Props) {
  const [timeLeft, setTimeLeft] = useState<number | null>(null)

  useEffect(() => {
    const initial = orderData?.initial_timeout ?? 45
    setTimeLeft(initial)
  }, [orderData?.delivery_id])

  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return
    const timer = setInterval(() => setTimeLeft((prev) => (prev === null || prev <= 0 ? prev : prev - 1)), 1000)
    return () => clearInterval(timer)
  }, [timeLeft])

  useEffect(() => {
    if (timeLeft !== 0) return
    if (orderData) {
      onDecline()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, orderData?.delivery_id])

  if (!orderData) return null

  const items = orderData.items ?? []
  const itemCount = items.reduce((acc, item) => acc + (item.quantity || 0), 0)
  const initialTimeout = orderData.initial_timeout ?? 45
  const currentSeconds = timeLeft ?? initialTimeout
  const progressPercentage = Math.max(0, Math.min(100, (currentSeconds / initialTimeout) * 100))
  const isUrgent = currentSeconds <= 7

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-zinc-950/70 backdrop-blur-2xl w-full max-w-md rounded-2xl border border-white/10 shadow-2xl flex flex-col max-h-[85vh] animate-slide-up">
        {/* HEADER PANEL BANNER */}
        <div className="p-4 border-b border-white/10 text-center bg-white/5 rounded-t-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-full text-xs font-bold uppercase tracking-wider mb-1">
            <Zap className="w-3 h-3" />
            Live Delivery Offer
          </div>
          <h2 className="text-lg font-extrabold text-white tracking-tight">New Booking Request</h2>
          <p className="text-xs text-zinc-400">Review parameters inside the receipt slot below</p>
        </div>

        {/* SCROLLABLE DIGITAL RECEIPT CONTAINER AREA */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {/* THE FOOD/ITEM DIGITAL SPECIFICATION SLATE */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 shadow-inner">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-mono text-zinc-400">ID: {orderData.order_number ?? `TT-${String(orderData.order_id ?? 0).padStart(5, '0')}`}</span>
              <span className="text-xs bg-white/10 px-2 py-0.5 rounded text-white font-medium">{itemCount} Items</span>
            </div>
            <h3 className="text-base font-bold text-white mb-3 truncate">{orderData.business_name ?? 'Merchant Store'}</h3>

            {items.length > 0 ? (
              <div className="space-y-2.5 border-t border-b border-dashed border-white/15 py-3 text-sm">
                {items.map((item, idx) => (
                  <div key={idx} className="space-y-0.5">
                    <div className="flex justify-between text-zinc-300">
                      <div className="flex gap-2">
                        <span className="font-bold text-emerald-500">{item.quantity}×</span>
                        <span className="truncate max-w-[200px] font-medium">{item.name}</span>
                      </div>
                      <span className="font-mono text-white">
                        ₱{(item.subtotal ?? item.price * item.quantity).toFixed(2)}
                      </span>
                    </div>
                    {item.modifiers?.map((mod, mIdx) => (
                      <div key={mIdx} className="pl-6 text-xs text-zinc-500 flex justify-between">
                        <span>+ {mod.name} (×{mod.quantity || 1})</span>
                        <span>₱{((mod.price || 0) * (mod.quantity || 1)).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="border-t border-b border-dashed border-white/15 py-4 text-sm text-zinc-500 text-center">
                No item details provided for this order.
              </div>
            )}

            <div className="flex justify-between items-center mt-3 pt-1 text-sm font-semibold">
              <span className="text-zinc-400">Store Subtotal Reference</span>
              <span className="text-white font-mono">₱{Number(orderData.subtotal ?? 0).toFixed(2)}</span>
            </div>
          </div>

          {/* WAYPOINT DIRECTION PATH SUMMARY */}
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
            {/* Pickup Segment */}
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-emerald-500/10 border border-emerald-500 flex items-center justify-center text-emerald-400 text-xs shrink-0 mt-0.5 font-bold">
                P
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-zinc-500 font-bold uppercase tracking-wide">Pickup Location</span>
                <span className="text-sm text-white font-bold truncate">{orderData.business_name ?? 'Merchant Store'}</span>
                <span className="text-xs text-zinc-400 truncate mt-0.5">{orderData.business_address ?? orderData.pickup_address ?? 'Pickup Location'}</span>
              </div>
            </div>

            {/* Connecting Route Indicator Dot Trail */}
            <div className="w-0.5 h-5 bg-gradient-to-b from-emerald-500 to-blue-500 ml-[11px] -my-3 opacity-60" />

            {/* Dropoff Segment */}
            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-blue-500/10 border border-blue-500 flex items-center justify-center text-blue-400 text-xs shrink-0 mt-0.5 font-bold">
                D
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-zinc-500 font-bold uppercase tracking-wide">Dropoff Destination</span>
                <span className="text-sm text-white font-bold truncate">Customer Landmark</span>
                <span className="text-xs text-zinc-400 truncate mt-0.5">{orderData.delivery_address ?? 'Destination Location'}</span>
              </div>
            </div>
          </div>

          {/* TRIP PARAMETERS & METRICS SLAT */}
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <Clock className="w-4 h-4 text-zinc-500 mx-auto mb-1" />
              <span className="block text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Distance</span>
              <span className="text-base font-mono font-extrabold text-white mt-0.5 block">
                {orderData.distance_km != null ? `${Number(orderData.distance_km).toFixed(1)} km` : 'N/A'}
              </span>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-xl p-3">
              <Navigation className="w-4 h-4 text-zinc-500 mx-auto mb-1" />
              <span className="block text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Est. Trip Time</span>
              <span className="text-base font-mono font-extrabold text-white mt-0.5 block">{orderData.duration_minutes ?? 0} mins</span>
            </div>
          </div>
        </div>

        {/* LOCKED REVENUE & INTERACTIVE CONTROL CONSOLE */}
        <div className="p-4 border-t border-white/10 bg-white/5 rounded-b-2xl space-y-3">
          {/* Prominent Rider Revenue Highlight Block */}
          <div className="bg-emerald-950/30 border border-emerald-500/20 rounded-xl p-3 flex justify-between items-center">
            <span className="text-sm text-emerald-400 font-bold flex items-center gap-2">
              <Truck className="w-4 h-4" /> Guaranteed Rider Payout
            </span>
            <span className="text-2xl font-mono font-black text-emerald-400">₱{Number(orderData.rider_payout ?? 0).toFixed(2)}</span>
          </div>

          {/* Progressive Ticking Countdown Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-mono font-semibold text-zinc-400 px-0.5">
              <span>Offer Expiration Warning</span>
              <span className={isUrgent ? 'text-red-500 animate-pulse font-bold' : ''}>{currentSeconds}s</span>
            </div>
            <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-1000 ease-linear rounded-full ${isUrgent ? 'bg-red-500' : 'bg-emerald-500'}`}
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>

          {/* Interactive Trigger Operation Grid */}
          <div className="flex flex-col gap-2 pt-1">
            <button
              onClick={onAccept}
              disabled={acceptPending}
              className="w-full bg-emerald-500 hover:bg-emerald-600 text-neutral-950 font-extrabold py-3.5 px-4 rounded-xl shadow-lg transition active:scale-[0.99] uppercase tracking-wider text-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {acceptPending ? <span>Processing...</span> : (<><CheckCircle className="w-4 h-4" /> Accept Order Request</>)}
            </button>
            <button
              onClick={onDecline}
              disabled={declinePending}
              className="w-full bg-white/10 hover:bg-white/15 text-zinc-300 font-bold py-2.5 px-4 rounded-xl transition active:scale-[0.99] text-xs disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <XCircle className="w-4 h-4" /> Decline Offer
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
