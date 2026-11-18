import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import type { PickupWaiting } from '@/features/rider/context/RiderActiveTripContext'

/** floor(max(0, seconds − free) / unit) × rate — the server's rule (RideTimeChargeService). */
export function waitingFee(seconds: number, w: Pick<PickupWaiting, 'free_seconds' | 'unit_seconds' | 'rate'>): number {
  return Math.floor(Math.max(0, seconds - w.free_seconds) / w.unit_seconds) * w.rate
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Live waiting seconds from the SERVER arrival time. The device clock is only
 * used for the ticking since the last refresh (offset by the server's "now"),
 * so a wrong phone clock never changes the time shown.
 */
export function useWaitingSeconds(waiting: PickupWaiting | null | undefined): number | null {
  const [, tick] = useState(0)
  const running = Boolean(waiting?.arrived_at && !waiting.ended_at)
  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => tick((v) => v + 1), 1000)
    return () => window.clearInterval(id)
  }, [running])
  const [fetchedAt] = useState(() => Date.now())
  if (!waiting?.arrived_at) return null
  if (waiting.charged_seconds != null) return waiting.charged_seconds
  const arrived = new Date(waiting.arrived_at).getTime()
  const serverNow = new Date(waiting.server_now).getTime()
  return Math.max(0, Math.floor((serverNow - arrived + (Date.now() - fetchedAt)) / 1000))
}

/**
 * Ride pickup (owner decisions 2026-11-18): before arrival, what confirming
 * does; after, the passenger's waiting time and the fee so far.
 */
export default function RideWaitingStep({ awaitingArrival, passenger, waiting }: {
  awaitingArrival: boolean
  passenger: string | null
  waiting: PickupWaiting | null
}) {
  const seconds = useWaitingSeconds(waiting)
  const rule = waiting
    ? `First ${Math.round(waiting.free_seconds / 60)} minutes free, then ₱${waiting.rate} per full ${Math.round(waiting.unit_seconds / 60)} minutes.`
    : 'First 3 minutes free, then ₱2 per full 3 minutes.'

  if (awaitingArrival) {
    return (
      <p className="rounded-xl border border-[#CFE8D6] bg-[#F4FBF6] px-3 py-2.5 text-sm font-medium text-[#17201B]" data-testid="ride-arrival-step">
        You're at {passenger ? `${passenger}'s` : "the passenger's"} pickup point. Tap I've Arrived: the passenger is told you're here and
        their waiting time starts. {rule}
      </p>
    )
  }

  if (seconds == null || !waiting) return null
  const fee = waiting.amount ?? waitingFee(seconds, waiting)
  const free = seconds < waiting.free_seconds
  return (
    <div className="rounded-xl border border-[#CFE8D6] bg-[#F4FBF6] px-3 py-2.5 text-sm text-[#17201B]" data-testid="ride-waiting-step" role="status">
      <p className="flex items-center justify-between gap-2 font-semibold">
        <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> Waiting {formatClock(seconds)}</span>
        <span>{free ? 'Free' : `₱${fee.toFixed(2)} so far`}</span>
      </p>
      <p className="mt-1 text-xs text-[#56615B]">{rule} Tap Passenger On Board when they're in.</p>
    </div>
  )
}
