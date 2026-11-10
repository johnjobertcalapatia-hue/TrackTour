import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { categoryName, toAssetUrl, safeText, formatCurrency, cn } from '@/shared/utils'
import { browsedPlaceLink, getBrowsedPlaces, isBrowsedDish, RECENT_PLACES_LIMIT, type BrowsedPlace } from '@/shared/services/browsing-history'
import { addToFoodCart } from '@/shared/services/food-cart'
import PhotoPlaceholder from '@/shared/components/PhotoPlaceholder'
import { useCurrentMunicipality, useMunicipalityPhotos, DEFAULT_MUNICIPALITY_NAME } from '@/shared/hooks/use-current-municipality'
import {
  MapPin, Star, Heart, UtensilsCrossed, Compass, Calendar, Search, Camera, Building2,
  ChevronLeft, ChevronRight, ArrowRight, Mountain, Utensils, BedDouble, Navigation,
  Plus, Check, Sparkles, History, Footprints, CalendarDays,
} from 'lucide-react'

/* ─── API shapes (only the fields the endpoints actually return) ─── */

interface TouristSpot {
  id: number; name: string; description?: string | null; category: unknown
  images?: string[] | null; image?: string | null
  latitude?: number | string | null; longitude?: number | string | null
  municipality: unknown; rating?: number | null; entrance_fee?: number | null
}
interface FoodItem {
  id: number; name: string; description?: string | null; category: unknown; image: string | null
  price: number; business_name: string; business_id: number
  business_latitude?: number | string | null; business_longitude?: number | string | null
  rating?: number | null; is_accepting_orders?: boolean
}
interface ExploreBusiness {
  id: number; name: string; cover_photo: string | null; rating: number | string | null; municipality: string; type: string
}
interface TouristEvent {
  id: number; name: string; category: unknown; image?: string | null
  event_date?: string | null; start_time?: string | null; municipality: unknown
}
interface ForYouItem {
  kind: 'food' | 'stay'
  id: number; name: string; subtitle?: string | null
  image?: string | null; price?: number | null; category?: string | null
  distance_km?: number | null; url: string
}
interface ForYouData {
  kind: 'food' | 'stay'; title: string; has_location: boolean; items: ForYouItem[]
}

/* ─── Hero content ─── */

type HeroSlide = { src: string; caption: string }

const DEFAULT_GETAWAY_PHOTO = '/assets/tourism/manihala-falls.png'

/** Default Bansud photos, used until the tourist's municipality has its own. */
const HERO_SLIDES: HeroSlide[] = [
  { src: '/assets/tourism/viewing-hills.png', caption: 'Viewing Hills' },
  { src: '/assets/tourism/rosacara-rolling-hills.png', caption: 'Rosacara Rolling Hills' },
  { src: '/assets/tourism/batong-buwaya-river.png', caption: 'Batong Buwaya River' },
  { src: '/assets/tourism/paypay-ama-falls.png', caption: 'Paypay-Ama Falls' },
]

const HERO_CHIPS = [
  { label: 'All', to: '/tourist/explore', icon: Star },
  { label: 'Attractions', to: '/tourist/destinations', icon: Camera },
  { label: 'Restaurants', to: '/tourist/food', icon: Utensils },
  { label: 'Hotels', to: '/tourist/stays', icon: BedDouble },
  { label: 'Activities', to: '/tourist/explore?tab=places', icon: Footprints },
  { label: 'Events', to: '/tourist/events', icon: CalendarDays },
]

