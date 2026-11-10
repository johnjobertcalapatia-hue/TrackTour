import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { browsedPlaceLink, clearBrowsedPlaces, getBrowsedPlaces, type BrowsedPlace } from '@/shared/services/browsing-history'
import { getSeenMunicipalities } from '@/shared/hooks/use-current-municipality'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { cn, toAssetUrl } from '@/shared/utils'
import { BedDouble, Car, Compass, MapPin, Mountain, Store, Trash2, UtensilsCrossed } from 'lucide-react'
import TouristOrders from './TouristOrders'
import TouristHistory from './TouristHistory'
import TouristFavorites from './TouristFavorites'

type View = 'explored' | 'orders' | 'travels' | 'favourites'

const VIEWS: { key: View; label: string }[] = [
  { key: 'explored', label: 'Explored' },
  { key: 'orders', label: 'Orders' },
  { key: 'travels', label: 'Travels' },
  { key: 'favourites', label: 'Favourites' },
]

type ExploredFilter = 'all' | 'restaurants' | 'attractions' | 'foods' | 'resorts'

const EXPLORED_FILTERS: { key: ExploredFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'restaurants', label: 'Restaurants' },
  { key: 'attractions', label: 'Attractions' },
  { key: 'foods', label: 'Foods' },
  { key: 'resorts', label: 'Resorts' },
]

function typeOf(p: BrowsedPlace): Exclude<ExploredFilter, 'all'> | 'other' {
  if (p.kind === 'food') return 'foods'
  if (p.discoveryGroup === 'dining') return 'restaurants'
  if (p.discoveryGroup === 'spot') return 'attractions'
  if (p.discoveryGroup === 'accommodation') return 'resorts'
  return 'other'
}

const TYPE_META: Record<ReturnType<typeof typeOf>, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  restaurants: { label: 'Restaurant', icon: Store },
  attractions: { label: 'Attraction', icon: Mountain },
  foods: { label: 'Food', icon: UtensilsCrossed },
  resorts: { label: 'Resort / Stay', icon: BedDouble },
  other: { label: 'Place', icon: Compass },
}

