import { useEffect, useRef, useState } from 'react'
import { CheckCircle, ShoppingBag, Loader2, AlertTriangle, Zap } from 'lucide-react'
import { useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'

export default function GlobalRiderAlert() {
  const {
    activeDelivery,
    arrivalAlert,
    tripState,
    busy,
    actionError,
    onMarkPickedUp,
    onConfirmDelivery,
  } = useRiderActiveTrip()

  const [exiting, setExiting] = useState(false)
  const prevAlert = useRef(arrivalAlert)

  useEffect(() => {
    if (prevAlert.current && arrivalAlert === null) {
      setExiting(true)
      const timer = setTimeout(() => setExiting(false), 260)
      prevAlert.current = null
      return () => clearTimeout(timer)
    }
    prevAlert.current = arrivalAlert
  }, [arrivalAlert])

  // The full-screen arrival alert is a global overlay that appears on all rider
  // pages (including the map) whenever a pickup/drop-off leg is reached.
  if (!arrivalAlert && !exiting) return null

  const isPickup = arrivalAlert === 'PICKUP' || (exiting && tripState === 'ARRIVED_AT_PICKUP')
  const isConfirming = busy

  const confirmLabel = isPickup ? 'I Picked Up the Food' : 'I Delivered the Food'
  const confirmIcon = isPickup ? ShoppingBag : CheckCircle

  // Waypoint shown in the receipt slice — the relevant name/address for this leg.
  const targetName = isPickup ? activeDelivery?.business_name : activeDelivery?.delivery_address
  const targetAddress = isPickup ? activeDelivery?.pickup_address : activeDelivery?.delivery_address
  const waypointLabel = isPickup ? 'Pickup Location' : 'Delivery Location'

  const handleConfirm = () => {
    if (isPickup) onMarkPickedUp()
    else onConfirmDelivery()
  }

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-black/60 flex items-end justify-center p-4 backdrop-blur-sm ${
        arrivalAlert ? 'rider-alert-backdrop' : ''
      }`}
    >
      <div
        className={`bg-zinc-950/70 backdrop-blur-2xl w-full max-w-md rounded-2xl border border-white/10 shadow-2xl flex flex-col overflow-hidden ${
          arrivalAlert ? 'rider-alert-in' : 'rider-alert-out'
        }`}
      >
        {/* HEADER PANEL BANNER */}
        <div className="p-4 border-b border-white/10 text-center bg-white/5">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-500 rounded-full text-xs font-bold uppercase tracking-wider mb-1">
            <Zap className="w-3 h-3" />
            Arrival Confirmation
          </div>
          <h2 className="text-lg font-extrabold text-white tracking-tight">You've Arrived</h2>
          <p className="text-xs text-zinc-400">Confirm the leg to continue the delivery flow</p>
        </div>

        {/* RECEIPT BODY */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border ${
                  isPickup
                    ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400'
                    : 'bg-blue-500/10 border-blue-500 text-blue-400'
                }`}
              >
                {isPickup ? 'P' : 'D'}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-zinc-500 font-bold uppercase tracking-wide">{waypointLabel}</span>
                <span className="text-sm text-white font-bold truncate">{targetName ?? 'Location unavailable'}</span>
                <span className="text-xs text-zinc-400 truncate mt-0.5">{targetAddress ?? 'Address unavailable'}</span>
              </div>
            </div>

            <div className="w-0.5 h-5 bg-gradient-to-b from-emerald-500 to-blue-500 ml-[11px] -my-3 opacity-60" />

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-zinc-400 text-xs shrink-0 mt-0.5 font-bold">
                {isPickup ? 'D' : '✓'}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-zinc-500 font-bold uppercase tracking-wide">
                  {isPickup ? 'Dropoff Destination' : 'Trip Completion'}
                </span>
                <span className="text-sm text-white font-bold truncate">
                  {isPickup ? (activeDelivery?.delivery_address ?? 'Destination Location') : 'Mark this order as delivered'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ERROR / ACTION CONSOLE */}
        <div className="p-4 border-t border-white/10 bg-white/5 space-y-3">
          {actionError && arrivalAlert && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2.5 text-sm font-medium text-red-400">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Unable to confirm. Please try again.
            </div>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={isConfirming}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3.5 text-sm font-extrabold uppercase tracking-wider text-neutral-950 shadow-lg shadow-emerald-500/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isConfirming ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Confirming...
              </>
            ) : (
              <>
                <ConfirmGlyph icon={confirmIcon} />
                {confirmLabel}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function ConfirmGlyph({ icon: Icon }: { icon: typeof CheckCircle }) {
  return <Icon className="h-4 w-4" />
}
