import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/shared/utils'

/**
 * A button that fires only after being held down (SOS, 2026-11-18): a tap or
 * a brush does nothing; holding fills the button and sends after `holdMs`.
 * Works with touch, mouse and keyboard (hold Space or Enter). Letting go
 * early cancels.
 */
export default function HoldToSendButton({
  onComplete, holdMs = 3000, disabled = false, label, holdingLabel = 'Keep holding…', ariaLabel, className, fillClassName = 'bg-white/30',
}: {
  onComplete: () => void
  holdMs?: number
  disabled?: boolean
  label: ReactNode
  holdingLabel?: string
  ariaLabel: string
  className?: string
  fillClassName?: string
}) {
  const [progress, setProgress] = useState(0)
  const startedAt = useRef<number | null>(null)
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const completeRef = useRef(onComplete)
  completeRef.current = onComplete

  const stop = () => {
    if (doneTimer.current) clearTimeout(doneTimer.current)
    if (tickTimer.current) clearInterval(tickTimer.current)
    doneTimer.current = null
    tickTimer.current = null
    startedAt.current = null
    setProgress(0)
  }

  const begin = () => {
    if (disabled || startedAt.current !== null) return
    startedAt.current = Date.now()
    setProgress(0.001)
    tickTimer.current = setInterval(() => {
      if (startedAt.current !== null) setProgress(Math.min(1, (Date.now() - startedAt.current) / holdMs))
    }, 50)
    doneTimer.current = setTimeout(() => {
      stop()
      completeRef.current()
    }, holdMs)
  }

  useEffect(() => stop, [])
  useEffect(() => {
    if (disabled) stop()
  }, [disabled])

  const holding = progress > 0
  // Whole milliseconds first: (1 - 2/3) × 3000 is 1000.00002, which must read "1", not "2".
  const secondsLeft = Math.max(1, Math.ceil(Math.round((1 - progress) * holdMs) / 1000))
  const isHoldKey = (key: string) => key === ' ' || key === 'Enter'

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onPointerDown={(e) => { e.preventDefault(); begin() }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => { if (isHoldKey(e.key)) { e.preventDefault(); if (!e.repeat) begin() } }}
      onKeyUp={(e) => { if (isHoldKey(e.key)) stop() }}
      onBlur={stop}
      onContextMenu={(e) => e.preventDefault()}
      className={cn('relative select-none overflow-hidden touch-none', className)}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 left-0', fillClassName)} style={{ width: `${progress * 100}%` }} />
      <span className="relative flex items-center justify-center gap-2">
        {holding ? <span aria-live="assertive">{holdingLabel} {secondsLeft}</span> : label}
      </span>
    </button>
  )
}
