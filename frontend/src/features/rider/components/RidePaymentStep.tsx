/**
 * Ride drop-off payment (owner decision 2026-11-18): before "Complete Ride"
 * the rider confirms the payment — the cash in hand, or the passenger's
 * GCash payment once the server has verified it. An unpaid GCash ride can be
 * switched to cash when the passenger cannot pay online.
 */
export default function RidePaymentStep({
  needsArrival, changedMaxFare, online, paid, fare, confirmed, onConfirmedChange,
  confirmSwitch, onAskSwitch, onCancelSwitch, onSwitch, switching,
}: {
  needsArrival: boolean
  changedMaxFare: number | null
  online: boolean
  paid: boolean
  fare: number | null
  confirmed: boolean
  onConfirmedChange: (v: boolean) => void
  confirmSwitch: boolean
  onAskSwitch: () => void
  onCancelSwitch: () => void
  onSwitch: () => void
  switching: boolean
}) {
  const amount = fare != null ? `₱${fare.toFixed(2)}` : 'the fare'
  const box = 'rounded-xl border border-[#CFE8D6] bg-[#F4FBF6] px-3 py-2.5 text-sm font-medium text-[#17201B]'

  if (needsArrival) {
    return (
      <p className={box}>
        {changedMaxFare != null
          ? `The passenger changed the destination. Tap I've Arrived at the drop-off: the final fare is worked out from the verified distance (at most ₱${changedMaxFare.toFixed(2)}).`
          : `Tap I've Arrived at the drop-off. ${online ? 'The passenger then pays with GCash.' : `Then collect ${amount} in cash.`}`}
      </p>
    )
  }

  if (online && !paid) {
    return (
      <div className="space-y-2" data-testid="ride-payment-step">
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-medium text-[#7C4A03]" role="status">
          Waiting for the passenger's GCash payment of {amount}. Ask them to tap Pay now in the app. This updates by itself.
        </p>
        {confirmSwitch ? (
          <div className="rounded-xl border border-[#E5E9E7] p-3 text-sm">
            <p className="font-semibold text-[#17201B]">Switch this ride to cash?</p>
            <p className="mt-1 text-xs text-[#56615B]">Only if the passenger cannot pay with GCash. You will collect {amount} in cash.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={onCancelSwitch} className="h-9 flex-1 rounded-full border border-[#E5E9E7] text-xs font-semibold text-[#3B4540]">Keep GCash</button>
              <button type="button" onClick={onSwitch} disabled={switching} className="h-9 flex-1 rounded-full bg-[#16803C] text-xs font-bold text-white disabled:opacity-60">
                {switching ? 'Switching…' : 'Yes, switch to cash'}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={onAskSwitch} className="text-xs font-semibold text-[#087F3F] underline-offset-2 hover:underline">
            Passenger can't pay with GCash? Switch to cash
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2" data-testid="ride-payment-step">
      <p className={box}>
        {online ? `GCash payment of ${amount} received.` : `Collect ${amount} in cash from the passenger.`}
      </p>
      <label className="flex items-start gap-2 rounded-xl border border-[#E5E9E7] px-3 py-2.5 text-sm text-[#17201B]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => onConfirmedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[#16803C]"
        />
        <span>{online ? `I confirm the passenger's GCash payment of ${amount} was received` : `I received ${amount} in cash from the passenger`}</span>
      </label>
    </div>
  )
}