function viewedAgo(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000))
  if (mins < 1) return 'Viewed just now'
  if (mins < 60) return `Viewed ${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `Viewed ${hours} h ago`
  const days = Math.round(hours / 24)
  return `Viewed ${days} day${days === 1 ? '' : 's'} ago`
}

function isView(v: string | null): v is View {
  return VIEWS.some((x) => x.key === v)
}

/**
 * My Activities: everything the tourist has done, in one place.
 *   Explored   restaurants, attractions, foods and resorts they looked at
 *   Orders     My Orders (to pay → to review)
 *   Travels    transport trips and stay bookings
 *   Favourites saved places
 * The section is kept in ?view= (Orders keeps its own ?tab= alongside).
 */
export default function TouristActivities() {
  const [searchParams, setSearchParams] = useSearchParams()
  const view: View = isView(searchParams.get('view')) ? (searchParams.get('view') as View) : 'explored'

  const selectView = (key: View) => setSearchParams(key === 'explored' ? {} : { view: key }, { replace: true })

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-4">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">My Activities</h1>
        <p className="mt-1 text-sm text-[#56615B]">Places you explored, your orders, travels and favourites.</p>
      </div>

      {/* Plain text tabs: the active one is green with an underline. */}
      <div role="tablist" aria-label="My activities" className="grid grid-cols-4 mb-5 border-b border-[#E5E9E7]">
        {VIEWS.map(({ key, label }) => {
          const active = view === key
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`activities-panel-${key}`}
              id={`activities-tab-${key}`}
              onClick={() => selectView(key)}
              className={cn(
                'activities-tab -mb-px h-11 border-b-2 text-sm sm:text-[15px] font-semibold transition-colors',
                active ? 'border-[#087F3F] text-[#087F3F]' : 'border-transparent text-[#56615B] hover:text-[#17201B]',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      <section role="tabpanel" id={`activities-panel-${view}`} aria-labelledby={`activities-tab-${view}`}>
        {view === 'explored' && <ExploredPanel />}
        {view === 'orders' && <TouristOrders embedded />}
        {view === 'travels' && <TravelsPanel />}
        {view === 'favourites' && <TouristFavorites embedded />}
      </section>
    </div>
  )
}

function ExploredPanel() {
  const [places, setPlaces] = useState<BrowsedPlace[]>(() => getBrowsedPlaces())
  const [filter, setFilter] = useState<ExploredFilter>('all')

  useEffect(() => {
    const sync = () => setPlaces(getBrowsedPlaces())
    window.addEventListener('browsing-history-updated', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('browsing-history-updated', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const shown = filter === 'all' ? places : places.filter((p) => typeOf(p) === filter)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter explored">
          {EXPLORED_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'h-9 px-4 rounded-full text-sm font-medium transition',
                filter === f.key ? 'bg-[#087F3F] text-white' : 'bg-white border border-[#E5E9E7] text-[#3B4540] hover:border-[#087F3F]/40',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {places.length > 0 && (
          <button
            type="button"
            onClick={() => clearBrowsedPlaces()}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-semibold text-[#B91C1C] hover:bg-red-50"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" /> Clear history
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-12 text-center">
          <Compass className="w-12 h-12 text-[#56615B]/30 mx-auto mb-4" />
          <p className="text-lg font-bold text-[#17201B]">Nothing explored yet</p>
          <p className="mt-1 text-sm text-[#56615B]">Restaurants, attractions, foods and resorts you open will show up here.</p>
          <Link to="/tourist/explore" className="mt-5 inline-flex h-10 px-5 items-center rounded-full bg-[#087F3F] text-white text-sm font-semibold hover:bg-[#056B35]">
            Start exploring
          </Link>
        </div>
      ) : (
        // One section per kind (Foods, Restaurants, Attractions, Resorts, Others);
        // a filter shows just its own section.
        <div className="space-y-8">
          {SECTION_ORDER.filter((type) => filter === 'all' || filter === type).map((type) => {
            const group = shown.filter((p) => typeOf(p) === type)
            if (group.length === 0) return null
            const { title, icon: Icon } = SECTION_META[type]
            return (
              <section key={type} aria-labelledby={`explored-${type}-title`}>
                <h2 id={`explored-${type}-title`} className="flex items-center gap-2 text-lg font-bold text-[#17201B] mb-3">
                  <Icon className="w-5 h-5 text-[#087F3F]" aria-hidden="true" />
                  {title}
                  <span className="text-sm font-semibold text-[#56615B]">({group.length})</span>
                </h2>
                <ul className="food-list-grid" aria-label={title}>
                  {group.map((p) => <ExploredCard key={`${p.kind ?? 'place'}-${p.discoveryGroup}-${p.id}`} place={p} />)}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

type ExploredType = ReturnType<typeof typeOf>

/** Section order on the Explored tab. */
const SECTION_ORDER: ExploredType[] = ['foods', 'restaurants', 'attractions', 'resorts', 'other']

const SECTION_META: Record<ExploredType, { title: string; icon: React.ComponentType<{ className?: string }> }> = {
  foods: { title: 'Foods', icon: UtensilsCrossed },
  restaurants: { title: 'Restaurants', icon: Store },
  attractions: { title: 'Attractions', icon: Mountain },
  resorts: { title: 'Resorts & Stays', icon: BedDouble },
  other: { title: 'Others', icon: Compass },
}

function ExploredCard({ place: p }: { place: BrowsedPlace }) {
  const meta = TYPE_META[typeOf(p)]
  const img = p.cover_photo || p.logo
  return (
    <li>
      <Link
        to={browsedPlaceLink(p)}
        className="group flex flex-col h-full bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:border-[#087F3F]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#087F3F] transition"
      >
        <div className="relative aspect-[4/3] bg-[#E9F7EF] overflow-hidden">
          {img ? (
            <img src={toAssetUrl(img)} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <meta.icon className="w-10 h-10 text-[#087F3F]/30" />
            </div>
          )}
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-white/90 text-[11px] font-bold text-[#064E2E]">
            <meta.icon className="w-3 h-3" /> {meta.label}
          </span>
        </div>
        <div className="p-3 flex-1 flex flex-col">
          <h3 className="text-[15px] font-bold text-[#17201B] leading-snug line-clamp-1">{p.name}</h3>
          {p.municipality && <p className="text-xs text-[#56615B] truncate">{p.municipality}</p>}
          <p className="mt-auto pt-2 text-[11px] text-[#56615B]">{viewedAgo(p.viewed_at)}</p>
        </div>
      </Link>
    </li>
  )
}

interface VisitedMunicipality {
  id: number
  name: string
  province?: string | null
  cover_photo?: string | null
  food_orders: number
  stays: number
  trips: number
  last_visited_at: string | null
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Travels: the municipalities the tourist has been to (deliveries received,
 * stays, rides, and places the app detected them in), then trips & bookings.
 */
function TravelsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['tourist-travels'],
    queryFn: () => get<{ municipalities: VisitedMunicipality[] }>('/tourist/travels'),
  })

  // Merge the server's records with "You were here" detections from this device.
  const seen = getSeenMunicipalities()
  const byId = new Map<number, VisitedMunicipality & { seenHere: boolean; last: number }>()
  for (const m of data?.municipalities ?? []) {
    byId.set(m.id, { ...m, seenHere: false, last: m.last_visited_at ? Date.parse(m.last_visited_at) : 0 })
  }
  for (const s of seen) {
    const prev = byId.get(s.id)
    byId.set(s.id, {
      id: s.id,
      name: s.name,
      province: prev?.province ?? s.province,
      cover_photo: prev?.cover_photo ?? s.cover_photo,
      food_orders: prev?.food_orders ?? 0,
      stays: prev?.stays ?? 0,
      trips: prev?.trips ?? 0,
      last_visited_at: prev?.last_visited_at ?? null,
      seenHere: true,
      last: Math.max(prev?.last ?? 0, s.last_seen),
    })
  }
  const places = [...byId.values()].sort((a, b) => b.last - a.last)

  return (
    <div className="space-y-8">
      <section aria-labelledby="travels-places-title">
        <h2 id="travels-places-title" className="text-lg font-bold text-[#17201B] mb-3">
          Places you&apos;ve been{places.length > 0 && <span className="ml-2 text-sm font-semibold text-[#56615B]">{plural(places.length, 'municipality', 'municipalities')}</span>}
        </h2>

        {isLoading && places.length === 0 ? (
          <p className="text-sm text-[#56615B]">Loading your travels…</p>
        ) : places.length === 0 ? (
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-10 text-center">
            <MapPin className="w-12 h-12 text-[#56615B]/30 mx-auto mb-4" />
            <p className="text-lg font-bold text-[#17201B]">No travels yet</p>
            <p className="mt-1 text-sm text-[#56615B]">Municipalities you visit, stay in or get food delivered to will show up here.</p>
          </div>
        ) : (
          <ul className="food-list-grid" aria-label="Municipalities visited">
            {places.map((m) => (
              <li key={m.id}>
                <Link
                  to={`/tourist/municipality/${m.id}`}
                  className="group flex flex-col h-full bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:border-[#087F3F]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#087F3F] transition"
                >
                  <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-[#14532D] to-[#0B2A17]">
                    {m.cover_photo ? (
                      <img src={toAssetUrl(m.cover_photo)} alt="" loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <MapPin className="w-10 h-10 text-white/40" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                  <div className="p-3 flex-1 flex flex-col">
                    <h3 className="text-[16px] font-bold text-[#17201B]">{m.name}</h3>
                    {m.province && <p className="text-xs text-[#56615B]">{m.province}</p>}
                    <ul className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold" aria-label={`What you did in ${m.name}`}>
                      {m.food_orders > 0 && (
                        <li className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-[#E9F7EF] text-[#047332]"><UtensilsCrossed className="w-3 h-3" aria-hidden="true" /> {plural(m.food_orders, 'food delivery', 'food deliveries')}</li>
                      )}
                      {m.stays > 0 && (
                        <li className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-sky-50 text-sky-800"><BedDouble className="w-3 h-3" aria-hidden="true" /> {plural(m.stays, 'stay', 'stays')}</li>
                      )}
                      {m.trips > 0 && (
                        <li className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-violet-50 text-violet-800"><Car className="w-3 h-3" aria-hidden="true" /> {plural(m.trips, 'ride', 'rides')}</li>
                      )}
                      {m.seenHere && (
                        <li className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-amber-50 text-amber-800"><MapPin className="w-3 h-3" aria-hidden="true" /> You were here</li>
                      )}
                    </ul>
                    {m.last > 0 && (
                      <p className="mt-auto pt-2 text-[11px] text-[#56615B]">
                        Last visit {new Date(m.last).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="travels-history-title">
        <h2 id="travels-history-title" className="text-lg font-bold text-[#17201B] mb-3">Trips &amp; bookings</h2>
        <TouristHistory embedded only={['transport', 'bookings']} />
      </section>
    </div>
  )
}

