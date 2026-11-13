import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle, ShoppingBag, Loader2, AlertTriangle, Zap, Banknote, Store, MapPin, ChevronDown, ChevronUp } from 'lucide-react'
import { useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'
import { formatCurrency } from '@/shared/utils'
import { RunDiagnosticsLink } from './RiderDiagnosticsSheet'
import { formatStopDistance } from '@/features/rider/stop-arrival'
import { DeliveryPhotoCapture } from '@/features/rider/components/DeliveryPhotoCapture'
import { TripConditions } from '@/features/rider/components/TripConditions'
import { allMet, deliveryConditions, distanceMeters, withDropoffLocation, withSavedLocation } from '@/features/rider/trip-steps'

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
    onCompleteRide,
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
    riderPosition,
    positionKnown,
    locationRefusal,
    deviceAccuracy,
  } = useRiderActiveTrip()

  // Ride or food: remembered after the trip ends, so the closing animation
  // (and a cash ride waiting for its fare) never falls back to the food photo
  // step (bug 2026-11-11: the camera step flashed after "Complete Ride").
  const lastTripKind = useRef<{ id: number | null; ride: boolean }>({ id: null, ride: false })
  if (activeDelivery) lastTripKind.current = { id: activeDelivery.id, ride: activeDelivery.order_type === 'transport' }
  const isRide = activeDelivery ? activeDelivery.order_type === 'transport' : lastTripKind.current.ride

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

  // The rider may collapse any arrival / pickup / delivery message to a small
  // bar (not ready to confirm yet) and reopen it from there. Collapsing is
  // remembered per message, so the NEXT message (next restaurant, drop-off)
  // opens expanded; a collapsed message keeps its state (e.g. the photo).
  const [collapsedKey, setCollapsedKey] = useState<string | null>(null)
  const promptKey = pickupArrivalPrompt
    ? `arrive:${activeDelivery?.id}:${pickupArrivalPrompt.businessId}`
    : pickupStopPrompt
      ? `pickup:${activeDelivery?.id}:${pickupStopPrompt.businessId}`
      : `leg:${activeDelivery?.id}:${arrivalAlert ?? 'final'}`
  const collapsed = collapsedKey === promptKey
  const collapse = () => setCollapsedKey(promptKey)
  const expand = () => setCollapsedKey(null)

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
              {isRide ? 'Cash Fare' : 'Cash on Delivery'}
            </div>
            <h2 className="text-lg font-extrabold text-[#17201B] tracking-tight">{isRide ? 'Fare collected?' : 'Payment settled?'}</h2>
            <p className="text-xs text-[#6B7280]">
              {isRide ? 'Enter the cash the passenger paid to finish the ride' : 'Enter the cash the tourist paid to finish the delivery'}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            <div className="bg-[#F4FBF6] border border-[#CFE8D6] rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[#6B7280] font-semibold">{isRide ? 'Booking' : 'Order'} #{pendingSettlement.orderId}</span>
                <span className="text-[#6B7280] font-semibold">{isRide ? 'Ride fare' : 'Amount due'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#6B7280]">{isRide ? 'Cash received from the passenger' : 'Cash received from customer'}</span>
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
                  <div><span>{settleError}</span><br /><RunDiagnosticsLink /></div>
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
                  {isRide ? 'Fare Collected — Finish Ride' : 'Payment Settled — Finish Delivery'}
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

    if (collapsed) {
      return (
        <CollapsedBar
          label="Show restaurant arrival confirmation"
          title={`Pickup ${pickupArrivalPrompt.sequence} of ${pickupArrivalPrompt.totalStops}: ${targetName}`}
          subtitle="Tap to confirm your arrival"
          icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
          onExpand={expand}
        />
      )
    }

    return (
      <div className="fixed inset-0 z-[9999] bg-black/40 flex items-end justify-center p-3 rider-alert-backdrop">
        <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl flex flex-col overflow-hidden rider-alert-in">
          <div className="relative px-4 pt-5 pb-2 text-center">
            <CollapseButton onClick={collapse} />
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
                <div><span>{confirmArrivalError}</span><br /><RunDiagnosticsLink /></div>
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

    if (collapsed) {
      return (
        <CollapsedBar
          label="Show pickup confirmation"
          title={`Pickup ${pickupStopPrompt.sequence} of ${pickupStopPrompt.totalStops}: ${targetName}`}
          subtitle="Food is ready. Tap to confirm the pickup"
          icon={<Zap className="h-4 w-4" aria-hidden="true" />}
          onExpand={expand}
        />
      )
    }

    return (
      <div className="fixed inset-0 z-[9999] bg-black/40 flex items-end justify-center p-3 rider-alert-backdrop">
        <div className="bg-white w-full max-w-md rounded-[24px] shadow-2xl flex flex-col overflow-hidden rider-alert-in">
          {/* HEADER BANNER */}
          <div className="relative px-4 pt-5 pb-2 text-center">
            <CollapseButton onClick={collapse} />
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
                  <div><span>{confirmStopError}</span><br /><RunDiagnosticsLink /></div>
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

  const confirmLabel = isPickup
    ? isRide ? 'Passenger On Board' : 'I Picked Up the Food'
    : isRide ? (activeDelivery?.is_cod ? 'Fare Collected · Complete Ride' : 'Complete Ride') : 'Confirm Delivered'
  const confirmIcon = isPickup && !isRide ? ShoppingBag : CheckCircle

  // Waypoint shown in the receipt slice — the relevant name/address for this leg.
  const targetName = isPickup
    ? isRide ? activeDelivery?.customer_name ?? 'Passenger' : activeDelivery?.business_name
    : activeDelivery?.delivery_address
  const targetAddress = isPickup ? activeDelivery?.pickup_address : activeDelivery?.delivery_address
  const waypointLabel = isPickup
    ? isRide ? 'Passenger Pickup' : 'Pickup Location'
    : isRide ? 'Drop-off' : 'Delivery Location'

  const rideFare = activeDelivery?.order_total ?? null
  const rideCash = isRide && Boolean(activeDelivery?.is_cod)
  const handleConfirm = () => {
    if (isPickup) onMarkPickedUp()
    else if (isRide) onCompleteRide(rideCash ? rideFare : null)
    else if (proofPhoto) onConfirmDelivery(proofPhoto)
  }
  const needsPhoto = !isPickup && !isRide && !proofPhoto
  const isCod = Boolean(pickupStopsData?.is_cod)
  // Confirm Delivered: within 50 m of the address (live GPS) + submitted photo,
  // the same conditions as the trip page; the server re-checks both.
  const dropLat = activeDelivery?.delivery_lat
  const dropLng = activeDelivery?.delivery_lng
  const dropoffDistance = positionKnown && Array.isArray(riderPosition) && dropLat != null && dropLng != null
    ? distanceMeters(riderPosition, [Number(dropLat), Number(dropLng)])
    : null
  // Rides keep the saved-location rule; the food drop-off may use the
  // phone's own fix up to ±200 m (owner decision 2026-11-12).
  const deliveryChecks = isRide
    ? withSavedLocation(deliveryConditions(dropoffDistance, !!positionKnown, true).slice(0, 1), locationRefusal)
    : withDropoffLocation(deliveryConditions(dropoffDistance, !!positionKnown, !!proofPhoto), locationRefusal, deviceAccuracy)
  const deliveryBlocked = !isPickup && !allMet(deliveryChecks)

  // Collapsed: a small bar instead of the full-screen popup; the rider keeps
  // using the map and reopens it to confirm.
  if (collapsed && arrivingNow) {
    return (
      <CollapsedBar
        label={isPickup ? 'Show pickup confirmation' : isRide ? 'Show drop-off confirmation' : 'Show delivery confirmation'}
        title="You've Arrived"
        subtitle={isPickup
          ? isRide ? 'Tap to confirm the passenger is on board' : 'Tap to confirm the pickup'
          : isRide ? 'Tap to confirm the drop-off' : 'Tap to confirm the delivery'}
        icon={<Zap className="h-4 w-4" aria-hidden="true" />}
        onExpand={expand}
      />
    )
  }

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
        <div className="relative px-4 pt-5 pb-2 text-center">
          {arrivingNow && <CollapseButton onClick={collapse} />}
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-[#FEF3C7] border border-[#FDE68A] text-[#92400E] rounded-full text-xs font-bold uppercase tracking-wider mb-1">
            <Zap className="w-3 h-3" />
            Arrival Confirmation
          </div>
          <h2 className="text-lg font-extrabold text-[#17201B] tracking-tight">You've Arrived</h2>
          <p className="text-xs text-[#6B7280]">Confirm the leg to continue the {isRide ? 'ride' : 'delivery flow'}</p>
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
                  {isPickup ? (isRide ? 'Drop-off' : 'Dropoff Destination') : 'Trip Completion'}
                </span>
                <span className="text-sm text-[#17201B] font-bold truncate">
                  {isPickup
                    ? (activeDelivery?.delivery_address ?? 'Destination Location')
                    : isRide
                      ? 'Drop the passenger off, collect the fare if cash, then complete the ride'
                      : 'Take a photo of the tourist receiving the food, submit it, then confirm'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ERROR / ACTION CONSOLE */}
        <div className="p-4 pt-2 space-y-3">
          {isPickup && pickupGateBlocked && !isRide ? (
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
                  <div><span>{actionError}</span><br /><RunDiagnosticsLink /></div>
                </div>
              )}

              {!isPickup && isRide && (
                <p className="rounded-xl border border-[#CFE8D6] bg-[#F4FBF6] px-3 py-2.5 text-sm font-medium text-[#17201B]">
                  {rideCash
                    ? `Collect ${rideFare != null ? `₱${rideFare.toFixed(2)}` : 'the fare'} in cash from the passenger, then complete the ride.`
                    : 'The fare was paid online. Nothing to collect.'}
                </p>
              )}
              {!isPickup && !isRide && arrivingNow && (
                <DeliveryPhotoCapture
                  photo={proofPhoto}
                  onSubmit={setProofPhoto}
                  note={isRide
                    ? 'You must be within 50 m of the drop-off. Confirming means the passenger has arrived and paid the fare.'
                    : isCod
                      ? 'You must be within 50 m of the address. Confirming means the tourist has received the food and paid you in cash.'
                      : 'You must be within 50 m of the address. Confirming means the tourist has received the food.'}
                />
              )}
              {!isPickup && <TripConditions items={deliveryChecks} />}

              <button
                type="button"
                onClick={handleConfirm}
                disabled={isConfirming || needsPhoto || deliveryBlocked}
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

/** Top-right "not yet" button: collapses the message to a small bar. */
function CollapseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Collapse"
      title="Not yet: collapse this message"
      className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-[#F3F4F6] text-[#4B5563] hover:bg-[#E5E7EB] hover:text-[#17201B]"
    >
      <ChevronDown className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}

/** A collapsed message: a small bar at the bottom; tap to open it again. */
function CollapsedBar({ label, title, subtitle, icon, onExpand }: {
  label: string
  title: string
  subtitle: string
  icon: ReactNode
  onExpand: () => void
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] flex justify-center p-3 pointer-events-none">
      <button
        type="button"
        onClick={onExpand}
        aria-label={label}
        className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border border-[#CFE8D6] bg-[#fff] px-4 py-3 text-left shadow-2xl"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FEF3C7] text-[#92400E]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-extrabold text-[#17201B]">{title}</span>
          <span className="block truncate text-xs text-[#6B7280]">{subtitle}</span>
        </span>
        <ChevronUp className="h-5 w-5 shrink-0 text-[#16803C]" aria-hidden="true" />
      </button>
    </div>
  )
}

function ConfirmGlyph({ icon: Icon }: { icon: typeof CheckCircle }) {
  return <Icon className="h-4 w-4" />
}