/* ─── Helpers ─── */

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Great-circle distance in km, or null when either point is unknown. */
function distanceKm(from: { lat: number; lng: number } | null, lat: unknown, lng: unknown): number | null {
  const la = toNumber(lat)
  const lo = toNumber(lng)
  if (!from || la === null || lo === null) return null
  const R = 6371
  const dLat = ((la - from.lat) * Math.PI) / 180
  const dLng = ((lo - from.lng) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((from.lat * Math.PI) / 180) * Math.cos((la * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** A real, positive rating or null (never invent one). */
function realRating(v: unknown): number | null {
  const n = toNumber(v)
  return n !== null && n > 0 ? n : null
}

/**
 * Loads a Home section scoped to the tourist's municipality. If that
 * municipality has nothing listed yet (or the tourist isn't located), falls
 * back to every municipality and reports `scoped: false` so the subtitle names
 * the province instead of claiming the items are local.
 */
async function fetchScoped<T>(municipalityId: number | null, load: (scope: number | null) => Promise<T[]>): Promise<{ items: T[]; scoped: boolean }> {
  if (municipalityId) {
    const local = await load(municipalityId)
    if (local.length > 0) return { items: local, scoped: true }
  }
  return { items: await load(null), scoped: false }
}

interface ApiEvent {
  id: number; name: string; image?: string | null; start_date?: string | null
  municipality?: { name?: string | null } | null
}

/** /tourist/events returns `{ events: [...] }` with start_date + a municipality object. */
function toHomeEvent(e: ApiEvent): TouristEvent {
  return {
    id: e.id,
    name: e.name,
    category: null,
    image: e.image ?? null,
    event_date: e.start_date ?? null,
    start_time: null,
    municipality: e.municipality?.name ?? null,
  }
}

export default function TouristHome() {
  const [savedItems, setSavedItems] = useState<Set<string>>(new Set())
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [recentPlaces, setRecentPlaces] = useState<BrowsedPlace[]>(() => getBrowsedPlaces().slice(0, RECENT_PLACES_LIMIT))

  useEffect(() => {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 5000, maximumAge: 300000 },
    )
  }, [])

  useEffect(() => {
    const sync = () => setRecentPlaces(getBrowsedPlaces().slice(0, RECENT_PLACES_LIMIT))
    window.addEventListener('browsing-history-updated', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('browsing-history-updated', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const municipality = useCurrentMunicipality()
  const placeName = municipality?.name ?? DEFAULT_MUNICIPALITY_NAME
  const province = municipality?.province || 'Oriental Mindoro'
  const municipalityId = municipality?.id ?? null

  const { data: forYouData } = useQuery({
    queryKey: ['tourist-for-you', coords?.lat ?? 'default', coords?.lng ?? 'default'],
    queryFn: () => get<ForYouData>('/tourist/for-you', coords ? { params: { lat: coords.lat, lng: coords.lng } } : undefined),
    staleTime: 120_000,
  })
  const { data: spotsData } = useQuery({
    queryKey: ['tourist-spots-home', municipalityId],
    queryFn: () => fetchScoped(municipalityId, (scope) =>
      get<{ data: TouristSpot[] }>('/tourist/destinations', { params: { limit: 8, ...(scope && { municipality: scope }) } }).then((r) => r?.data ?? [])),
    staleTime: 60_000,
  })
  const { data: foodsData } = useQuery({
    queryKey: ['tourist-foods-home', municipalityId],
    queryFn: () => fetchScoped(municipalityId, (scope) =>
      get<{ data: FoodItem[] }>('/tourist/food', { params: { limit: 8, ...(scope && { municipality_id: scope }) } }).then((r) => r?.data ?? [])),
    staleTime: 60_000,
  })
  const { data: staysData } = useQuery({
    queryKey: ['tourist-stays-home', municipalityId],
    queryFn: () => fetchScoped(municipalityId, (scope) =>
      get<{ accommodations?: ExploreBusiness[] }>('/tourist/stays', { params: { sort: 'popular', ...(scope && { municipality_id: scope }) } }).then((r) => r?.accommodations ?? [])),
    staleTime: 60_000,
  })
  const { data: eventsData } = useQuery({
    queryKey: ['tourist-events-home', municipalityId],
    queryFn: () => fetchScoped(municipalityId, (scope) =>
      get<{ events?: ApiEvent[] }>('/tourist/events', { params: { limit: 4, ...(scope && { municipality_id: scope }) } })
        .then((r) => (r?.events ?? []).map(toHomeEvent))),
    staleTime: 60_000,
  })

  const spots = spotsData?.items ?? []
  const foods = foodsData?.items ?? []
  const stays = staysData?.items ?? []
  const events = eventsData?.items ?? []
  /**
   * Municipality photos (cover → attractions → businesses) drive the hero
   * carousel and the getaway card; default Bansud artwork when there are none.
   */
  const photos = useMunicipalityPhotos(municipalityId)
  const heroSlides = useMemo<HeroSlide[]>(
    // Located: only that municipality's real photos (none yet = empty container
    // for its tourism office to fill). Not located: the default Bansud artwork.
    () => (municipalityId ? photos.map((p) => ({ src: toAssetUrl(p.src), caption: p.caption })) : HERO_SLIDES),
    [photos, municipalityId],
  )
  const getawayPick = photos[1] ?? photos[0]
  const getawayPhoto = municipalityId ? (getawayPick ? toAssetUrl(getawayPick.src) : null) : DEFAULT_GETAWAY_PHOTO

  /** Subtitle place for a section: the tourist's municipality when the list is scoped to it, else the province. */
  const where = (scoped: boolean | undefined) => (scoped ? placeName : province)
  const forYouItems = forYouData?.items ?? []

  const toggleSave = (key: string) => {
    setSavedItems((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="pb-12">
      <HomeHero placeName={placeName} province={province} slides={heroSlides} />

      <div className="mx-auto w-full max-w-[1600px] space-y-10 pt-8">

      {/* Featured Destinations */}
      {spots.length > 0 && (
        <section>
          <HomeSectionHeader icon={Mountain} title="Featured Destinations" subtitle={`Must-visit places in ${where(spotsData?.scoped)}`} viewAllTo="/tourist/destinations" />
          <div className="home-grid">
            {spots.slice(0, 4).map((spot) => (
              <DestinationCard
                key={spot.id}
                spot={spot}
                distance={distanceKm(coords, spot.latitude, spot.longitude)}
                saved={savedItems.has(`spot-${spot.id}`)}
                onToggleSave={() => toggleSave(`spot-${spot.id}`)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Popular Food & Restaurants + Plan your getaway */}
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_320px] items-stretch">
        <section className="min-w-0">
          <HomeSectionHeader icon={UtensilsCrossed} title="Popular Food & Restaurants" subtitle={`Taste the best of ${where(foodsData?.scoped)}`} viewAllTo="/tourist/food" />
          {foods.length > 0 ? (
            <div className="home-grid home-grid--compact">
              {foods.slice(0, 4).map((food) => <HomeFoodCard key={food.id} food={food} />)}
            </div>
          ) : (
            <EmptyRow icon={UtensilsCrossed} text="No dishes available right now." />
          )}
        </section>
        <PlanGetawayCard placeName={placeName} photo={getawayPhoto} />
      </div>

      {/* Recommended Stays */}
      {stays.length > 0 && (
        <section>
          <HomeSectionHeader icon={BedDouble} title="Recommended Stays" subtitle={`Relax and unwind in ${where(staysData?.scoped)}`} viewAllTo="/tourist/stays" />
          <div className="home-grid">
            {stays.slice(0, 4).map((stay) => (
              <StayCard key={stay.id} stay={stay} saved={savedItems.has(`stay-${stay.id}`)} onToggleSave={() => toggleSave(`stay-${stay.id}`)} />
            ))}
          </div>
        </section>
      )}

      {/* Recently viewed */}
      {recentPlaces.length > 0 && (
        <section>
          <HomeSectionHeader icon={History} title="Recently Viewed" subtitle="Pick up where you left off" />
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide">
            {recentPlaces.map((place) => (
              <RecentPlaceCard key={`${place.discoveryGroup}-${place.id}`} place={place} />
            ))}
          </div>
        </section>
      )}

      {/* For You (Near You) */}
      {forYouItems.length > 0 && (
        <section>
          <HomeSectionHeader
            icon={Sparkles}
            title={forYouData?.title ?? 'For You'}
            subtitle={forYouData?.has_location ? 'Recommended from the businesses nearest to you' : 'Recommended for you'}
          />
          <div className="home-grid">
            {forYouItems.slice(0, 4).map((item) => <ForYouCard key={`${item.kind}-${item.id}`} item={item} />)}
          </div>
        </section>
      )}

      {/* Upcoming Events */}
      {events.length > 0 && (
        <section>
          <HomeSectionHeader icon={Calendar} title="Upcoming Events" subtitle={`Festivals and happenings in ${where(eventsData?.scoped)}`} viewAllTo="/tourist/events" />
          <div className="home-grid">
            {events.slice(0, 4).map((evt) => <EventCard key={evt.id} event={evt} />)}
          </div>
        </section>
      )}
      </div>
    </div>
  )
}

/* ─── Hero ─────────────────────────────────────────────────────── */

function HomeHero({ placeName, province, slides }: { placeName: string; province: string; slides: HeroSlide[] }) {
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const [query, setQuery] = useState('')
  const go = useCallback((delta: number) => {
    if (slides.length === 0) return
    setIndex((i) => (i + delta + slides.length) % slides.length)
  }, [slides.length])

  // A new municipality brings a new slide set: start from its first photo.
  useEffect(() => { setIndex(0) }, [slides])

  useEffect(() => {
    if (slides.length < 2) return
    const timer = window.setInterval(() => go(1), 7000)
    return () => window.clearInterval(timer)
  }, [go, index, slides.length])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (q) navigate(`/tourist/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <section className="home-hero relative -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 min-h-[420px] sm:min-h-[400px] flex overflow-hidden bg-[#0B2A17]" aria-roledescription="carousel" aria-label={`Explore ${placeName}`}>
      {slides.length === 0 && <PhotoPlaceholder placement="right" testId="hero-photo-empty" />}
      {slides.map((slide, i) => (
        <img
          key={slide.src}
          src={slide.src}
          alt=""
          aria-hidden={i !== index}
          className={cn('absolute inset-0 w-full h-full object-cover transition-opacity duration-1000', i === index ? 'opacity-100' : 'opacity-0')}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-r from-[#062414]/85 via-[#062414]/45 to-transparent" />

      <div className="relative z-10 w-full flex flex-col justify-center px-5 sm:px-10 lg:px-14 pt-8 pb-24 sm:pb-20 max-w-3xl">
        <span className="self-start inline-flex items-center gap-2 h-9 px-4 rounded-full border border-white/80 bg-black/20 backdrop-blur-sm text-sm font-semibold text-white">
          <MapPin className="w-4 h-4" /> Welcome to {placeName}!
        </span>
        <h1 className="mt-4 text-[clamp(2.25rem,6vw,3.5rem)] leading-[1.05] font-extrabold text-white drop-shadow">
          Explore <span className="text-[#F4B400]" data-testid="hero-place">{placeName}</span>
        </h1>
        <p className="mt-3 text-[clamp(0.95rem,1.6vw,1.125rem)] text-white/95 max-w-xl">
          Discover local attractions, savor delicious food, and experience the beauty of {province}.
        </p>

        <form onSubmit={submit} role="search" className="mt-5 relative max-w-xl">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#56615B]" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search destinations, restaurants, or activities"
            placeholder="Search destinations, restaurants, or activities..."
            className="w-full h-14 pl-14 pr-16 rounded-full bg-white text-[15px] text-[#17201B] placeholder-[#68736D] shadow-lg focus:outline-none focus:ring-4 focus:ring-[#F4B400]/40"
          />
          <button
            type="submit"
            aria-label="Search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-[#087F3F] text-white flex items-center justify-center hover:bg-[#056B35] transition"
          >
            <Search className="w-5 h-5" />
          </button>
        </form>

        <nav aria-label="Browse by category" className="mt-5 -mx-5 px-5 sm:mx-0 sm:px-0 flex gap-2 overflow-x-auto sm:overflow-visible sm:flex-wrap pb-1 sm:pb-0 scrollbar-hide">
          {HERO_CHIPS.map((chip, i) => (
            <Link
              key={chip.label}
              to={chip.to}
              className={cn(
                'home-hero-chip shrink-0 inline-flex items-center justify-center gap-1.5 h-8 sm:h-9 px-3 sm:px-3.5 rounded-full text-xs sm:text-[13px] leading-none font-semibold whitespace-nowrap text-white border transition',
                i === 0 ? 'bg-[#087F3F] border-[#087F3F]' : 'bg-white/15 border-white/40 backdrop-blur-sm hover:bg-white/25',
              )}
            >
              <chip.icon className={cn('w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0', i === 0 && 'fill-current')} aria-hidden="true" />
              <span>{chip.label}</span>
            </Link>
          ))}
        </nav>
      </div>

      {/* Script accent */}
      <div className="hidden 2xl:block absolute right-16 top-1/2 -translate-y-[70%] -rotate-12 text-white pointer-events-none select-none" aria-hidden="true">
        <span className="block text-6xl font-extrabold italic leading-[0.95] drop-shadow-lg">Discover</span>
        <span className="block ml-10 text-6xl font-extrabold italic leading-[0.95] text-[#F4B400] drop-shadow-lg">{placeName}</span>
        <span className="block ml-16 mt-2 h-1.5 w-44 rounded-full bg-[#F4B400]" />
      </div>

      {/* Carousel controls (only when there is more than one photo) */}
      {slides.length > 1 && (
      <div className="absolute z-10 left-5 right-5 sm:left-auto sm:right-10 lg:right-14 bottom-12 flex items-center justify-between sm:justify-end gap-3 sm:gap-4">
        <span className="hidden md:inline text-xs font-semibold text-white/90">{slides[index]?.caption}</span>
        <div className="flex items-center gap-1.5" role="tablist" aria-label="Choose slide">
          {slides.map((slide, i) => (
            <button
              key={slide.src}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Show ${slide.caption}`}
              onClick={() => setIndex(i)}
              className={cn('home-hero-dot h-2.5 rounded-full transition-all', i === index ? 'w-7 bg-white' : 'w-2.5 bg-white/60 hover:bg-white')}
            />
          ))}
        </div>
        <button type="button" aria-label="Previous slide" onClick={() => go(-1)} className="home-hero-arrow w-9 h-9 sm:w-11 sm:h-11 rounded-full border-2 border-white/85 text-white flex items-center justify-center hover:bg-white/20 transition">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button type="button" aria-label="Next slide" onClick={() => go(1)} className="home-hero-arrow w-9 h-9 sm:w-11 sm:h-11 rounded-full border-2 border-white/85 text-white flex items-center justify-center hover:bg-white/20 transition">
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      )}

      {/* Wavy bottom edge */}
      <svg className="absolute bottom-0 left-0 w-full h-10 text-[#F4F8F3]" viewBox="0 0 1440 60" preserveAspectRatio="none" aria-hidden="true">
        <path fill="currentColor" d="M0,40 C240,10 480,60 720,38 C960,16 1200,52 1440,22 L1440,60 L0,60 Z" />
      </svg>
    </section>
  )
}

/* ─── Shared pieces ─────────────────────────────────────────────── */

function HomeSectionHeader({ icon: Icon, title, subtitle, viewAllTo }: {
  icon: React.ComponentType<{ className?: string }>; title: string; subtitle?: string; viewAllTo?: string
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3 mb-5">
      <div className="flex items-start gap-3">
        <span className="flex flex-col items-center pt-0.5">
          <Icon className="w-7 h-7 text-[#087F3F]" />
          <span className="mt-1 h-0.5 w-6 rounded-full bg-[#087F3F]" />
        </span>
        <div>
          <h2 className="text-[clamp(1.25rem,2.2vw,1.5rem)] font-extrabold text-[#17201B] leading-tight">{title}</h2>
          {subtitle && <p className="text-sm text-[#56615B] mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {viewAllTo && (
        <Link
          to={viewAllTo}
          aria-label={`View all ${title}`}
          className="shrink-0 inline-flex items-center gap-1 h-10 px-4 rounded-full border border-[#D3E2D6] bg-white text-sm font-semibold text-[#087F3F] hover:border-[#087F3F] transition"
        >
          View All <ChevronRight className="w-4 h-4" />
        </Link>
      )}
    </div>
  )
}

function SaveButton({ saved, onToggle, label }: { saved: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? `Remove ${label} from saved` : `Save ${label}`}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle() }}
      className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/25 backdrop-blur-sm flex items-center justify-center hover:bg-black/40 transition"
    >
      <Heart className={cn('w-5 h-5', saved ? 'fill-[#F87171] text-[#F87171]' : 'text-white')} />
    </button>
  )
}

function CardImage({ src, fallback: Fallback, className, children }: {
  src: string | null | undefined; fallback: React.ComponentType<{ className?: string }>; className?: string; children?: React.ReactNode
}) {
  const url = src ? toAssetUrl(src) : ''
  return (
    <div className={cn('relative overflow-hidden bg-[#E9F7EF]', className)}>
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
      ) : (
        <div className="w-full h-full flex items-center justify-center"><Fallback className="w-10 h-10 text-[#087F3F]/35" /></div>
      )}
      {children}
    </div>
  )
}

