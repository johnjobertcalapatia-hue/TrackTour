import { useEffect, useRef, useState } from 'react'
import { CheckCircle, ShoppingBag, Loader2, AlertTriangle, Zap, Banknote, Store, MapPin } from 'lucide-react'
import { useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import { formatCurrency } from '@/shared/utils'
import { formatStopDistance } from '@/features/rider/stop-arrival'
import { DeliveryPhotoCapture } from '@/features/rider/components/DeliveryPhotoCapture'

export default function GlobalRiderAlert() {
  const {
    activeDelivery,
    arrivalAlert,
    busy,
    actionError,
    pickupGateBlocked,
    pickupGateMessage,
    onMarkPickedUp,
    onConfirmDelivery,
    dismissArrivalAlert,
    pendingSettlement,
    settleCod,
    settleBusy,
    settleError,
    pickupStopPrompt,
    pickupArrivalPrompt,
    confirmArrivalStop,
    confirmArrivalBusy,
    confirmArrivalError,
    confirmPickupStop,
    confirmStopBusy,
    confirmStopError,
    pickupComplete,
    pickupStopsData,
  } = useRiderActiveTrip()

  const [exiting, setExiting] = useState(false)
  // Which leg is animating OUT. Retained across the exit so the confirm label
  // stays correct even though tripState may already have advanced (the pickup
  // confirm now flips tripState to OUT_FOR_DELIVERY optimistically in the
  // context the same tick the alert closes).
  const [exitAlertKind, setExitAlertKind] = useState<'PICKUP' | 'DROPOFF' | null>(null)
  const prevAlert = useRef(arrivalAlert)

  const [cashReceived, setCashReceived] = useState('')
  useEffect(() => {
    setCashReceived('')
  }, [pendingSettlement?.deliveryId])

  // Proof-of-delivery photo for the drop-off (required to complete).
  const [proofPhoto, setProofPhoto] = useState<File | null>(null)
  useEffect(() => {
    setProofPhoto(null)
  }, [activeDelivery?.id])

  useEffect(() => {
    if (prevAlert.current && arrivalAlert === null) {
      setExitAlertKind(prevAlert.current)
      setExiting(true)
      const timer = setTimeout(() => setExiting(false), 260)
      prevAlert.current = null
      return () => clearTimeout(timer)
    }
    prevAlert.current = arrivalAlert
  }, [arrivalAlert])

  // A COD delivery parked at `delivered` (cash collected, not yet settled) keeps
  // the rider busy on the backend until POST /settle-cod completes. When one is
  // outstanding, show the inline "Payment settled?" step before anything else.
  if (pendingSettlement) {
    const cashDue = pendingSettlement.cashDue ?? 0
    const received = parseFloat(cashReceived) || 0
    const changePreview = received >= cashDue ? received - cashDue : 0

    return (
      <div className="fixed inset-0 z-[9999] bg-black/40 flex items-end justify-center p-3">
        <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl flex flex-col overflow-hidden">
          <div className="px-4 pt-5 pb-2 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] rounded-full text-xs font-bold uppercase tracking-wider mb-1">
              <Banknote className="w-3 h-3" />
              Cash on Delivery
            </div>
            <h2 className="text-lg font-extrabold text-[#17201B] tracking-tight">Payment settled?</h2>
            <p className="text-xs text-[#6B7280]">Enter the cash the tourist paid to finish the delivery</p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            <div className="bg-[#F4FBF6] border border-[#CFE8D6] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#6B7280] font-semibold">Order #{pendingSettlement.orderId}</span>
                <span className="text-[#6B7280] font-semibold">Amount due</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#6B7280]">Cash received from customer</span>
                <span className="text-xl font-extrabold text-[#17201B]">{formatCurrency(cashDue)}</span>
              </div>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#6B7280] font-medium">₱</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-3 bg-[#FFFFFF] border border-[#D1D5DB] rounded-xl text-[#17201B] placeholder-[#9CA3AF] focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                />
              </div>
              <button
                type="button"
                onClick={() => setCashReceived(cashDue.toString())}
                className="text-xs text-[#16803C] hover:text-[#126B32] transition"
              >
                Exact amount: {formatCurrency(cashDue)}
              </button>
              {received > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-[#6B7280] font-semibold">Change to give</span>
                  <span className={`font-semibold ${received >= cashDue ? 'text-[#16803C]' : 'text-[#B91C1C]'}`}>
                    {received >= cashDue
                      ? formatCurrency(changePreview)
                      : `Short by ${formatCurrency(cashDue - received)}`}
                  </span>
                </div>
              )}
              {settleError && (
                <div className="flex items-start gap-2 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-sm font-medium text-[#B91C1C]">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{settleError}</span>
                </div>
              )}
            </div>
          </div>

          <div className="p-4 pt-2">
            <button
              type="button"
              onClick={() => settleCod(received)}
              disabled={received < cashDue || settleBusy}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#16803C] py-3.5 text-base font-bold text-white shadow-md hover:bg-[#126B32] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {settleBusy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Settling...
                </>
              ) : (
                <>
                  <Banknote className="h-4 w-4" />
                  Payment Settled — Finish Delivery
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (pickupArrivalPrompt) {
    const targetName = pickupArrivalPrompt.businessName ?? `Business #${pickupArrivalPrompt.businessId}`

    return (
      <div className="fixed inset-0 z-[9999] bg-black/40 flex items-end justify-center p-3 rider-alert-backdrop">
        <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl flex flex-col overflow-hidden rider-alert-in">
          <div className="px-4 pt-5 pb-2 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] rounded-full text-xs font-bold uppercase tracking-wider mb-1">
              <MapPin className="w-3 h-3" />
              Pickup {pickupArrivalPrompt.sequence} of {pickupArrivalPrompt.totalStops}
            </div>
            <h2 className="text-lg font-extrabold text-[#17201B] tracking-tight">Confirm Restaurant Arrival</h2>
            <p className="text-xs text-[#6B7280]">Arrival starts this restaurant's waiting-time clock</p>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-3 bg-[#F4FBF6] border border-[#CFE8D6] rounded-xl p-4">
              <div className="w-10 h-10 rounded-full bg-[#DCFCE7] border border-[#16803C] flex items-center justify-center text-[#16803C] shrink-0">
                <Store className="w-4 h-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-[#6B7280] font-bold uppercase tracking-wide">Pickup Stop</p>
                <p className="text-base text-[#17201B] font-bold truncate">{targetName}</p>
                {pickupArrivalPrompt.distanceMeters != null && (
                  <p className="text-xs text-[#6B7280] mt-0.5">{formatStopDistance(pickupArrivalPrompt.distanceMeters)} away</p>
                )}
              </div>
            </div>
            {confirmArrivalError && (
              <div className="flex items-start gap-2 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-sm font-medium text-[#B91C1C]">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{confirmArrivalError}</span>
              </div>
            )}
          </div>
          <div className="p-4 pt-2">
            <button
              type="button"
              onClick={() => confirmArrivalStop(pickupArrivalPrompt.businessId)}
              disabled={confirmArrivalBusy}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#16803C] py-3.5 text-base font-bold text-white shadow-md hover:bg-[#126B32] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmArrivalBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
              {confirmArrivalBusy ? 'Confirming...' : 'Confirm Arrival'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // The per-stop "Confirm Item Pickup" appearing message. Derived from the
  // rider position + authoritative stops payload (within the pickup radius AND
  // that restaurant's items READY), so it pops up exactly when a stop can be
  // confirmed and advances to the next one after each confirm. The Order
  // details sheet is view-only now — this IS the confirm action.
  if (pickupStopPrompt) {
    const isConfirmingStop = confirmStopBusy
    const targetName = pickupStopPrompt.businessName ?? `Business #${pickupStopPrompt.businessId}`

    return (
      <div className="fixed inset-0 z-[9999] bg-black/40 flex items-end justify-center p-3 rider-alert-backdrop">
        <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl flex flex-col overflow-hidden rider-alert-in">
          {/* HEADER BANNER */}
          <div className="px-4 pt-5 pb-2 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#16803C] border border-[#16803C] text-white rounded-full text-xs font-bold uppercase tracking-wider mb-1">
              <Zap className="w-3 h-3" />
              Pickup {pickupStopPrompt.sequence} of {pickupStopPrompt.totalStops}
            </div>
            <h2 className="text-lg font-extrabold text-[#17201B] tracking-tight">Restaurant Ready</h2>
            <p className="text-xs text-[#6B7280]">Confirm the item pickup to advance to the next stop</p>
          </div>

          {/* RECEIPT BODY */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            <div className="bg-[#F4FBF6] border border-[#CFE8D6] rounded-xl p-4 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-[#DCFCE7] border border-[#16803C] flex items-center justify-center text-[#16803C] shrink-0">
                  <Store className="w-4 h-4" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-[#6B7280] font-bold uppercase tracking-wide">Pickup Stop</span>
                  <span className="text-sm text-[#17201B] font-bold truncate">{targetName}</span>
                  {pickupStopPrompt.distanceMeters != null && (
                    <span className="text-xs text-[#6B7280] mt-0.5">
                      {formatStopDistance(pickupStopPrompt.distanceMeters)} away
                    </span>
                  )}
                </div>
              </div>

              {confirmStopError && (
                <div className="flex items-start gap-2 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-sm font-medium text-[#B91C1C]">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{confirmStopError}</span>
                </div>
              )}
            </div>
          </div>

          {/* ACTION */}
          <div className="p-4 pt-2">
            <button
              type="button"
              onClick={() => confirmPickupStop(pickupStopPrompt.businessId)}
              disabled={isConfirmingStop}
              className="flex w-full items-center justify-center gap-2 rounded-full bg-[#16803C] py-3.5 text-base font-bold text-white shadow-md hover:bg-[#126B32] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isConfirmingStop ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Confirming...
                </>
              ) : (
                <>
                  <ShoppingBag className="h-4 w-4" />
                  Confirm Item Pickup
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // All stops collected but the one-shot arrival alert is no longer active:
  // keep the final "I Picked Up the Food" confirm on screen so a dismissed
  // "Collect Food" card never strands the rider (the sheet has no fallback
  // button anymore). The pickup gate is clear by definition once complete.
  const finalPickupFallback = pickupComplete && !arrivalAlert && !exiting

  // The full-screen arrival alert is a global overlay that appears on all rider
  // pages (including the map) whenever a pickup/drop-off leg is reached.
  if (!arrivalAlert && !exiting && !finalPickupFallback) return null

  const arrivingNow = !!arrivalAlert || finalPickupFallback

  const isPickup = arrivalAlert === 'PICKUP' || exitAlertKind === 'PICKUP' || finalPickupFallback
  const isConfirming = busy

  const confirmLabel = isPickup ? 'I Picked Up the Food' : 'Confirm Delivered'
  const confirmIcon = isPickup ? ShoppingBag : CheckCircle

  // Waypoint shown in the receipt slice — the relevant name/address for this leg.
  const targetName = isPickup ? activeDelivery?.business_name : activeDelivery?.delivery_address
  const targetAddress = isPickup ? activeDelivery?.pickup_address : activeDelivery?.delivery_address
  const waypointLabel = isPickup ? 'Pickup Location' : 'Delivery Location'

  const handleConfirm = () => {
    if (isPickup) onMarkPickedUp()
    else if (proofPhoto) onConfirmDelivery(proofPhoto)
  }
  const needsPhoto = !isPickup && !proofPhoto
  const isCod = Boolean(pickupStopsData?.is_cod)

  return (
    <div
      className={`fixed inset-0 z-[9999] bg-black/40 flex items-end justify-center p-3 ${
        arrivingNow ? 'rider-alert-backdrop' : ''
      }`}
    >
      <div
        className={`bg-white w-full max-w-md rounded-[24px] shadow-2xl flex flex-col overflow-hidden ${
          arrivingNow ? 'rider-alert-in' : 'rider-alert-out'
        }`}
      >
        {/* HEADER PANEL BANNER */}
        <div className="px-4 pt-5 pb-2 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] rounded-full text-xs font-bold uppercase tracking-wider mb-1">
            <Zap className="w-3 h-3" />
            Arrival Confirmation
          </div>
          <h2 className="text-lg font-extrabold text-[#17201B] tracking-tight">You've Arrived</h2>
          <p className="text-xs text-[#6B7280]">Confirm the leg to continue the delivery flow</p>
        </div>

        {/* RECEIPT BODY */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          <div className="bg-[#F4FBF6] border border-[#CFE8D6] rounded-xl p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border ${
                  isPickup
                    ? 'bg-[#DCFCE7] border-[#16803C] text-[#16803C]'
                    : 'bg-[#DBEAFE] border-[#2563EB] text-[#1D4ED8]'
                }`}
              >
                {isPickup ? 'P' : 'D'}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-[#6B7280] font-bold uppercase tracking-wide">{waypointLabel}</span>
                <span className="text-sm text-[#17201B] font-bold truncate">{targetName ?? 'Location unavailable'}</span>
                <span className="text-xs text-[#6B7280] truncate mt-0.5">{targetAddress ?? 'Address unavailable'}</span>
              </div>
            </div>

            <div className="w-0.5 h-5 bg-gradient-to-b from-[#16803C] to-[#2563EB] ml-[11px] -my-3 opacity-60" />

            <div className="flex items-start gap-3">
              <div className="w-6 h-6 rounded-full bg-[#F3F4F6] border border-[#D1D5DB] flex items-center justify-center text-[#6B7280] text-xs shrink-0 mt-0.5 font-bold">
                {isPickup ? 'D' : '✓'}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-[#6B7280] font-bold uppercase tracking-wide">
                  {isPickup ? 'Dropoff Destination' : 'Trip Completion'}
                </span>
                <span className="text-sm text-[#17201B] font-bold truncate">
                  {isPickup ? (activeDelivery?.delivery_address ?? 'Destination Location') : 'Take a photo of the tourist receiving the food, submit it, then confirm'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ERROR / ACTION CONSOLE */}
        <div className="p-4 pt-2 space-y-3">
          {isPickup && pickupGateBlocked ? (
            <>
              {pickupGateMessage ? (
                <div className="flex items-start gap-2 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5 text-sm font-medium text-[#92400E]">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{pickupGateMessage}</span>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-xl border border-[#CFE8D6] bg-[#F4FBF6] px-3 py-2.5 text-sm font-medium text-[#6B7280]">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin mt-0.5" />
                  <span>Checking restaurant pickup stops…</span>
                </div>
              )}
              <button
                type="button"
                onClick={pickupGateMessage ? dismissArrivalAlert : undefined}
                disabled={!pickupGateMessage}
                className={`flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-base font-bold transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 ${
                  pickupGateMessage
                    ? 'bg-[#16803C] text-white shadow-md hover:bg-[#126B32]'
                    : 'bg-[#E5E7EB] text-[#6B7280]'
                }`}
              >
                {pickupGateMessage ? (
                  <>
                    <ShoppingBag className="h-4 w-4" />
                    Collect Food at Restaurants
                  </>
                ) : (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Checking pickup stops…
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              {actionError && arrivalAlert && (
                <div className="flex items-start gap-2 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2.5 text-sm font-medium text-[#B91C1C]">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{actionError}</span>
                </div>
              )}

              {!isPickup && (
                <DeliveryPhotoCapture
                  photo={proofPhoto}
                  onSubmit={setProofPhoto}
                  note={isCod
                    ? 'You must be within 50 m of the address. Confirming means the tourist has received the food and paid you in cash.'
                    : 'You must be within 50 m of the address. Confirming means the tourist has received the food.'}
                />
              )}

              <button
                type="button"
                onClick={handleConfirm}
                disabled={isConfirming || needsPhoto}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#16803C] py-3.5 text-base font-bold text-white shadow-md hover:bg-[#126B32] transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ConfirmGlyph({ icon: Icon }: { icon: typeof CheckCircle }) {
  return <Icon className="h-4 w-4" />
}

