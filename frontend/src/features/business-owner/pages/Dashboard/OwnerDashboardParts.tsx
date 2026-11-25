import type { ReactNode } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'

/** Shared pieces of the redesigned owner dashboards (attraction, resort). */
export const CARD = 'rounded-[20px] border border-[#E2E8E3] bg-[#fff] shadow-[0_6px_18px_rgba(22,101,52,0.06)]'

/** Change vs the previous 30 days, in words a business owner reads at a glance. */
export function Trend({ now, before }: { now: number; before: number }) {
  if (now === 0 && before === 0) return <span className="text-xs text-[#8A948E]">No visits recorded yet</span>
  if (before === 0) return <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#16803C]"><TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> New this month</span>
  const diff = now - before
  if (diff === 0) return <span className="text-xs text-[#5E6B63]">Same as the 30 days before</span>
  const up = diff > 0
  const Icon = up ? TrendingUp : TrendingDown
  // Small numbers read better as a count ("11 more") than a percentage ("+1100%").
  const text = before < 20
    ? `${Math.abs(diff)} ${up ? 'more' : 'fewer'} than the 30 days before`
    : `${up ? '+' : ''}${Math.round((diff / before) * 100)}% vs the 30 days before`
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${up ? 'text-[#16803C]' : 'text-[#B45309]'}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {text}
    </span>
  )
}

export function Kpi({ label, value, icon, children, testId }: { label: string; value: ReactNode; icon: ReactNode; children?: ReactNode; testId: string }) {
  return (
    <div className={`${CARD} p-5`} data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#647067]">{label}</p>
          <p className="mt-2 text-3xl font-bold tabular-nums text-[#17201B]">{value}</p>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EAF6ED] text-[#16803C] [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      </div>
      <div className="mt-2 min-h-[18px]">{children}</div>
    </div>
  )
}

