import { ArrowDown, CheckCircle2, Navigation } from 'lucide-react'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import type { DestinationChange } from '@/features/tourist/services/destination-change'

/**
 * On the ride's tracking sheet: "Change destination · 1 change left" while
 * the trip is under way, and after a change the original → new destination,
 * when, whether the driver has it, and the fare (estimate and maximum, then
 * the final fare once the driver arrives).
 */
export default function DestinationChangeCard({ change, changesLeft, canChange, onChange }: {
  change: DestinationChange | null
  changesLeft: number
  canChange: boolean
  onChange: () => void
}) {
  if (!change) {
    if (!canChange) return null
    return (
      <button
        type="button"
        onClick={onChange}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#087F3F]/30 bg-[#E9F7EF] px-4 py-3 text-left hover:border-[#087F3F]/60"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[#087F3F]">
          <Navigation className="h-4 w-4" aria-hidden="true" /> Change destination
        </span>
        <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-[#087F3F]">
          {changesLeft} change left
        </span>
      </button>
    )
  }

  const finalized = change.final_fare != null
  return (
    <section aria-label="Destination changed" className="space-y-2 rounded-2xl border border-[#E5E9E7] p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-[#17201B]">Destination changed</p>
        <span className="rounded-full bg-[#F3F4F6] px-2.5 py-0.5 text-xs font-semibold text-[#56615B]">No changes left</span>
      </div>
      <div className="text-xs text-[#56615B]">
        <p className="line-through">{change.original.address ?? 'Original destination'}</p>
        <ArrowDown className="my-0.5 h-3.5 w-3.5" aria-hidden="true" />
        <p className="font-medium text-[#17201B]">{change.new.name ?? change.new.address}</p>
        {change.confirmed_at && <p className="mt-1">Changed {formatDateTime(change.confirmed_at)}</p>}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-[#56615B]">
        {change.rider_acknowledged_at
          ? <><CheckCircle2 className="h-3.5 w-3.5 text-[#087F3F]" aria-hidden="true" /> Your driver has the new destination</>
          : 'Your driver is being told about the new destination'}
      </p>
      <dl className="space-y-1 border-t border-[#EEF1EF] pt-2">
        {finalized ? (
          <>
            <div className="flex justify-between font-bold text-[#17201B]"><dt>Final fare</dt><dd>{formatCurrency(change.final_fare!)}</dd></div>
            <div className="flex justify-between text-xs text-[#56615B]"><dt>Verified distance</dt><dd>{(change.verified_km ?? 0).toFixed(2)} km</dd></div>
            {(change.cap_adjustment ?? 0) > 0 && (
              <div className="flex justify-between text-xs text-[#047332]"><dt>Capped at your maximum</dt><dd>−{formatCurrency(change.cap_adjustment!)}</dd></div>
            )}
          </>
        ) : (
          <>
            <div className="flex justify-between font-semibold text-[#17201B]"><dt>Estimated fare</dt><dd>{formatCurrency(change.estimated_fare)}</dd></div>
            <div className="flex justify-between text-xs text-[#56615B]"><dt>You will pay at most</dt><dd>{formatCurrency(change.max_fare)}</dd></div>
          </>
        )}
      </dl>
    </section>
  )
}
