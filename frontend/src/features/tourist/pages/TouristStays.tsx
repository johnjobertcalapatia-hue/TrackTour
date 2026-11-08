import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { useCurrentMunicipality, DEFAULT_MUNICIPALITY_NAME } from '@/shared/hooks/use-current-municipality'
import { PRICING_BASIS_LABEL } from '@/features/tourist/components/resort/ResortDetail'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { cn, formatCurrency, toAssetUrl } from '@/shared/utils'
import { Search, Star, MapPin, X, ArrowUpDown, ChevronDown, BedDouble, Tag, CalendarCheck, Mountain, Ticket, SlidersHorizontal, Check } from 'lucide-react'

interface StayItem {
  id: number
  name: string
  cover_photo: string | null
  logo: string | null
  category: string | null
  municipality: string | null
  address: string | null
  price_range: string | null
  rating: number | null
  reviews_count: number
  accepts_reservation: boolean
  is_open: boolean
  /** Dynamic resort system (Stage 1/2): real classifications and facilities. */
  resort_types?: { slug: string; name: string }[]
  facilities?: { slug: string | null; name: string }[]
  /** Only when real inventory / published prices exist (later stages). */
  cottage_count?: number | null
  starting_price?: number | null
  starting_price_basis?: 'per_person' | 'per_unit' | 'per_hour' | 'per_night' | 'per_booking' | null
}

interface StayFilters {
  resort_types: { slug: string; name: string; count: number }[]
  facilities: { slug: string; name: string; count: number }[]
  custom_facilities: { name: string; count: number }[]
  municipalities: { id: number; name: string; count: number }[]
  rating_available: boolean
}

interface PromotionItem {
  id: number
  name: string
  description: string | null
  type: string | null
  value: number | null
  min_order: number | null
  code: string | null
  end_date: string | null
  business: {
    id: number
    name: string
    cover_photo: string | null
    category: string | null
    municipality: string | null
    kind: 'stay' | 'attraction'
  }
}

interface StaysPage {
  accommodations: StayItem[]
  types: string[]
  filters?: StayFilters
  promotions: PromotionItem[]
  meta: { current_page: number; last_page: number; total: number }
}

const RATING_OPTIONS = [
  { value: '', label: 'Any rating' },
  { value: '4.5', label: '4.5★ & up' },
  { value: '4', label: '4★ & up' },
  { value: '3', label: '3★ & up' },
]

/** Location filter: the tourist's area (default), every municipality, or one. */
type LocationChoice = 'auto' | 'all' | number

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value])

const SORT_OPTIONS = [
  { value: 'popular', label: 'Popular' },
  { value: 'rating', label: 'Top rated' },
  { value: 'name', label: 'A–Z' },
]

/** "20% OFF" / "₱100 OFF" from the stored promotion type + value; null if unknown. */
function promotionBadge(p: Pick<PromotionItem, 'type' | 'value'>): string | null {
  if (p.value == null || !(p.value > 0)) return null
  const v = Number.isInteger(p.value) ? String(p.value) : p.value.toFixed(2)
  if (p.type === 'percentage' || p.type === 'percent') return `${v}% OFF`
  if (p.type === 'fixed' || p.type === 'amount' || p.type === 'fixed_amount') return `₱${v} OFF`
  return null
}

