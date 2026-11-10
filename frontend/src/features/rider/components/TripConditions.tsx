import { CheckCircle2, CircleX } from 'lucide-react'
import { cn } from '@/shared/utils'
import type { Condition } from '@/features/rider/trip-steps'

/** What a rider action waits for: a tick when met, a cross when not. */
export function TripConditions({ items, className }: { items: Condition[]; className?: string }) {
  if (items.length === 0) return null
  return (
    <ul className={cn('space-y-1', className)} aria-label="Requirements">
      {items.map((c) => (
        <li key={c.label} data-met={c.met} className={cn('flex items-start gap-1.5 text-xs', c.met ? 'text-[#166534]' : 'text-[#92400E]')}>
          {c.met
            ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-label="Done" />
            : <CircleX className="mt-px h-3.5 w-3.5 shrink-0" aria-label="Not yet" />}
          <span>{c.label}</span>
        </li>
      ))}
    </ul>
  )
}
