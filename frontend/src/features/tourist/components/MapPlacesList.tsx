import { useLayoutEffect, useRef, type MutableRefObject } from 'react'
import { ChevronRight, MapPin, Search, Star, X } from 'lucide-react'
import { toAssetUrl } from '@/shared/utils'
import { getDiscoveryGroup } from '@/shared/utils/category'
import FilterDropdown, { type FilterOption } from '@/features/tourist/components/FilterDropdown'

/** What the explore map's places list needs from a business. */
export interface MapPlace {
  id: number
  name: string
  business_name?: string | null
  category: { id: number; name: string } | null
  municipality: { id: number; name: string } | null
  barangay?: { id: number; name: string } | null
  address: string | null
  latitude: number | null
  longitude: number | null
  logo: string | null
  cover_photo: string | null
  is_open: boolean
  reviews_count: number
  reviews_avg_rating: number | null
}

/** Case-insensitive match on name, category, municipality, barangay and address. */
export function matchesPlaceSearch(place: MapPlace, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = [
    place.name,
    place.business_name,
    place.category?.name,
    nameOf(place.municipality),
    nameOf(place.barangay),
    place.address,
  ].filter(Boolean).join(' ').toLowerCase()
  return words.every((w) => haystack.includes(w))
}

/** Straight-line distance in km. */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

export type PlaceSort = 'nearest' | 'top-rated' | 'most-reviewed' | 'name'

const SORT_LABELS: Record<PlaceSort, string> = {
  nearest: 'Nearest',
  'top-rated': 'Top rated',
  'most-reviewed': 'Most reviewed',
  name: 'Name A–Z',
}

/** Some API rows carry the municipality as a plain name instead of `{ id, name }`. */
function nameOf(value: { name: string } | string | null | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.name
}

/**
 * Left panel of the tourist explore map: a search box, category and
 * municipality dropdowns, and a card per place left on the map. Clicking a
 * card opens that place's details in the same panel.
 */
