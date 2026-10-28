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
}

const BROWSING_HISTORY_KEY = 'tracktour_browsing_history'
const MAX_HISTORY_ITEMS = 8

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

    const filtered = existing.filter((item) => !(item.id === place.id && item.discoveryGroup === group))
    const nextList = [updatedItem, ...filtered].slice(0, MAX_HISTORY_ITEMS)

    localStorage.setItem(BROWSING_HISTORY_KEY, JSON.stringify(nextList))
    window.dispatchEvent(new Event('browsing-history-updated'))
  } catch {}
}

export function clearBrowsedPlaces(): void {
  try {
    localStorage.removeItem(BROWSING_HISTORY_KEY)
    window.dispatchEvent(new Event('browsing-history-updated'))
  } catch {}
}
