import { Link } from 'react-router-dom'
import { LayoutGrid, Map as MapIcon, Megaphone } from 'lucide-react'
import { cn } from '@/shared/utils'

export type ExploreSection = 'posts' | 'businesses' | 'map'

interface Props {
  current: ExploreSection
  /** Business category to carry between the business list and the map ('food', 'stays', …). */
  category?: string | null
  /** floating: over the map (white pill with a shadow). */
  floating?: boolean
  /** Stretch to the container's width at every screen size (the map's places panel). */
  fill?: boolean
  className?: string
}

/**
 * Explore's three views, one switch shared by every view (2026-11-24):
 * Deals & Posts (the default), Businesses (the business cards) and Map.
 * The business category travels between Businesses and Map.
 */
export default function ExploreSectionTabs({ current, category, floating = false, fill = false, className }: Props) {
  const cat = category && category !== 'all' ? category : null
  const items: { key: ExploreSection; label: string; icon: typeof MapIcon; to: string }[] = [
    { key: 'posts', label: 'Deals & Posts', icon: Megaphone, to: '/tourist/explore' },
    { key: 'businesses', label: 'Businesses', icon: LayoutGrid, to: cat ? `/tourist/explore?view=businesses&tab=${cat}` : '/tourist/explore?view=businesses' },
    { key: 'map', label: 'Map', icon: MapIcon, to: cat ? `/tourist/explore/map?category=${cat}` : '/tourist/explore/map' },
  ]

  return (
    <nav
      aria-label="Explore views"
      data-testid="explore-sections"
      className={cn(
        // Phones: the three tabs share the full width (nothing cut off); wider screens: natural width.
        'flex w-full max-w-full items-center gap-1 rounded-full border border-[#DCE6DF] bg-[#fff] p-1',
        !fill && 'sm:inline-flex sm:w-auto',
        floating && 'shadow-md',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.key === current
        return (
          <Link
            key={item.key}
            to={item.to}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'inline-flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[13px] font-semibold transition sm:gap-2 sm:text-sm',
              !fill && 'sm:flex-none sm:px-4',
              active ? 'bg-[#087F3F] text-white' : 'text-[#2F4A3A] hover:bg-[#E9F7EF]',
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
