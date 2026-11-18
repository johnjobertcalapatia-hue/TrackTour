import { Loader2, Navigation } from 'lucide-react'
import { useRiderActiveTrip } from '@/features/rider/context/RiderActiveTripContext'

/**
 * Ride hailing (2026-11-17): the passenger changed the destination. Shown
 * on every rider screen until the rider taps "Got it" — the acknowledgement
 * is recorded on the server, apart from the push notification. The map and
 * navigation already follow the new destination (the trip's drop-off).
 */
export default function RiderDestinationChangeBanner() {
  const { activeDelivery, acknowledgeDestinationChange, acknowledgeBusy } = useRiderActiveTrip()
  const change = activeDelivery?.order_type === 'transport' ? activeDelivery.destination_change ?? null : null
  if (!change || change.rider_acknowledged_at) return null

  return (
    <div className="fixed inset-x-0 top-3 z-[2600] flex justify-center px-3" role="alertdialog" aria-label="Destination changed">
      <div className="w-full max-w-md rounded-2xl border border-[#F4B400]/50 bg-white p-4 shadow-2xl">
        <p className="flex items-center gap-2 text-sm font-bold text-[#17201B]">
          <Navigation className="h-4 w-4 text-[#D97706]" aria-hidden="true" /> The passenger changed the destination
        </p>
        <p className="mt-2 text-xs text-[#56615B] line-through">{change.original.address ?? 'Original destination'}</p>
        <p className="text-sm font-semibold text-[#17201B]">{change.new.name ?? change.new.address}</p>
        {change.new.address && change.new.address !== change.new.name && <p className="text-xs text-[#56615B]">{change.new.address}</p>}
        <p className="mt-2 text-xs text-[#56615B]">
          Navigation now goes to the new destination. The fare is worked out from the verified distance at the drop-off (at most ₱{change.max_fare.toFixed(2)}).
        </p>
        <button
          type="button"
          onClick={acknowledgeDestinationChange}
          disabled={acknowledgeBusy}
          className="mt-3 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#16803C] text-sm font-bold text-white hover:bg-[#126B32] disabled:opacity-60"
        >
          {acknowledgeBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null} Got it
        </button>
      </div>
    </div>
  )
}
