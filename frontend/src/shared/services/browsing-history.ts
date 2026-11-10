import { getDiscoveryGroup, type DiscoveryGroup } from '@/shared/utils/category'

export interface BrowsedPlace {
  id: number
  name: string
  category: string
  discoveryGroup: DiscoveryGroup
  cover_photo: string | null
  logo: string | null
  municipality: string
  rating: number | null
  url: string
  viewed_at: number
  /** 'food' for a dish (food item page); places (restaurants, attractions, stays) omit it. */
  kind?: 'place' | 'food'
}

const BROWSING_HISTORY_KEY = 'tracktour_browsing_history'
/** Kept for My Activities → Explored (Home "Recently Viewed" shows the latest RECENT_PLACES_LIMIT). */
const MAX_HISTORY_ITEMS = 60
export const RECENT_PLACES_LIMIT = 8

export function getBrowsedPlaces(): BrowsedPlace[] {
  try {
    const raw = localStorage.getItem(BROWSING_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed
      .filter((item): item is BrowsedPlace =>
        Boolean(item && typeof item === 'object' && typeof item.id === 'number' && typeof item.name === 'string')
      )
      .slice(0, MAX_HISTORY_ITEMS)
  } catch {
    return []
  }
}

export function recordBrowsedPlace(place: Omit<BrowsedPlace, 'viewed_at' | 'discoveryGroup'> & { discoveryGroup?: DiscoveryGroup }): void {
  try {
    const existing = getBrowsedPlaces()
    const group = place.discoveryGroup ?? getDiscoveryGroup(place.category)

    const updatedItem: BrowsedPlace = {
      ...place,
      discoveryGroup: group,
      viewed_at: Date.now(),
    }

    // A dish and a restaurant can share an id: compare the kind too.
    const kind = place.kind ?? 'place'
    const filtered = existing.filter((item) => !(item.id === place.id && item.discoveryGroup === group && (item.kind ?? 'place') === kind))
    const nextList = [updatedItem, ...filtered].slice(0, MAX_HISTORY_ITEMS)

    localStorage.setItem(BROWSING_HISTORY_KEY, JSON.stringify(nextList))
    window.dispatchEvent(new Event('browsing-history-updated'))
  } catch {}
}

/** A dish entry (food item page), including ones saved before `kind` existed. */
export function isBrowsedDish(place: Pick<BrowsedPlace, 'kind' | 'url'>): boolean {
  return place.kind === 'food' || (typeof place.url === 'string' && place.url.startsWith('/tourist/food/item/'))
}

/**
 * Where a history entry opens. A dish opens its dish page; a restaurant opens
 * the restaurant page (old restaurant entries still point at
 * /tourist/explore/:id); anything else opens its saved url.
 *
 * Dishes are in the "dining" group too: routing every dining entry to
 * /tourist/food/:id sent a DISH id to the restaurant page — Home → Recently
 * Viewed "Pork/Chicken Sisig" (dish 7) opened "restaurant 7", which does not
 * exist (reported 2026-11-09).
 */
export function browsedPlaceLink(place: Pick<BrowsedPlace, 'id' | 'kind' | 'discoveryGroup' | 'url'>): string {
  if (isBrowsedDish(place)) return `/tourist/food/item/${place.id}`
  if (place.discoveryGroup === 'dining') return `/tourist/food/${place.id}`
  return place.url
}

/**
 * Drop a place that no longer exists (its page answered 404) from the
 * history, so Home → Recently Viewed and My Activities → Explored stop
 * linking to it. History lives in the browser, so it can outlive a record
 * the server removed (e.g. after a database reset).
 */
export function forgetBrowsedPlace(id: number, kind: 'place' | 'food' = 'place'): void {
  try {
    const existing = getBrowsedPlaces()
    const next = existing.filter((item) => !(item.id === id && (item.kind ?? 'place') === kind))
    if (next.length === existing.length) return
    localStorage.setItem(BROWSING_HISTORY_KEY, JSON.stringify(next))
    window.dispatchEvent(new Event('browsing-history-updated'))
  } catch {}
}

export function clearBrowsedPlaces(): void {
  try {
    localStorage.removeItem(BROWSING_HISTORY_KEY)
    window.dispatchEvent(new Event('browsing-history-updated'))
  } catch {}
}
