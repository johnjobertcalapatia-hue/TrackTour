import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { BedDouble, ChevronDown, Compass, LayoutGrid, MapPin, Search, Store, UtensilsCrossed, type LucideIcon } from 'lucide-react'
import { get } from '@/shared/services/api'
import { cn, formatCurrency, toAssetUrl } from '@/shared/utils'
import LandingShell from './components/LandingShell'
import LandingItemCard, { LandingEmpty, LandingSpinner, type LandingItem } from './components/LandingItemCard'

type Tab = 'all' | 'places' | 'food' | 'businesses' | 'stays'

interface ExploreItem {
  id: number
  name: string
  cover_photo: string | null
  logo?: string | null
  rating: number | null
  municipality: string
  type: 'place' | 'food' | 'stay'
  starting_price?: number
}

interface ExploreData {
  places: ExploreItem[]
  food: ExploreItem[]
  stays: ExploreItem[]
  municipalities?: { id: number; name: string; businesses_count?: number }[]
}

interface MapBusiness {
  id: number
  name: string
  cover_photo?: string | null
  municipality?: string | null
  category?: string | null
  average_rating?: number
  review_count?: number
}

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'all', label: 'All', icon: LayoutGrid },
  { key: 'places', label: 'Tourist Spots', icon: Compass },
  { key: 'food', label: 'Food', icon: UtensilsCrossed },
  { key: 'businesses', label: 'Businesses', icon: Store },
  { key: 'stays', label: 'Resorts', icon: BedDouble },
]

const TYPE_LABEL: Record<ExploreItem['type'], string> = { place: 'Tourist Spot', food: 'Restaurant', stay: 'Resort & Stay' }
const TYPE_ICON: Record<ExploreItem['type'], LucideIcon> = { place: Compass, food: UtensilsCrossed, stay: BedDouble }

function initialTabFromParams(param: string | null): Tab {
  return param === 'places' || param === 'food' || param === 'businesses' || param === 'stays' ? param : 'all'
}

