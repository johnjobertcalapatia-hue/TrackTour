import { Hotel, Layers, LayoutGrid, Mountain, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { cn } from '@/shared/utils'

export type LandingMapCategory = 'all' | 'Tourist Spots' | 'Restaurants' | 'Resorts'

const OPTIONS: Array<{ key: LandingMapCategory; label: string; icon: LucideIcon }> = [
  { key: 'all', label: 'All', icon: Layers },
  { key: 'Tourist Spots', label: 'Tourist Spots', icon: Mountain },
  { key: 'Restaurants', label: 'Restaurants', icon: UtensilsCrossed },
  { key: 'Resorts', label: 'Resorts', icon: Hotel },
]

/**
 * Map view toolbar: a segmented category filter (icon + live count per
 * category) and the switch back to the content view.
 */
export default function LandingMapFilters({
  value,
  onChange,
  counts,
  onShowContent,
}: {
  value: LandingMapCategory
  onChange: (next: LandingMapCategory) => void
  /** Places on the map per category (`all` = every place). */
  counts: Record<LandingMapCategory, number>
  onShowContent: () => void
}) {
  return (
    <div className="mx-[10px] mb-[10px] flex items-center gap-3">
      <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          role="group"
          aria-label="Filter map places"
          className="inline-flex items-center gap-1 rounded-2xl border border-[#E2E8E3] bg-white p-1 shadow-sm"
        >
          {OPTIONS.map(({ key, label, icon: Icon }) => {
            const active = value === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => onChange(key)}
                aria-pressed={active}
                className={cn(
                  'flex h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl pl-3 pr-2 text-sm font-semibold transition-colors',
                  active
                    ? 'bg-[#087F3F] text-white shadow-sm'
                    : 'text-[#3C4A41] hover:bg-[#EAF6ED] hover:text-[#087F3F]',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
                <span
                  aria-label={`${counts[key]} places`}
                  className={cn(
                    'min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums',
                    active ? 'bg-white/20 text-white' : 'bg-[#F1F5F2] text-[#5B6A60]',
                  )}
                >
                  {counts[key]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onShowContent}
        aria-label="Toggle content and map"
        title="Back to the content view"
        className="flex h-12 shrink-0 items-center gap-2 rounded-2xl border border-[#E2E8E3] bg-white px-4 text-sm font-semibold text-[#17201A] shadow-sm transition-colors hover:border-[#087F3F]/40 hover:bg-[#EAF6ED] hover:text-[#087F3F]"
      >
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Content</span>
      </button>
    </div>
  )
}