export default function MapPlacesList({
  places,
  query,
  onQueryChange,
  onSelect,
  onHover,
  userLocation,
  scrollRef,
  municipality = '',
  municipalities,
  onMunicipalityChange,
  category = '',
  categories,
  onCategoryChange,
  totalCount,
  municipalityCount,
  sort = 'top-rated',
  onSortChange,
}: {
  /** Already filtered by the category, the municipality and the search. */
  places: MapPlace[]
  query: string
  onQueryChange: (q: string) => void
  onSelect: (place: MapPlace) => void
  /** Card hovered (null on leave): the map highlights its marker. */
  onHover?: (id: number | null) => void
  /** Closest first, with the distance shown, once the tourist's location is known. */
  userLocation?: { lat: number; lng: number } | null
  /** Keeps the list's scroll position while a place's details are open. */
  scrollRef?: MutableRefObject<number>
  /** Municipality filter (id as a string, '' = all). */
  municipality?: string
  municipalities?: FilterOption[]
  onMunicipalityChange?: (value: string) => void
  /** Category filter (option id, '' = all); the same filter as the map's category chips. */
  category?: string
  categories?: FilterOption[]
  onCategoryChange?: (value: string) => void
  /** Every business on the map, before any filter, and how many municipalities they are in. */
  totalCount?: number
  municipalityCount?: number
  /** List order. 'nearest' is offered once the tourist's location is known. */
  sort?: PlaceSort
  onSortChange?: (sort: PlaceSort) => void
}) {
  const q = query.trim()
  const municipalityName = municipalities?.find((m) => String(m.id) === municipality)?.name
  const filtering = !!q || !!municipalityName
  const clearFilters = () => {
    onQueryChange('')
    onMunicipalityChange?.('')
  }
  const listRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (listRef.current && scrollRef) listRef.current.scrollTop = scrollRef.current
  }, [scrollRef])

  const rows = places.map((place) => ({
    place,
    km: userLocation && place.latitude != null && place.longitude != null
      ? distanceKm(userLocation, { lat: place.latitude, lng: place.longitude })
      : null,
  }))
  type Row = (typeof rows)[number]
  const byName = (a: Row, b: Row) => a.place.name.localeCompare(b.place.name)
  const rating = (r: Row) => Number(r.place.reviews_avg_rating ?? 0)
  const reviews = (r: Row) => Number(r.place.reviews_count ?? 0)
  const effectiveSort: PlaceSort = sort === 'nearest' && !userLocation ? 'top-rated' : sort
  rows.sort((a, b) => {
    if (effectiveSort === 'nearest') return (a.km ?? Infinity) - (b.km ?? Infinity) || byName(a, b)
    if (effectiveSort === 'most-reviewed') return reviews(b) - reviews(a) || rating(b) - rating(a) || byName(a, b)
    if (effectiveSort === 'name') return byName(a, b)
    return rating(b) - rating(a) || reviews(b) - reviews(a) || byName(a, b)
  })
  const sortOptions = (Object.keys(SORT_LABELS) as PlaceSort[])
    .filter((k) => k !== 'nearest' || !!userLocation)
    .map((k) => ({ id: k, name: SORT_LABELS[k] }))

  return (
    <div className="flex flex-1 min-h-0 flex-col" data-testid="map-places-list">
      <div className="shrink-0 px-3 pb-2">
        {(totalCount != null || onSortChange) && (
          <div className="mb-2 flex items-center justify-between gap-2">
            {totalCount != null && (
              <p data-testid="map-places-total" className="min-w-0 truncate text-sm text-[#56615B]">
                <span className="font-bold text-[#17201B]">{totalCount.toLocaleString()}</span> {totalCount === 1 ? 'business' : 'businesses'}
                {municipalityCount != null && (
                  <> across <span className="font-bold text-[#17201B]">{municipalityCount}</span> {municipalityCount === 1 ? 'municipality' : 'municipalities'}</>
                )}
              </p>
            )}
            {onSortChange && (
              <FilterDropdown
                id="map-places-sort"
                testId="map-places-sort"
                variant="field"
                size="sm"
                align="right"
                label="Sort places"
                value={effectiveSort}
                options={sortOptions}
                onChange={(v) => onSortChange(v as PlaceSort)}
                className="ml-auto shrink-0"
              />
            )}
          </div>
        )}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8A948F]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search places, categories..."
            aria-label="Search places"
            // `!`: beats the global input rule (index.css, unlayered).
            className="h-10 w-full rounded-xl! border! border-[#E5E9E7]! bg-white! shadow-none! pl-9 pr-9 text-sm text-[#17201B] placeholder:text-[#8A948F] focus:border-[#087F3F]! focus:ring-2 focus:ring-[#087F3F]/20 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[#56615B] hover:bg-[#E9F7EF] hover:text-[#087F3F]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        {((categories && onCategoryChange) || (municipalities && onMunicipalityChange)) && (
          <div data-testid="map-places-filters" className="mt-2 grid grid-cols-2 gap-2">
            {categories && onCategoryChange && (
              <FilterDropdown
                id="map-places-category"
                testId="map-places-category"
                variant="field"
                label="Category"
                allLabel="All Categories"
                value={category}
                options={categories}
                onChange={onCategoryChange}
                className="min-w-0"
              />
            )}
            {municipalities && onMunicipalityChange && (
              <FilterDropdown
                id="map-places-municipality"
                testId="map-places-municipality"
                variant="field"
                align="right"
                label="Municipality"
                allLabel="All Municipalities"
                value={municipality}
                options={municipalities}
                onChange={onMunicipalityChange}
                className="min-w-0"
              />
            )}
          </div>
        )}
        <p className="mt-2 px-1 text-xs text-[#56615B]" aria-live="polite">
          <span className="font-semibold text-[#087F3F]">{places.length}</span> {places.length === 1 ? 'place' : 'places'}
          {q ? ` matching “${q}”` : ''}
          {municipalityName ? ` in ${municipalityName}` : q ? '' : ' on the map'}
        </p>
      </div>

      <div
        ref={listRef}
        onScroll={(e) => { if (scrollRef) scrollRef.current = e.currentTarget.scrollTop }}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
      >
        {rows.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <MapPin className="mx-auto h-9 w-9 text-[#087F3F]/40" aria-hidden="true" />
            <p className="mt-3 text-sm text-[#56615B]">
              {q
                ? `No places match “${q}”${municipalityName ? ` in ${municipalityName}` : ''}.`
                : municipalityName
                  ? `Nothing listed in ${municipalityName} yet.`
                  : 'No places in this category yet.'}
            </p>
            {filtering && (
              <button
                type="button"
                onClick={clearFilters}
                className="mt-4 h-9 rounded-full bg-[#087F3F] px-4 text-sm font-semibold text-white hover:bg-[#056B35]"
              >
                {municipalityName ? 'Show all places' : 'Clear search'}
              </button>
            )}
          </div>
        ) : (
          <ul className="space-y-2" aria-label="Places">
            {rows.map(({ place, km }) => {
              const photo = place.cover_photo || place.logo
              const rating = Number(place.reviews_avg_rating ?? 0)
              const dining = getDiscoveryGroup(place.category?.name, place.category?.id) === 'dining'
              return (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(place)}
                    onMouseEnter={() => onHover?.(place.id)}
                    onMouseLeave={() => onHover?.(null)}
                    onFocus={() => onHover?.(place.id)}
                    onBlur={() => onHover?.(null)}
                    aria-label={place.name}
                    className="group flex w-full items-center gap-3 rounded-2xl border border-[#E5E9E7] bg-white p-2 text-left transition hover:border-[#087F3F]/50 hover:bg-[#F3FAF6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#087F3F]/40"
                  >
                    <span className="h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-[#E9F7EF]">
                      {photo ? (
                        <img src={toAssetUrl(photo)} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <MapPin className="h-6 w-6 text-[#087F3F]/50" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-[#17201B]">{place.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-[#56615B]">{place.category?.name ?? 'Place'}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                        {rating > 0 ? (
                          <span className="inline-flex items-center gap-0.5 font-semibold text-[#17201B]">
                            <Star className="h-3 w-3 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" />
                            {rating.toFixed(1)}
                            <span className="font-normal text-[#8A948F]">({place.reviews_count})</span>
                          </span>
                        ) : (
                          <span className="text-[#8A948F]">No ratings yet</span>
                        )}
                        {dining && (
                          <span className={place.is_open ? 'font-semibold text-[#087F3F]' : 'font-semibold text-red-600'}>
                            {place.is_open ? 'Open' : 'Closed'}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-[#56615B]">
                        <MapPin className="h-3 w-3 shrink-0 text-[#087F3F]" aria-hidden="true" />
                        <span className="truncate">{nameOf(place.municipality) ?? 'Oriental Mindoro'}</span>
                        {km != null && <span className="shrink-0 text-[#8A948F]">· {km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`}</span>}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-[#C9D1CD] transition group-hover:text-[#087F3F]" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
