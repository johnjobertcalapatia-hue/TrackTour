import { Clock } from 'lucide-react'
import { formatCurrency } from '@/shared/utils'
import type { PickupWaiting } from '@/features/rider/context/RiderActiveTripContext'
import { formatClock, useWaitingSeconds, waitingFee } from '@/features/rider/components/RideWaitingStep'

/**
 * Tourist ride sheet (owner decisions 2026-11-18): "Your driver has
 * arrived", the waiting rule, a live timer from the driver's confirmed
 * arrival (server time) and the fee so far; once the trip starts, the
 * waiting time and fee that were charged.
 */
export default function PickupWaitingCard({ waiting, driverName }: { waiting: PickupWaiting; driverName: string | null }) {
  const seconds = useWaitingSeconds(waiting) ?? 0
  const ended = waiting.charged_seconds != null
  const fee = waiting.amount ?? waitingFee(seconds, waiting)
  const freeLeft = Math.max(0, waiting.free_seconds - seconds)

  return (
    <section aria-label="Pickup waiting" className="rounded-2xl border border-[#E5E9E7] p-3 text-sm" role="status">
      <p className="font-semibold text-[#17201B]">
        {ended ? 'Pickup waiting' : `${driverName ? driverName.split(' ')[0] : 'Your driver'} has arrived and is waiting`}
      </p>
      <p className="mt-0.5 text-xs text-[#56615B]">
        First {Math.round(waiting.free_seconds / 60)} minutes free, then {formatCurrency(waiting.rate)} for every full {Math.round(waiting.unit_seconds / 60)} minutes until you're on board.
      </p>
      <div className="mt-2 flex items-center justify-between border-t border-[#EEF1EF] pt-2">
        <span className="flex items-center gap-1.5 font-semibold text-[#17201B]">
          <Clock className="h-4 w-4 text-[#087F3F]" aria-hidden="true" /> {formatClock(seconds)}
        </span>
        <span className={fee > 0 ? 'font-bold text-[#B45309]' : 'font-semibold text-[#087F3F]'}>
          {fee > 0 ? `${formatCurrency(fee)}${ended ? '' : ' so far'}` : ended ? 'No charge' : `Free for ${formatClock(freeLeft)}`}
        </span>
      </div>
    </section>
  )
}
