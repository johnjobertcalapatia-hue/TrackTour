const TOURIST_ATTRACTION_CATEGORY_NAMES = ['tourist attraction', 'attractions']

export function isTouristAttractionCategory(name?: string | null): boolean {
  if (!name) return false
  return TOURIST_ATTRACTION_CATEGORY_NAMES.includes(name.trim().toLowerCase())
}

export function findTouristAttractionCategoryId(
  categories?: Array<{ id: number; name: string }> | null,
): number | null {
  const match = categories?.find((category) => isTouristAttractionCategory(category.name))
  return match?.id ?? null
}
