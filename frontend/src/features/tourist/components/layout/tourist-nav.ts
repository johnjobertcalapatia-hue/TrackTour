import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Home, Compass, UtensilsCrossed, BedDouble, ClipboardList, Heart, User } from 'lucide-react'

export interface TouristNavItem {
  to: string
  label: string
  /** Short label for the mobile bottom bar (7 tabs on a ~360px screen). */
  shortLabel: string
  icon: React.ComponentType<{ className?: string }>
  /** Extra route prefixes that should highlight this item. */
  alsoActive?: string[]
}

/** Single source of truth for the tourist sidebar and the mobile bottom bar. */
export const TOURIST_NAV_ITEMS: TouristNavItem[] = [
  { to: '/tourist/dashboard', label: 'Home', shortLabel: 'Home', icon: Home },
  {
    to: '/tourist/explore',
    label: 'Explore',
    shortLabel: 'Explore',
    icon: Compass,
    alsoActive: ['/tourist/search', '/tourist/directory', '/tourist/destinations', '/tourist/municipality', '/tourist/events'],
  },
  { to: '/tourist/food', label: 'Food & Dining', shortLabel: 'Food', icon: UtensilsCrossed },
  { to: '/tourist/stays', label: 'Stays', shortLabel: 'Stays', icon: BedDouble },
  {
    to: '/tourist/activities',
    label: 'My Activities',
    shortLabel: 'Activities',
    icon: ClipboardList,
    alsoActive: ['/tourist/orders', '/tourist/trips', '/tourist/booking', '/tourist/history', '/tourist/transport', '/tourist/reviews'],
  },
  { to: '/tourist/favorites', label: 'Saved', shortLabel: 'Saved', icon: Heart },
  { to: '/tourist/profile', label: 'Profile', shortLabel: 'Profile', icon: User },
]

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/')

/**
 * The nav item for the current route. Longest matching prefix wins, so
 * /tourist/food/cart highlights Food & Dining and /tourist/explore/map Explore.
 */
export function useActiveTouristNav(): string | null {
  const { pathname } = useLocation()
  return useMemo(() => {
    let best: { to: string; len: number } | null = null
    for (const item of TOURIST_NAV_ITEMS) {
      for (const prefix of [item.to, ...(item.alsoActive ?? [])]) {
        if (matches(pathname, prefix) && (!best || prefix.length > best.len)) {
          best = { to: item.to, len: prefix.length }
        }
      }
    }
    return best?.to ?? null
  }, [pathname])
}