function RatingLine({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-sm text-[#56615B]">New on TrackTour</span>
  return (
    <span className="flex items-center gap-1 text-sm">
      <Star className="w-4 h-4 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" />
      <span className="font-semibold text-[#17201B]">{rating.toFixed(1)}</span>
      <span className="sr-only">out of 5</span>
    </span>
  )
}

function EmptyRow({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#C2DEC9] bg-white py-10 text-center">
      <Icon className="w-8 h-8 mx-auto text-[#087F3F]/40" />
      <p className="mt-2 text-sm text-[#56615B]">{text}</p>
    </div>
  )
}

/* ─── Cards ─────────────────────────────────────────────────────── */

function DestinationCard({ spot, distance, saved, onToggleSave }: { spot: TouristSpot; distance: number | null; saved: boolean; onToggleSave: () => void }) {
  const image = spot.images?.[0] ?? spot.image ?? null
  return (
    <Link to={`/tourist/destinations/${spot.id}`} className="home-card group block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/10 transition">
      <CardImage src={image} fallback={MapPin} className="h-44">
        {distance !== null && (
          <span className="absolute top-3 left-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-[#087F3F] text-white text-xs font-bold">
            <MapPin className="w-3.5 h-3.5" /> {distance < 10 ? distance.toFixed(1) : Math.round(distance)} km
          </span>
        )}
        <SaveButton saved={saved} onToggle={onToggleSave} label={spot.name} />
      </CardImage>
      <div className="p-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold text-[#17201B] truncate">{spot.name}</h3>
          <div className="mt-1"><RatingLine rating={realRating(spot.rating)} /></div>
        </div>
        <span className="shrink-0 w-9 h-9 rounded-full border border-[#D3E2D6] flex items-center justify-center text-[#17201B] group-hover:bg-[#087F3F] group-hover:border-[#087F3F] group-hover:text-white transition" aria-hidden="true">
          <ArrowRight className="w-4 h-4" />
        </span>
      </div>
    </Link>
  )
}

function HomeFoodCard({ food }: { food: FoodItem }) {
  const navigate = useNavigate()
  const [added, setAdded] = useState(false)
  const rating = realRating(food.rating)
  const canOrder = food.is_accepting_orders !== false

  useEffect(() => {
    if (!added) return
    const t = window.setTimeout(() => setAdded(false), 1600)
    return () => window.clearTimeout(t)
  }, [added])

  const add = () => {
    addToFoodCart({
      id: food.id,
      name: food.name,
      price: Number(food.price),
      image: food.image,
      business_name: food.business_name,
      business_id: food.business_id,
      business_latitude: food.business_latitude,
      business_longitude: food.business_longitude,
    })
    setAdded(true)
  }

  return (
    <article className="home-card group flex flex-col bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/10 transition">
      <button
        type="button"
        onClick={() => navigate(`/tourist/food/item/${food.id}`)}
        aria-label={`View ${food.name}`}
        className="home-card-media block text-left"
      >
        <CardImage src={food.image} fallback={UtensilsCrossed} className="h-36">
          {rating !== null && (
            <span className="absolute top-3 right-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-xs font-bold">
              <Star className="w-3.5 h-3.5 fill-[#F4B400] text-[#F4B400]" /> {rating.toFixed(1)}
            </span>
          )}
        </CardImage>
      </button>
      <div className="p-4 flex-1 flex flex-col">
        <h3 className="text-[16px] font-bold text-[#17201B] truncate">
          <Link to={`/tourist/food/item/${food.id}`} className="hover:text-[#087F3F]">{food.name}</Link>
        </h3>
        <Link to={`/tourist/food/${food.business_id}`} className="text-[13px] text-[#56615B] truncate hover:text-[#087F3F] hover:underline">
          {food.business_name}
        </Link>
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          <span className="text-lg font-extrabold text-[#087F3F]">{formatCurrency(Number(food.price))}</span>
          {canOrder && (
            <button
              type="button"
              onClick={add}
              aria-label={added ? `${food.name} added to cart` : `Add ${food.name} to cart`}
              className={cn(
                'inline-flex items-center gap-1 h-9 px-3.5 rounded-full border-2 text-sm font-bold transition',
                added ? 'bg-[#087F3F] border-[#087F3F] text-white' : 'border-[#087F3F] bg-white text-[#087F3F] hover:bg-[#087F3F] hover:text-white',
              )}
            >
              {added ? <>Added <Check className="w-4 h-4" /></> : <>Add <Plus className="w-4 h-4" /></>}
            </button>
          )}
        </div>
      </div>
    </article>
  )
}

function PlanGetawayCard({ placeName, photo }: { placeName: string; photo: string | null }) {
  return (
    <section className="plan-getaway relative min-h-[300px] sm:min-h-[260px] 2xl:min-h-0 2xl:h-full rounded-3xl overflow-hidden flex" aria-label={`Plan your ${placeName} getaway`}>
      {photo ? (
        <img src={photo} alt="" data-testid="getaway-photo" className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <PhotoPlaceholder testId="getaway-photo-empty" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#062414]/95 via-[#062414]/55 to-[#062414]/10" />
      <div className="relative w-full flex flex-col justify-end p-6 pb-10 text-white">
        <h2 className="text-[28px] leading-tight font-extrabold text-white">
          Plan Your<br /><span className="text-[#F4B400]">{placeName} Getaway</span>
        </h2>
        <p className="mt-2 text-base font-semibold text-white/95">Explore. Book. Travel.</p>
        <Link
          to="/tourist/explore"
          className="mt-5 self-start inline-flex items-center gap-2 h-11 px-5 rounded-full bg-[#F4B400] text-[#17201B] text-[15px] font-bold hover:bg-[#FFC72C] transition"
        >
          Start Exploring <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <svg className="absolute bottom-0 left-0 w-full h-8" viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0,20 C80,0 180,30 300,8 L300,30 L0,30 Z" fill="#087F3F" />
        <path d="M0,24 C90,8 190,32 300,14" fill="none" stroke="#F4B400" strokeWidth="3" />
      </svg>
    </section>
  )
}

function StayCard({ stay, saved, onToggleSave }: { stay: ExploreBusiness; saved: boolean; onToggleSave: () => void }) {
  return (
    <Link to={`/tourist/explore/${stay.id}`} className="home-card group block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/10 transition">
      <CardImage src={stay.cover_photo} fallback={Building2} className="h-44">
        <SaveButton saved={saved} onToggle={onToggleSave} label={stay.name} />
      </CardImage>
      <div className="p-4">
        <h3 className="text-[16px] font-bold text-[#17201B] truncate">{stay.name}</h3>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-sm text-[#56615B] truncate"><MapPin className="w-3.5 h-3.5 shrink-0" /> {stay.municipality || 'Bansud'}</span>
          <RatingLine rating={realRating(stay.rating)} />
        </div>
      </div>
    </Link>
  )
}

function RecentPlaceCard({ place }: { place: BrowsedPlace }) {
  const groupLabel =
    isBrowsedDish(place) ? 'Food'
    : place.discoveryGroup === 'dining' ? 'Dining'
      : place.discoveryGroup === 'accommodation' ? 'Stay'
        : place.discoveryGroup === 'spot' ? 'Spot'
          : 'Place'
  return (
    <Link
      // Dish → dish page; restaurant → restaurant page (see browsedPlaceLink).
      to={browsedPlaceLink(place)}
      className="home-card group flex-shrink-0 w-[min(15rem,75vw)] bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/10 transition"
    >
      <CardImage src={place.cover_photo || place.logo} fallback={Compass} className="h-32">
        <span className="absolute top-3 left-3 inline-flex items-center h-6 px-2.5 rounded-full bg-[#087F3F] text-white text-[11px] font-bold">{groupLabel}</span>
      </CardImage>
      <div className="p-3.5">
        <h3 className="text-sm font-bold text-[#17201B] truncate">{place.name}</h3>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-xs text-[#56615B] truncate"><MapPin className="w-3 h-3 shrink-0" /> {safeText(place.municipality) || 'Bansud'}</span>
          {realRating(place.rating) !== null && (
            <span className="flex items-center gap-0.5 text-xs font-semibold text-[#17201B]"><Star className="w-3 h-3 fill-[#F4B400] text-[#F4B400]" />{realRating(place.rating)!.toFixed(1)}</span>
          )}
        </div>
      </div>
    </Link>
  )
}

function ForYouCard({ item }: { item: ForYouItem }) {
  const isFood = item.kind === 'food'
  return (
    <Link to={item.url} className="home-card group block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/10 transition">
      <CardImage src={item.image} fallback={isFood ? Utensils : BedDouble} className="h-40">
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-[#087F3F] text-white text-xs font-bold">
          {isFood ? <UtensilsCrossed className="w-3.5 h-3.5" /> : <BedDouble className="w-3.5 h-3.5" />} {categoryName(item.category) || (isFood ? 'Food' : 'Stay')}
        </span>
        {item.distance_km != null && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/95 text-[#17201B] text-xs font-bold">
            <Navigation className="w-3.5 h-3.5 text-[#087F3F]" /> {item.distance_km} km
          </span>
        )}
      </CardImage>
      <div className="p-4">
        <h3 className="text-[16px] font-bold text-[#17201B] truncate">{item.name}</h3>
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="flex items-center gap-1 text-sm text-[#56615B] truncate"><MapPin className="w-3.5 h-3.5 shrink-0" /> {safeText(item.subtitle) || 'Bansud'}</span>
          {isFood && item.price != null && <span className="text-base font-extrabold text-[#087F3F]">{formatCurrency(item.price)}</span>}
        </div>
      </div>
    </Link>
  )
}

function EventCard({ event }: { event: TouristEvent }) {
  const dateObj = event.event_date ? new Date(event.event_date) : null
  const validDate = dateObj && !Number.isNaN(dateObj.getTime()) ? dateObj : null
  return (
    <Link to={`/tourist/events/${event.id}`} className="home-card group block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/10 transition">
      <CardImage src={event.image} fallback={Calendar} className="h-40">
        {validDate && (
          <span className="absolute top-3 left-3 flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-[#087F3F] text-white shadow">
            <span className="text-[10px] font-bold uppercase">{validDate.toLocaleDateString('en-US', { month: 'short' })}</span>
            <span className="text-lg font-extrabold leading-none">{validDate.getDate()}</span>
          </span>
        )}
      </CardImage>
      <div className="p-4">
        <h3 className="text-[16px] font-bold text-[#17201B] truncate">{event.name}</h3>
        <div className="mt-1 flex items-center justify-between gap-2 text-sm text-[#56615B]">
          <span className="flex items-center gap-1 truncate"><MapPin className="w-3.5 h-3.5 shrink-0" /> {safeText(event.municipality) || 'Bansud'}</span>
          {event.start_time && <span className="shrink-0">{event.start_time}</span>}
        </div>
      </div>
    </Link>
  )
}