function formatValidUntil(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function TouristStays() {
  // "Explore <place>" follows the municipality the tourist is in (Bansud when unknown).
  const municipality = useCurrentMunicipality()
  const isSignedIn = useAuthStore((s) => !!s.user)
  const placeName = municipality?.name ?? DEFAULT_MUNICIPALITY_NAME
  const province = municipality?.province || 'Oriental Mindoro'
  const exploreTo = municipality
    ? (isSignedIn ? `/tourist/municipality/${municipality.id}` : `/explore/municipality/${municipality.id}`)
    : '/tourist/explore'
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search.trim(), 300)
  const [type, setType] = useState('all')
  const [sort, setSort] = useState('popular')
  // Resort filters (Stage 2).
  const [resortTypes, setResortTypes] = useState<string[]>([])
  const [facilities, setFacilities] = useState<string[]>([])
  const [customFacilities, setCustomFacilities] = useState<string[]>([])
  const [location, setLocation] = useState<LocationChoice>('auto')
  const [minRating, setMinRating] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)

  // 'auto' = the tourist's municipality (falling back to all when it has none).
  const municipalityId = location === 'auto' ? (municipality?.id ?? null) : null
  const explicitMunicipality = typeof location === 'number' ? location : null

  // Stays in the tourist's municipality. If it has none (for this search/type),
  // fall back to every municipality and say so (subtitle names the province).
  const staysQuery = useInfiniteQuery({
    queryKey: ['tourist-stays-v5', type, sort, debouncedSearch, municipalityId, explicitMunicipality, resortTypes, facilities, customFacilities, minRating],
    queryFn: async ({ pageParam }): Promise<StaysPage & { scoped: boolean }> => {
      const load = (scope: number | null) => get<StaysPage>('/tourist/stays', {
        params: {
          ...(debouncedSearch ? { search: debouncedSearch } : {}),
          ...(type !== 'all' ? { type } : {}),
          ...(scope ? { municipality_id: scope } : {}),
          ...(explicitMunicipality ? { municipality_id: explicitMunicipality } : {}),
          ...(resortTypes.length ? { resort_types: resortTypes } : {}),
          ...(facilities.length ? { facilities } : {}),
          ...(customFacilities.length ? { custom_facilities: customFacilities } : {}),
          ...(minRating ? { min_rating: minRating } : {}),
          sort,
          page: pageParam.page,
        },
      })
      const scope = pageParam.page === 1 ? municipalityId : pageParam.scope
      const data = await load(scope)
      if (pageParam.page === 1 && scope && (data.meta?.total ?? data.accommodations?.length ?? 0) === 0) {
        return { ...(await load(null)), scoped: false }
      }
      return { ...data, scoped: !!scope }
    },
    initialPageParam: { page: 1, scope: null as number | null },
    getNextPageParam: (last) => (last.meta && last.meta.current_page < last.meta.last_page
      ? { page: last.meta.current_page + 1, scope: last.scoped ? municipalityId : null }
      : undefined),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  const pages = staysQuery.data?.pages ?? []
  const stays = pages.flatMap((p) => p.accommodations ?? [])
  const first = pages[0]
  const types = first?.types ?? []
  // Filter options come with the list (kept while a new filter loads via keepPreviousData).
  const opts = first?.filters ?? null
  const promotions = first?.promotions ?? []
  const total = first?.meta?.total ?? stays.length
  /** True when the list shows only the tourist's municipality. */
  const scoped = first?.scoped ?? false
  const chosenMunicipality = explicitMunicipality ? opts?.municipalities.find((m) => m.id === explicitMunicipality)?.name : null
  const where = chosenMunicipality ?? (scoped ? placeName : province)
  const isLoading = staysQuery.isLoading
  const resortFilterCount = resortTypes.length + facilities.length + customFacilities.length + (minRating ? 1 : 0) + (location !== 'auto' ? 1 : 0)
  const panelFilterCount = facilities.length + customFacilities.length + (minRating ? 1 : 0) + (location !== 'auto' ? 1 : 0)
  const hasFilters = type !== 'all' || search.trim() !== '' || resortFilterCount > 0

  const clearFilters = () => {
    setType('all')
    setSearch('')
    setResortTypes([])
    setFacilities([])
    setCustomFacilities([])
    setLocation('auto')
    setMinRating('')
  }

  const facilityName = (slug: string) => opts?.facilities.find((x) => x.slug === slug)?.name ?? slug
  const typeName = (slug: string) => opts?.resort_types.find((x) => x.slug === slug)?.name ?? slug
  const activeChips: { key: string; label: string; remove: () => void }[] = [
    ...resortTypes.map((t) => ({ key: `t-${t}`, label: typeName(t), remove: () => setResortTypes((v) => v.filter((x) => x !== t)) })),
    ...facilities.map((x) => ({ key: `f-${x}`, label: facilityName(x), remove: () => setFacilities((v) => v.filter((y) => y !== x)) })),
    ...customFacilities.map((x) => ({ key: `c-${x}`, label: x, remove: () => setCustomFacilities((v) => v.filter((y) => y !== x)) })),
    ...(location === 'all' ? [{ key: 'loc', label: 'All municipalities', remove: () => setLocation('auto') }] : []),
    ...(chosenMunicipality ? [{ key: 'loc', label: chosenMunicipality, remove: () => setLocation('auto') }] : []),
    ...(minRating ? [{ key: 'r', label: `${minRating}★ & up`, remove: () => setMinRating('') }] : []),
  ]

  return (
    <div className="max-w-[1600px] mx-auto pb-24 lg:pb-6">
      <header className="mb-4 sm:mb-6">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-[#17201B] tracking-tight">Stays &amp; Deals</h1>
        <p className="mt-1 text-sm sm:text-base text-[#56615B]">Resorts, hotels and homestays in <span data-testid="stays-where">{where}</span>, plus current promos from resorts and attractions.</p>
      </header>

      {/* ── Deals & Promotions ── */}
      {promotions.length > 0 && (
        <section aria-labelledby="deals-heading" className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="w-5 h-5 text-[#087F3F]" aria-hidden="true" />
            <h2 id="deals-heading" className="text-lg sm:text-xl font-extrabold text-[#17201B]">Deals &amp; Promotions</h2>
          </div>
          <ul className="-mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3 overflow-x-auto scrollbar-hide pb-1 snap-x">
            {promotions.map((p) => <PromotionCard key={p.id} promo={p} />)}
          </ul>
        </section>
      )}

      {/* ── Search + sort ── */}
      <section aria-labelledby="stays-heading">
        <h2 id="stays-heading" className="sr-only">Accommodations</h2>
        <div className="flex items-center gap-2 sm:gap-3">
          <label className="relative flex-1 min-w-0">
            <span className="sr-only">Search stays</span>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#56615B]" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search resorts, hotels, towns..."
              className="w-full h-11 pl-10 pr-10 bg-white border border-[#E5E9E7] rounded-full text-sm text-[#17201B] placeholder-[#68736D] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-[#56615B] hover:bg-[#F3F8F4]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </label>
          <label className="relative shrink-0">
            <span className="sr-only">Sort stays</span>
            <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#087F3F] pointer-events-none" aria-hidden="true" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="appearance-none h-11 w-[124px] sm:w-auto bg-white border border-[#E5E9E7] rounded-full pl-9 pr-8 text-sm font-medium text-[#17201B] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
            >
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#56615B] pointer-events-none" aria-hidden="true" />
          </label>
        </div>

        {types.length > 0 && (
          <nav aria-label="Stay types" className="mt-3 -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto scrollbar-hide pb-1">
            {['all', ...types].map((t) => {
              const active = type === t
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setType(t)}
                  className={cn(
                    'shrink-0 whitespace-nowrap h-9 px-4 rounded-full text-sm font-semibold border transition-colors',
                    active ? 'bg-[#087F3F] border-[#087F3F] text-white' : 'bg-white border-[#E5E9E7] text-[#3B4540] hover:border-[#087F3F] hover:text-[#087F3F]',
                  )}
                >
                  {t === 'all' ? 'All' : t}
                </button>
              )
            })}
          </nav>
        )}

        {/* Resort type (multi-select; full catalogue, disabled when nothing is listed) */}
        {opts && opts.resort_types.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Resort type">
            <span className="text-xs font-semibold uppercase tracking-wide text-[#56615B] mr-1">Resort type</span>
            {opts.resort_types.map((t) => {
              const active = resortTypes.includes(t.slug)
              return (
                <button
                  key={t.slug}
                  type="button"
                  aria-pressed={active}
                  disabled={t.count === 0 && !active}
                  onClick={() => setResortTypes((v) => toggle(v, t.slug))}
                  className={cn(
                    'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                    active ? 'bg-[#E9F7EF] border-[#087F3F] text-[#087F3F]' : 'bg-white border-[#E5E9E7] text-[#3B4540] hover:border-[#087F3F]',
                  )}
                >
                  {active && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                  {t.name.replace(/ Resort$/, '')}
                  <span className="text-[11px] font-medium text-[#56615B]">{t.count}</span>
                </button>
              )
            })}
            <button
              type="button"
              aria-expanded={filtersOpen}
              aria-controls="stay-filters-panel"
              onClick={() => setFiltersOpen((v) => !v)}
              className={cn(
                'ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[13px] font-semibold border transition-colors',
                panelFilterCount > 0 ? 'bg-[#087F3F] border-[#087F3F] text-white' : 'bg-white border-[#E5E9E7] text-[#3B4540] hover:border-[#087F3F]',
              )}
            >
              <SlidersHorizontal className="w-4 h-4" aria-hidden="true" /> Filters{panelFilterCount > 0 ? ` (${panelFilterCount})` : ''}
            </button>
          </div>
        )}

        {/* Facilities, location, rating */}
        {opts && filtersOpen && (
          <div id="stay-filters-panel" className="mt-3 p-4 rounded-2xl bg-white border border-[#E5E9E7] grid gap-4 sm:grid-cols-[1fr_auto]">
            <fieldset className="min-w-0">
              <legend className="text-sm font-bold text-[#17201B] mb-2">Facilities</legend>
              {opts.facilities.length + opts.custom_facilities.length === 0 ? (
                <p className="text-sm text-[#56615B]">No facilities listed yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {opts.facilities.map((x) => (
                    <FilterCheck key={x.slug} label={x.name} count={x.count} checked={facilities.includes(x.slug)} onChange={() => setFacilities((v) => toggle(v, x.slug))} />
                  ))}
                  {opts.custom_facilities.map((x) => (
                    <FilterCheck key={`custom-${x.name}`} label={x.name} count={x.count} checked={customFacilities.includes(x.name)} onChange={() => setCustomFacilities((v) => toggle(v, x.name))} />
                  ))}
                </div>
              )}
            </fieldset>
            <div className="flex flex-col gap-3 sm:w-56">
              <label className="text-sm font-bold text-[#17201B]">
                Location
                <select
                  value={String(location)}
                  onChange={(e) => setLocation(e.target.value === 'auto' || e.target.value === 'all' ? e.target.value : Number(e.target.value))}
                  className="mt-1 w-full h-10 px-3 rounded-xl border border-[#E5E9E7] bg-white text-sm font-medium text-[#17201B] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
                >
                  <option value="auto">Your area{municipality ? ` (${municipality.name})` : ''}</option>
                  <option value="all">All municipalities</option>
                  {opts.municipalities.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.count})</option>)}
                </select>
              </label>
              {opts.rating_available && (
                <label className="text-sm font-bold text-[#17201B]">
                  Rating
                  <select
                    value={minRating}
                    onChange={(e) => setMinRating(e.target.value)}
                    className="mt-1 w-full h-10 px-3 rounded-xl border border-[#E5E9E7] bg-white text-sm font-medium text-[#17201B] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
                  >
                    {RATING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </label>
              )}
            </div>
          </div>
        )}

        {activeChips.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Active filters">
            {activeChips.map((c) => (
              <li key={c.key}>
                <button type="button" onClick={c.remove} aria-label={`Remove filter ${c.label}`} className="inline-flex items-center gap-1 h-7 pl-3 pr-2 rounded-full bg-[#087F3F] text-white text-xs font-semibold hover:bg-[#056B35]">
                  {c.label} <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 mb-3 flex items-center justify-between gap-3 min-h-[24px]">
          <p className="text-sm text-[#56615B]" aria-live="polite">
            {isLoading ? 'Loading stays…' : <><span className="font-semibold text-[#17201B]">{total}</span> {total === 1 ? 'stay' : 'stays'}</>}
          </p>
          {hasFilters && !isLoading && (
            <button type="button" onClick={clearFilters} className="text-sm font-semibold text-[#087F3F] hover:underline">Clear filters</button>
          )}
        </div>

        {isLoading ? (
          <div className="home-grid">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-[#E5E9E7]" />
                <div className="p-4 space-y-2"><div className="h-4 bg-[#E5E9E7] rounded w-3/4" /><div className="h-3 bg-[#E5E9E7] rounded w-1/2" /></div>
              </div>
            ))}
          </div>
        ) : stays.length === 0 ? (
          <div className="text-center py-12 px-6 rounded-2xl border border-dashed border-[#C2DEC9] bg-white">
            <BedDouble className="w-12 h-12 text-[#C2DEC9] mx-auto mb-3" aria-hidden="true" />
            {hasFilters ? (
              <>
                <h3 className="text-base font-bold text-[#17201B]">No stays match your search</h3>
                <p className="mt-1 text-sm text-[#56615B]">Try another type, facility, location or search term.</p>
                <button type="button" onClick={clearFilters} className="mt-4 h-10 px-5 bg-[#087F3F] text-white rounded-full text-sm font-semibold hover:bg-[#056B35] transition">Clear filters</button>
              </>
            ) : (
              <>
                <h3 className="text-base font-bold text-[#17201B]">No stays listed yet</h3>
                <p className="mt-1 text-sm text-[#56615B]">Resorts, hotels and homestays appear here once the Tourism Office approves them.</p>
                <Link to={exploreTo} className="mt-4 inline-flex h-10 px-5 items-center bg-[#087F3F] text-white rounded-full text-sm font-semibold hover:bg-[#056B35] transition">Explore {placeName}</Link>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="home-grid">
              {stays.map((s) => <StayCard key={s.id} stay={s} />)}
            </div>
            {staysQuery.hasNextPage && (
              <div className="mt-6 flex justify-center">
                <button
                  type="button"
                  onClick={() => staysQuery.fetchNextPage()}
                  disabled={staysQuery.isFetchingNextPage}
                  className="h-11 px-6 rounded-full border-2 border-[#087F3F] bg-white text-sm font-bold text-[#087F3F] hover:bg-[#E9F7EF] disabled:opacity-60 transition"
                >
                  {staysQuery.isFetchingNextPage ? 'Loading…' : 'Show more stays'}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function PromotionCard({ promo }: { promo: PromotionItem }) {
  const badge = promotionBadge(promo)
  const until = formatValidUntil(promo.end_date)
  const img = promo.business.cover_photo ? toAssetUrl(promo.business.cover_photo) : ''
  const isAttraction = promo.business.kind === 'attraction'

  return (
    <li className="snap-start shrink-0 w-[min(18rem,82vw)]">
      <Link
        to={`/tourist/explore/${promo.business.id}`}
        aria-label={`${promo.name} at ${promo.business.name}`}
        className="promo-card group block h-full bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden"
      >
        <div className="relative h-32 bg-gradient-to-br from-[#087F3F] to-[#0B2A17] overflow-hidden">
          {img && <img src={img} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />}
          <span className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
          {badge && (
            <span className="absolute top-3 left-3 inline-flex items-center h-7 px-3 rounded-full bg-[#F4B400] text-[#17201B] text-xs font-extrabold">{badge}</span>
          )}
          <span className="absolute top-3 right-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/90 text-[#17201B] text-[11px] font-bold">
            {isAttraction ? <Mountain className="w-3.5 h-3.5 text-[#087F3F]" aria-hidden="true" /> : <BedDouble className="w-3.5 h-3.5 text-[#087F3F]" aria-hidden="true" />}
            {isAttraction ? 'Attraction' : (promo.business.category ?? 'Stay')}
          </span>
          <p className="absolute bottom-2 left-3 right-3 text-sm font-bold text-white truncate">{promo.business.name}</p>
        </div>
        <div className="p-3.5">
          <h3 className="text-[15px] font-bold text-[#17201B] leading-snug line-clamp-1">{promo.name}</h3>
          {promo.description && <p className="mt-0.5 text-xs text-[#56615B] line-clamp-2">{promo.description}</p>}
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px]">
            {promo.code && (
              <span className="inline-flex items-center gap-1 h-6 px-2 rounded-md border border-dashed border-[#087F3F] text-[#047332] font-bold">
                <Ticket className="w-3.5 h-3.5" aria-hidden="true" /> {promo.code}
              </span>
            )}
            {until && <span className="text-[#56615B]">Valid until {until}</span>}
          </div>
        </div>
      </Link>
    </li>
  )
}

/** Facility / filter checkbox pill. */
function FilterCheck({ label, count, checked, onChange }: { label: string; count: number; checked: boolean; onChange: () => void }) {
  return (
    <label className={cn(
      'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[13px] font-medium cursor-pointer select-none transition-colors',
      checked ? 'bg-[#E9F7EF] border-[#087F3F] text-[#087F3F]' : 'bg-white border-[#E5E9E7] text-[#3B4540] hover:border-[#087F3F]',
    )}>
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      {checked && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
      {label}
      <span className="text-[11px] text-[#56615B]">{count}</span>
    </label>
  )
}

function StayCard({ stay }: { stay: StayItem }) {
  const img = stay.cover_photo ? toAssetUrl(stay.cover_photo) : ''
  const typeLabels = stay.resort_types ?? []
  const facilityLabels = stay.facilities ?? []
  const place = stay.municipality || stay.address
  return (
    <Link
      to={`/tourist/explore/${stay.id}`}
      className="home-card group block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden"
    >
      <div className="relative aspect-[4/3] bg-[#E9F7EF] overflow-hidden">
        {img ? (
          <img src={img} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"><BedDouble className="w-10 h-10 text-[#087F3F]/35" aria-hidden="true" /></div>
        )}
        {stay.accepts_reservation && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-[#087F3F] text-white text-xs font-bold">
            <CalendarCheck className="w-3.5 h-3.5" aria-hidden="true" /> Book online
          </span>
        )}
      </div>
      <div className="p-4">
        {stay.category && <p className="text-[11px] font-semibold uppercase tracking-wide text-[#047332] truncate">{stay.category}</p>}
        <h3 className="mt-0.5 text-[16px] font-bold text-[#17201B] truncate">{stay.name}</h3>
        {typeLabels.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Resort types">
            {typeLabels.slice(0, 2).map((t) => (
              <li key={t.slug} className="h-5 px-2 rounded-full bg-[#E9F7EF] text-[11px] font-bold text-[#047332] leading-5">{t.name}</li>
            ))}
            {typeLabels.length > 2 && <li className="h-5 px-2 rounded-full bg-[#F3F4F6] text-[11px] font-bold text-[#56615B] leading-5">+{typeLabels.length - 2}</li>}
          </ul>
        )}
        <div className="mt-1 flex items-center justify-between gap-2 text-sm">
          {place ? (
            <span className="flex items-center gap-1 text-[#56615B] truncate">
              <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" /> {place}
            </span>
          ) : <span />}
          {stay.rating !== null ? (
            <span className="flex items-center gap-1 shrink-0">
              <Star className="w-4 h-4 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" />
              <span className="font-semibold text-[#17201B]">{stay.rating.toFixed(1)}</span>
              <span className="text-xs text-[#56615B]">({stay.reviews_count})</span>
            </span>
          ) : (
            <span className="text-xs text-[#56615B] shrink-0">New</span>
          )}
        </div>
        {facilityLabels.length > 0 && (
          <p className="mt-1.5 text-xs text-[#56615B] truncate" aria-label={`Facilities: ${facilityLabels.map((x) => x.name).join(', ')}`}>
            {facilityLabels.slice(0, 3).map((x) => x.name).join(' · ')}
            {facilityLabels.length > 3 && ` · +${facilityLabels.length - 3} more`}
          </p>
        )}
        {/* Real numbers only: shown once inventory / published offering prices exist. */}
        {(stay.cottage_count ?? 0) > 0 && (
          <p className="mt-1 text-xs font-semibold text-[#3B4540]">{stay.cottage_count} {stay.cottage_count === 1 ? 'cottage' : 'cottages'}</p>
        )}
        {stay.starting_price != null && stay.starting_price > 0 ? (
          <p className="mt-1.5 text-sm font-bold text-[#087F3F]">
            From {formatCurrency(stay.starting_price)}
            {stay.starting_price_basis && <span className="text-xs font-semibold text-[#56615B]"> / {PRICING_BASIS_LABEL[stay.starting_price_basis]}</span>}
          </p>
        ) : stay.price_range ? (
          <p className="mt-1.5 text-sm font-bold text-[#087F3F]">{stay.price_range}</p>
        ) : null}
      </div>
    </Link>
  )
}
