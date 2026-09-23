import { useEffect, useState } from 'react'
import { Truck, Clock, Navigation, Zap, CheckCircle } from 'lucide-react'
import type { RiderDeliveryRequestData } from '@/features/rider/components/RiderDeliveryRequestAlert'

interface Props {
  offers: RiderDeliveryRequestData[]
  onAccept: (offer: RiderDeliveryRequestData) => void
  acceptDeliveryId?: number | null
}

/**
 * Simultaneous-offer chooser: a rider may hold several live offers from the same
 * dispatch wave. Each row is an independent offer (soonest-expiring first); the
 * rider picks exactly one, and accepting it is the atomic assignment — every
 * other offer is withdrawn server-side.
 */
export default function RiderOffersPanel({ offers, onAccept, acceptDeliveryId = null }: Props) {
  const [nowTick, setNowTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setNowTick((t) => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  const itemCountOf = (offer: RiderDeliveryRequestData) =>
    (offer.items ?? []).reduce((acc, item) => acc + (item.quantity || 0), 0)

  const itemLabel = (offer: RiderDeliveryRequestData) => {
    const count = itemCountOf(offer)
    return `${count} item${count === 1 ? '' : 's'}`
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-zinc-950/70 backdrop-blur-2xl w-full max-w-md rounded-2xl border border-white/10 shadow-2xl flex flex-col max-h-[85vh] animate-slide-up">
        <div className="p-4 border-b border-white/10 text-center bg-white/5 rounded-t-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-full text-xs font-bold uppercase tracking-wider mb-1">
            <Zap className="w-3 h-3" />
            Simultaneous Offers
          </div>
          <h2 className="text-lg font-extrabold text-white tracking-tight">Choose a Booking Request</h2>
          <p className="text-xs text-zinc-400">You may accept ONE — the rest are withdrawn automatically.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {offers.map((offer) => {
            const expiresIn = Math.max(0, Math.round((offer.expires_in ?? 45) - nowTick))
            const payout = Number(offer.rider_payout ?? offer.rider_commission ?? 0)
            const isAccepting = acceptDeliveryId != null && acceptDeliveryId === offer.delivery_id

            return (
              <div
                key={offer.delivery_id}
                className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3"
              >
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-zinc-400 truncate">
                      {offer.order_number ?? `TT-${String(offer.order_id ?? 0).padStart(5, '0')}`}
                    </div>
                    <h3 className="text-base font-bold text-white truncate mt-0.5">
                      {offer.business_name ?? 'Merchant Store'}
                    </h3>
                    <div className="text-xs text-zinc-400 mt-0.5 truncate">
                      {itemLabel(offer)} · {offer.stops ?? offer.restaurant_count ?? 1} stop
                    </div>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-mono font-bold px-2 py-1 rounded-full ${
                      expiresIn <= 7 ? 'bg-red-500/15 text-red-400 animate-pulse' : 'bg-white/10 text-zinc-200'
                    }`}
                  >
                    {expiresIn}s
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-black/20 rounded-lg p-2">
                    <Clock className="w-3.5 h-3.5 text-zinc-500 mx-auto mb-0.5" />
                    <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Distance</div>
                    <div className="text-sm font-mono font-bold text-white">
                      {offer.distance_km != null ? `${Number(offer.distance_km).toFixed(1)} km` : 'N/A'}
                    </div>
                  </div>
                  <div className="bg-black/20 rounded-lg p-2">
                    <Navigation className="w-3.5 h-3.5 text-zinc-500 mx-auto mb-0.5" />
                    <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Trip Time</div>
                    <div className="text-sm font-mono font-bold text-white">{offer.duration_minutes ?? 0} mins</div>
                  </div>
                  <div className="bg-emerald-950/40 border border-emerald-500/20 rounded-lg p-2">
                    <Truck className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-0.5" />
                    <div className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Payout</div>
                    <div className="text-sm font-mono font-bold text-emerald-400">₱{payout.toFixed(2)}</div>
                  </div>
                </div>

                <button
                  onClick={() => onAccept(offer)}
                  disabled={isAccepting}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-neutral-950 font-extrabold py-2.5 px-4 rounded-xl transition active:scale-[0.99] uppercase tracking-wider text-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isAccepting ? <span>Processing...</span> : (<><CheckCircle className="w-4 h-4" /> Accept This Offer</>)}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}