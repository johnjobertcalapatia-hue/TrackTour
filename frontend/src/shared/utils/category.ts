const TOURIST_ATTRACTION_CATEGORY_NAMES = [
  'tourist attraction',
  'attractions',
  'attraction',
  'farm tourism',
  'nature',
  'beach',
  'park',
  'historical site',
  'cultural site',
  'adventure',
  'viewpoint',
  'tourist spot',
  'destination',
]

const DINING_CATEGORY_NAMES = [
  'restaurant',
  'café',
  'cafe',
  'food hub',
  'bakery',
  'fast food',
  'food',
  'carinderia',
  'bar',
]

const ACCOMMODATION_CATEGORY_NAMES = [
  'hotel',
  'resort',
  'hotel & restaurant combination',
  'homestay',
  'camping site',
  'tourist inn',
  'apartel',
  'boutique hotel',
  'motel',
  'beach resort',
  'mountain resort',
  'private resort',
  'stay',
  'lodging',
  'inn',
]

/** Seed-canonical ID for "Hotel & Restaurant Combination" (BusinessCategorySeeder order). */
export const HOTEL_RESTAURANT_COMBINATION_CATEGORY_ID = 3
const HOTEL_RESTAURANT_COMBINATION_NAME = 'hotel & restaurant combination'

export type DiscoveryGroup = 'spot' | 'dining' | 'accommodation' | 'other'

function normalizeCategoryName(name?: string | null): string {
  if (!name) return ''
  return name.trim().toLowerCase()
}

function isExactNameMatch(normalized: string, catalog: string[]): boolean {
  return catalog.some((item) => normalized === item)
}

function isIncludesNameMatch(normalized: string, catalog: string[]): boolean {
  return catalog.some((item) => normalized.includes(item) || item.includes(normalized))
}

export function isHotelRestaurantCombination(
  name?: string | null,
  categoryId?: number | null,
): boolean {
  const normalized = normalizeCategoryName(name)
  if (normalized === HOTEL_RESTAURANT_COMBINATION_NAME) return true

  // Explicit seed ID 3 → accommodation, unless the live name is a pure dining label
  // (guards production environments where id 3 was reassigned to "Restaurant").
  if (categoryId === HOTEL_RESTAURANT_COMBINATION_CATEGORY_ID) {
    if (!normalized) return true
    if (normalized === HOTEL_RESTAURANT_COMBINATION_NAME) return true
    if (normalized.includes('hotel') && normalized.includes('restaurant')) return true
    if (isExactNameMatch(normalized, DINING_CATEGORY_NAMES)) return false
    return true
  }

  return false
}

export function isTouristSpotCategory(name?: string | null): boolean {
  const normalized = normalizeCategoryName(name)
  if (!normalized) return false
  return isIncludesNameMatch(normalized, TOURIST_ATTRACTION_CATEGORY_NAMES)
}

export function isDiningCategory(name?: string | null): boolean {
  const normalized = normalizeCategoryName(name)
  if (!normalized) return false
  if (normalized === HOTEL_RESTAURANT_COMBINATION_NAME) return false
  // Prefer exact match so short tokens like "food" / "bar" do not over-match.
  if (isExactNameMatch(normalized, DINING_CATEGORY_NAMES)) return true
  return DINING_CATEGORY_NAMES.some((item) => item.length >= 4 && normalized.includes(item))
}

export function isAccommodationCategory(name?: string | null, categoryId?: number | null): boolean {
  if (isHotelRestaurantCombination(name, categoryId)) return true
  const normalized = normalizeCategoryName(name)
  if (!normalized) return false
  if (isExactNameMatch(normalized, ACCOMMODATION_CATEGORY_NAMES)) return true
  return ACCOMMODATION_CATEGORY_NAMES.some((item) => item.length >= 4 && normalized.includes(item))
}

export function getDiscoveryGroup(name?: string | null, categoryId?: number | null): DiscoveryGroup {
  // Combo category before dining substring checks ("…Restaurant…").
  if (isHotelRestaurantCombination(name, categoryId)) return 'accommodation'
  // Accommodation before spot so "Beach Resort" is never an attraction
  // (mirrors PHP DiscoveryGroup::fromCategoryName and the SQL Spot exclusions).
  if (isAccommodationCategory(name, categoryId)) return 'accommodation'
  if (isTouristSpotCategory(name)) return 'spot'
  if (isDiningCategory(name)) return 'dining'
  return 'other'
}

export function isTouristAttractionCategory(name?: string | null): boolean {
  return isTouristSpotCategory(name)
}

export function findTouristAttractionCategoryId(
  categories?: Array<{ id: number; name: string }> | null,
): number | null {
  const match = categories?.find((category) => isTouristSpotCategory(category.name))
  return match?.id ?? null
}
