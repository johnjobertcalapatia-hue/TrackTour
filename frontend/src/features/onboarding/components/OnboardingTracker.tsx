import { Check, X } from 'lucide-react'
import { cn } from '@/shared/utils'
import type { OnboardingStage } from '@/features/onboarding/types'

/**
 * Vertical onboarding tracker (applicant and staff views), in two phases:
 * 1 · application and requirements (verified by the Tourism Office),
 * 2 · interview and training, then the final approval.
 */
const PHASE_STARTS: Record<string, string> = {
  submitted: 'Phase 1 · Application & requirements',
  appointment: 'Phase 2 · Interview & training',
}

export function OnboardingTracker({ stages, compact = false }: { stages: OnboardingStage[]; compact?: boolean }) {
  return (
    <ol className="relative" aria-label="Onboarding progress">
      {stages.map((stage, i) => {
        const last = i === stages.length - 1
        const phase = PHASE_STARTS[stage.key]
        return [
          phase && (
            <li key={`phase-${stage.key}`} role="presentation" className={cn('text-[11px] font-bold uppercase tracking-wider text-[#0B5D2E]', compact ? 'mb-2' : 'mb-3', i > 0 && (compact ? 'mt-1' : 'mt-2'))}>
              {phase}
            </li>
          ),
          <li key={stage.key} className={cn('relative flex gap-4', !last && (compact ? 'pb-4' : 'pb-6'))} aria-current={stage.status === 'current' ? 'step' : undefined}>
            {!last && (
              <span
                className={cn('absolute left-[15px] top-8 h-[calc(100%-2rem)] w-0.5', stage.status === 'done' ? 'bg-[#2E8B57]' : 'bg-[#E2E8E3]')}
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                stage.status === 'done' && 'bg-[#2E8B57] text-white',
                stage.status === 'current' && 'bg-[#FFD000] text-[#14351F] ring-4 ring-[#FFD000]/30',
                stage.status === 'upcoming' && 'border-2 border-[#D7E1DA] bg-white text-[#9AA5A0]',
                stage.status === 'failed' && 'bg-red-600 text-white'
              )}
            >
              {stage.status === 'done' ? <Check className="h-4 w-4" /> : stage.status === 'failed' ? <X className="h-4 w-4" /> : i + 1}
            </span>
            <div className="min-w-0 pt-1">
              <p className={cn('text-sm font-semibold', stage.status === 'upcoming' ? 'text-[#7A867F]' : 'text-[#14351F]')}>{stage.label}</p>
              <p className="text-xs text-[#5B6A60]">
                {stage.status === 'done' ? 'Completed' : stage.status === 'current' ? 'In progress' : stage.status === 'failed' ? 'Needs attention' : 'Upcoming'}
                {stage.detail ? ` · ${stage.detail}` : ''}
              </p>
            </div>
          </li>,
        ]
      })}
    </ol>
  )
}
