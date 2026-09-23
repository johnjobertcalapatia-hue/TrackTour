import { useEffect, useState } from 'react'

/**
 * Live preparation countdown for the restaurant Orders module.
 *
 * The backend starts the timer when a rider accepts the delivery
 * (`predicted_ready_at`) and auto-flips PREPARING → READY at 00:00, so this
 * component is display-only: it ticks down to the server's due time.
 */
function remainingSeconds(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = new Date(iso).getTime() - Date.now()
  return Math.max(0, Math.floor(ms / 1000))
}

export function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

interface PreparationCountdownProps {
  readyAt: string | null | undefined
  className?: string
}

export function PreparationCountdown({ readyAt, className }: PreparationCountdownProps) {
  const [remaining, setRemaining] = useState(() => remainingSeconds(readyAt))

  useEffect(() => {
    setRemaining(remainingSeconds(readyAt))
    if (!readyAt) return
    const id = setInterval(() => setRemaining(remainingSeconds(readyAt)), 1000)
    return () => clearInterval(id)
  }, [readyAt])

  if (remaining === null) return <span className={className}>—</span>
  if (remaining <= 0) return <span className={className}>Ready</span>
  return <span className={className}>{formatCountdown(remaining)}</span>
}
