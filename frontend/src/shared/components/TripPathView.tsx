import { CheckCircle2, Circle, CircleDot, XCircle } from 'lucide-react'
import { cn } from '@/shared/utils'

/** One step of the canonical food-trip path (TripPathDiagnostics). */
export interface TripPathStep {
  key: string
  label: string
  state: 'done' | 'current' | 'todo' | 'cancelled'
}

const ICON = {
  done: { icon: CheckCircle2, tone: 'text-emerald-600', text: 'text-[#4B5563]' },
  current: { icon: CircleDot, tone: 'text-[#087F3F]', text: 'font-semibold text-[#17201B]' },
  todo: { icon: Circle, tone: 'text-[#C4CBC7]', text: 'text-[#9CA3AF]' },
  cancelled: { icon: XCircle, tone: 'text-red-500', text: 'text-[#9CA3AF] line-through' },
} as const

/**
 * The trip's steps in the order the rider must do them: done ✓, the current
 * step highlighted, the rest still to do. Used by the rider's Diagnostics and
 * the Tourism Office trip diagnostics.
 */
export default function TripPathView({ path, nextStep, className }: { path: TripPathStep[]; nextStep?: string | null; className?: string }) {
  if (path.length === 0) return null
  return (
    <div className={className}>
      <ol className="space-y-1" aria-label="Trip steps">
        {path.map((step) => {
          const style = ICON[step.state] ?? ICON.todo
          return (
            <li key={step.key} data-step={step.key} data-state={step.state} aria-current={step.state === 'current' ? 'step' : undefined} className="flex items-center gap-2 text-xs">
              <style.icon className={cn('h-3.5 w-3.5 shrink-0', style.tone)} aria-hidden />
              <span className={style.text}>{step.label}</span>
            </li>
          )
        })}
      </ol>
      {nextStep && (
        <p className="mt-2 rounded-lg bg-[#F0FAF3] px-2.5 py-1.5 text-xs text-[#17201B]" data-testid="trip-next-step">
          <span className="font-semibold">Next:</span> {nextStep}
        </p>
      )}
    </div>
  )
}
