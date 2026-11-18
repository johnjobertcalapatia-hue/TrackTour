import type { ReactNode } from 'react'
import { CalendarDays, CalendarRange, RefreshCw, type LucideIcon } from 'lucide-react'
import { cn, toAssetUrl } from '@/shared/utils'
import { PERIOD_LABELS, type Analytics, type PeriodKey } from './types'

export const todayKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date())

export function greeting(): string {
  const h = Number(new Intl.DateTimeFormat('en-PH', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Manila' }).format(new Date()))
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** "2026-11-01", "2026-11-17" → "Nov 1 – 17, 2026" (or "Oct 28 – Nov 3, 2026", "Nov 17, 2026"). */
export function formatRange(from: string, to: string): string {
  const d = (s: string) => new Date(`${s}T00:00:00Z`)
  const fmt = (s: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...o }).format(d(s))
  const [fy, fm] = from.split('-')
  const [ty, tm] = to.split('-')
  if (from === to) return fmt(from, { month: 'short', day: 'numeric', year: 'numeric' })
  if (fy === ty && fm === tm) return `${fmt(from, { month: 'short', day: 'numeric' })} – ${fmt(to, { day: 'numeric' })}, ${ty}`
  if (fy === ty) return `${fmt(from, { month: 'short', day: 'numeric' })} – ${fmt(to, { month: 'short', day: 'numeric' })}, ${ty}`
  return `${fmt(from, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmt(to, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

const updatedAt = (iso: string) =>
  new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(iso))

/** One labelled filter in the header toolbar (white field, small label above the value). */
export function FilterField({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-[170px] items-center gap-2.5 rounded-xl bg-white px-3 py-1.5 text-[#1C2B22] shadow-sm ring-1 ring-black/5 focus-within:ring-2 focus-within:ring-[#FFD700]">
      <Icon className="h-4 w-4 shrink-0 text-[#2E8B57]" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#66736B]">{label}</span>
        {children}
      </span>
    </label>
  )
}

export const filterSelect = 'w-full cursor-pointer bg-transparent text-sm font-semibold outline-none'

/** Period selector, plus the from/to dates when "Custom range" is chosen. */
export function PeriodFilter({ period, onPeriod, range, onRange, onApply }: {
  period: PeriodKey
  onPeriod: (p: PeriodKey) => void
  range: { from: string; to: string }
  onRange: (r: { from: string; to: string }) => void
  onApply: () => void
}) {
  return (
    <>
      <FilterField icon={CalendarDays} label="Period">
        <select value={period} onChange={(e) => onPeriod(e.target.value as PeriodKey)} className={filterSelect} aria-label="Period">
          {(Object.keys(PERIOD_LABELS) as PeriodKey[]).map((k) => <option key={k} value={k}>{PERIOD_LABELS[k]}</option>)}
        </select>
      </FilterField>
      {period === 'custom' && (
        <form
          className="flex items-center gap-1.5 rounded-xl bg-white px-2.5 py-2 text-sm text-[#1C2B22] shadow-sm ring-1 ring-black/5"
          onSubmit={(e) => {
            e.preventDefault()
            onApply()
          }}
        >
          <input type="date" aria-label="From" value={range.from} max={todayKey()} onChange={(e) => onRange({ ...range, from: e.target.value })} className="rounded-md px-1 outline-none" />
          <span className="text-[#66736B]">–</span>
          <input type="date" aria-label="To" value={range.to} max={todayKey()} onChange={(e) => onRange({ ...range, to: e.target.value })} className="rounded-md px-1 outline-none" />
          <button type="submit" className="rounded-lg bg-[#2E8B57] px-3 py-1 text-xs font-semibold text-white hover:bg-[#257347]">Apply</button>
        </form>
      )}
    </>
  )
}

/**
 * Dashboard header shared by the Bansud and municipal dashboards: identity
 * (logo, greeting, title) with live status and refresh, then one toolbar with
 * the filters and the period being compared.
 */
export function DashboardHeader({ cover, logo, fallbackLogo, name, title, tagline = 'Monitor. Manage. Grow our local tourism.', period, filters, onRefresh, refreshing }: {
  cover?: string | null
  logo?: string | null
  /** Site image (e.g. /assets/logo/tracktour.png) shown when no logo was uploaded. */
  fallbackLogo?: string
  /** Office name, used in the greeting and as the logo fallback initial. */
  name: string
  title: string
  tagline?: string
  period: Analytics['period']
  filters: ReactNode
  onRefresh: () => void
  refreshing: boolean
}) {
  return (
    <section
      className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0F2E1D] via-[#1D5C3A] to-[#2E8B57] bg-cover bg-center shadow-[0_10px_30px_rgba(15,46,29,0.18)]"
      style={cover ? { backgroundImage: `url(${toAssetUrl(cover)})` } : undefined}
      aria-label="Dashboard header"
    >
      {/* Contrast layers: the cover photo is decoration only; text never depends on it. */}
      <div className="absolute inset-0 bg-[#0B2416]/80" aria-hidden="true" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0B2416]/70 via-[#0B2416]/30 to-transparent" aria-hidden="true" />
      <span className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-[#FFD700]/10" aria-hidden="true" />

      <div className="relative px-5 pb-5 pt-6 sm:px-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-white/80 bg-white shadow-lg sm:h-16 sm:w-16">
              {logo ? (
                <img src={toAssetUrl(logo)} alt="" className="h-full w-full object-cover" />
              ) : fallbackLogo ? (
                <img src={fallbackLogo} alt="" className="h-full w-full object-contain p-1.5" />
              ) : (
                <span className="text-2xl font-bold text-[#2E8B57]">{name.charAt(0)}</span>
              )}
            </span>
            <div className="min-w-0 text-white">
              <p className="truncate text-sm text-white/90">{greeting()}, <span className="font-semibold text-white">{name}</span></p>
              <h1 className="mt-0.5 text-2xl font-bold leading-tight text-white sm:text-[28px]">{title}</h1>
              <p className="mt-1 flex items-center gap-2 text-sm text-white/85">
                <span className="h-1 w-6 rounded-full bg-[#FFD700]" aria-hidden="true" /> {tagline}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 self-start">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium text-white ring-1 ring-white/25">
              <span className="relative flex h-2 w-2" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7CE0A3] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#7CE0A3]" />
              </span>
              Live · Updated {updatedAt(period.generated_at)}
            </span>
            <button
              type="button"
              onClick={onRefresh}
              aria-label="Refresh"
              title="Refresh now"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white ring-1 ring-white/25 transition hover:bg-white/20"
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 rounded-2xl bg-[#061A0E]/60 p-2 ring-1 ring-white/15 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Dashboard filters">{filters}</div>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2 pb-1 text-xs text-white/85 lg:pb-0 lg:text-right">
            <CalendarRange className="h-4 w-4 text-[#FFD700]" aria-hidden="true" />
            <span className="text-sm font-semibold text-white">{formatRange(period.from, period.to)}</span>
            <span>compared with {formatRange(period.previous_from, period.previous_to)}</span>
          </p>
        </div>
      </div>
    </section>
  )
}