/** Public explore page: every published spot, restaurant, stay and business. */
export default function LandingExplorePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = initialTabFromParams(searchParams.get('tab'))
  const query = searchParams.get('q') ?? ''
  const [municipality, setMunicipality] = useState('')
  const [draft, setDraft] = useState(query)

  const { data, isLoading } = useQuery({
    queryKey: ['landing-explore'],
    queryFn: () => get<ExploreData>('/tourist/explore'),
  })

  const { data: businessData } = useQuery({
    queryKey: ['landing-explore-businesses'],
    queryFn: () => get<MapBusiness[]>('/map/businesses'),
  })

  const places = data?.places ?? []
  const food = data?.food ?? []
  const stays = data?.stays ?? []
  const businesses = businessData ?? []

  let filtered: (ExploreItem | MapBusiness)[] = []
  if (tab === 'all') filtered = [...places, ...food, ...stays]
  else if (tab === 'places') filtered = places
  else if (tab === 'food') filtered = food
  else if (tab === 'businesses') filtered = businesses
  else filtered = stays

  if (municipality) {
    filtered = filtered.filter((item) => item.municipality === municipality)
  }

  // ?q= from the landing hero search: match name, category or municipality.
  const needle = query.trim().toLowerCase()
  if (needle) {
    filtered = filtered.filter((item) =>
      [item.name, 'category' in item ? item.category : null, item.municipality]
        .some((v) => typeof v === 'string' && v.toLowerCase().includes(needle))
    )
  }

  const municipalities = data?.municipalities ?? []

  const setParam = (key: 'tab' | 'q', value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value && !(key === 'tab' && value === 'all')) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }

  const toItem = (item: ExploreItem | MapBusiness): LandingItem => {
    if ('type' in item) {
      return {
        key: `${item.type}-${item.id}`,
        to: item.type === 'place' ? `/tourist/destinations/${item.id}` : item.type === 'food' ? `/explore/food/${item.id}` : `/tourist/explore/${item.id}`,
        title: item.name,
        image: item.cover_photo ? toAssetUrl(item.cover_photo) : null,
        category: TYPE_LABEL[item.type],
        location: item.municipality,
        rating: item.rating,
        note: item.starting_price && item.starting_price > 0 ? `From ${formatCurrency(item.starting_price)}` : null,
        icon: TYPE_ICON[item.type],
      }
    }
    return {
      key: `business-${item.id}`,
      to: `/tourist/explore/${item.id}`,
      title: item.name,
      image: item.cover_photo ? toAssetUrl(item.cover_photo) : null,
      category: item.category ?? 'Business',
      location: item.municipality ?? null,
      rating: item.average_rating ?? null,
      icon: Store,
    }
  }

  const loading = isLoading && tab !== 'businesses'

  return (
    <LandingShell
      eyebrow="Explore"
      title="Explore Bansud & District 2"
      subtitle="Tourist spots, restaurants, resorts and local businesses across Oriental Mindoro."
      back={{ to: '/', label: 'Back to Home', onClick: () => sessionStorage.setItem('tracktour_scroll_to_content', '1') }}
      bandExtra={
        <div className="flex flex-col gap-3 lg:flex-row">
          <form
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              setParam('q', draft.trim())
            }}
            className="flex flex-1 items-center gap-2 rounded-full bg-white p-1.5 pl-5 shadow-xl"
          >
            <Search className="h-5 w-5 shrink-0 text-[#14351F]" aria-hidden="true" />
            <input
              type="search"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                if (!e.target.value) setParam('q', '')
              }}
              placeholder="Search for restaurants, resorts, attractions..."
              aria-label="Search places"
              className="min-w-0 flex-1 !border-0 bg-transparent !px-0 py-2.5 text-sm text-[#14351F] placeholder-[#6B7280] !shadow-none !outline-none !ring-0"
            />
            <button type="submit" className="rounded-full bg-[#0B5D2E] px-6 py-2.5 text-sm font-bold text-white hover:bg-[#094A25]">
              Search
            </button>
          </form>
          <div className="relative lg:w-64">
            <MapPin className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0B5D2E]" aria-hidden="true" />
            <select
              aria-label="Filter by municipality"
              value={municipality}
              onChange={(e) => setMunicipality(e.target.value)}
              className="h-full w-full cursor-pointer appearance-none rounded-full border-0 bg-white py-3.5 pl-11 pr-10 text-sm font-semibold text-[#14351F] shadow-xl focus:outline-none focus:ring-2 focus:ring-[#FFD000]"
            >
              <option value="">All municipalities</option>
              {municipalities.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#5B6A60]" aria-hidden="true" />
          </div>
        </div>
      }
    >
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="no-scrollbar flex gap-2 overflow-x-auto rounded-full bg-white p-1.5 shadow-[0_8px_24px_rgba(6,40,20,0.08)] ring-1 ring-[#E7E2D6]" role="tablist" aria-label="Filter places">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setParam('tab', t.key)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
                tab === t.key ? 'bg-[#0B5D2E] text-white shadow' : 'text-[#14351F] hover:bg-[#EAF6ED]'
              )}
            >
              <t.icon className={cn('h-4 w-4', tab === t.key ? 'text-[#FFD000]' : 'text-[#0B5D2E]')} aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>
        {!loading && (
          <p className="text-sm text-[#5B6A60]">
            <span className="font-bold text-[#14351F]">{filtered.length}</span> {filtered.length === 1 ? 'place' : 'places'}
            {needle && <> matching &ldquo;{query}&rdquo;</>}
            {municipality && <> in {municipality}</>}
          </p>
        )}
      </div>

      {loading ? (
        <LandingSpinner />
      ) : filtered.length === 0 ? (
        <LandingEmpty message={needle ? `Nothing matches “${query}”. Try another word or clear the search.` : 'Nothing found'} />
      ) : (
        <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item, i) => {
            const card = toItem(item)
            return (
              <li key={card.key}>
                <LandingItemCard item={card} index={i} />
              </li>
            )
          })}
        </ul>
      )}
    </LandingShell>
  )
}
