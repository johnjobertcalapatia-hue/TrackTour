import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { categoryName, formatCurrency, safeText, toAssetUrl } from '@/shared/utils'
import { Star, MapPin, ArrowLeft, Compass } from 'lucide-react'

interface BizCategory {
  id: number
  name: string
}

interface MunicipalityInfo {
  id: number
  name: string
  district?: string
  province?: string
  latitude?: string | number
  longitude?: string | number
}

interface Biz {
  id: number
  business_name?: string
  name?: string
  cover_photo?: string | null
  address?: string
  average_rating?: number
  review_count?: number
  is_open?: boolean
  price_range?: string | null
  category?: BizCategory | null
  municipality?: { id: number; name: string } | null
}

interface Dest {
  id: number
  name: string
  address?: string
  entrance_fee?: number
  images?: string[]
  rating?: number | null
  category?: { id: number; name: string; slug: string } | null
  municipality?: { id: number; name: string } | null
}

interface MunicipalityResponse {
  municipality: MunicipalityInfo
  businesses: {
    data?: Biz[]
    total?: number
  }
}

const RESTAURANT_CATEGORIES = ['restaurant', 'café', 'cafe', 'food hub', 'hotel & restaurant combination']
const RESORT_CATEGORIES = ['resort', 'hotel', 'homestay', 'camping site', 'farm tourism']
const EMOJI_FOOD = '🍴'
const EMOJI_STAY = '🏨'
const EMOJI_PLACE = '📍'
const EMOJI_BUSINESS = '🏪'

interface CardItem {
  key: string
  id: number
  name: string
  cover: string | null
  rating: number | null
  location: string
  category: string
  emoji: string
  price?: number
  onOpen: () => void
}

function Card({ item }: { item: CardItem }) {
  return (
    <div
      onClick={item.onOpen}
      className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden cursor-pointer hover:border-[#087F3F]/40 hover:shadow-md transition-all group"
    >
      <div className="aspect-[4/3] bg-[#E9F7EF] overflow-hidden relative">
        {item.cover ? (
          <img
            src={item.cover}
            alt={item.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-4xl">{item.emoji}</span>
          </div>
        )}
        {item.rating != null && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 backdrop-blur-md text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
            <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" /> {item.rating.toFixed(1)}
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-[11px] font-semibold text-[#087F3F]">{item.category}</p>
        <h3 className="mt-0.5 text-sm font-semibold text-[#17201B] truncate group-hover:text-[#087F3F] transition">
          {item.name}
        </h3>
        <div className="flex items-center gap-1 mt-0.5 text-[11px] text-[#68736D]">
          <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{item.location}</span>
        </div>
        {item.price != null && item.price > 0 && (
          <p className="text-[11px] font-bold text-[#087F3F] mt-1">Entrance {formatCurrency(item.price)}</p>
        )}
      </div>
    </div>
  )
}

export default function LandingMunicipalityPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery<MunicipalityResponse>({
    queryKey: ['landing-municipality', id],
    queryFn: () => get(`/tourist/explore/municipality/${id}`),
    enabled: !!id,
  })

  const { data: destData, isLoading: loadingDestinations } = useQuery<{ data: Dest[] }>({
    queryKey: ['landing-municipality-destinations', id],
    queryFn: () => get('/tourist/destinations', { params: { municipality: id } }),
    enabled: !!id,
  })

  const municipality = data?.municipality
  const businesses = data?.businesses?.data ?? []
  const destinations = (destData?.data ?? []).filter((d) => d.id && d.name)

  const categoryOf = (b: Biz) => categoryName(b.category).toLowerCase()
  const restaurants = businesses.filter((b) => RESTAURANT_CATEGORIES.includes(categoryOf(b)))
  const resorts = businesses.filter(
    (b) => !RESTAURANT_CATEGORIES.includes(categoryOf(b)) && RESORT_CATEGORIES.includes(categoryOf(b))
  )
  const others = businesses.filter(
    (b) => !RESTAURANT_CATEGORIES.includes(categoryOf(b)) && !RESORT_CATEGORIES.includes(categoryOf(b))
  )

  const businessCover = (b: Biz) => (b.cover_photo ? toAssetUrl(b.cover_photo) : null)
  const businessLocation = (b: Biz) => b.address || safeText(b.municipality) || 'Oriental Mindoro'
  const businessCategory = (b: Biz) => categoryName(b.category) || 'Place'
  const businessRank = (b: Biz) => (b.average_rating ?? 0) > 0 ? Number(b.average_rating) : null

  const openBiz = (b: Biz) =>
    navigate(
      RESTAURANT_CATEGORIES.includes(categoryOf(b)) ? `/explore/food/${b.id}` : `/tourist/explore/${b.id}`
    )

  const toRestaurantCards = (list: Biz[], emoji: string): CardItem[] =>
    list.map((b) => ({
      key: `biz-${emoji}-${b.id}`,
      id: b.id,
      name: b.business_name ?? b.name ?? '',
      cover: businessCover(b),
      rating: businessRank(b),
      location: businessLocation(b),
      category: businessCategory(b),
      emoji,
      onOpen: () => openBiz(b),
    }))

  const placeCards: CardItem[] = destinations.map((d) => ({
    key: `place-${d.id}`,
    id: d.id,
    name: d.name,
    cover: d.images?.[0] ? toAssetUrl(d.images[0]) : null,
    rating: d.rating ? Number(d.rating) : null,
    location: d.municipality?.name || d.address || 'Oriental Mindoro',
    category: categoryName(d.category) || 'Tourist Spot',
    emoji: EMOJI_PLACE,
    price: d.entrance_fee,
    onOpen: () => navigate(`/tourist/destinations/${d.id}`),
  }))

  const sections: { key: string; title: string; items: CardItem[] }[] = [
    { key: 'restaurants', title: 'Restaurants', items: toRestaurantCards(restaurants, EMOJI_FOOD) },
    { key: 'resorts', title: 'Resorts & Stays', items: toRestaurantCards(resorts, EMOJI_STAY) },
    { key: 'places', title: 'Tourist Spots', items: placeCards },
  ]

  const finalSections = others.length > 0
    ? [...sections, { key: 'others', title: 'More Places & Services', items: toRestaurantCards(others, EMOJI_BUSINESS) }]
    : sections

  return (
    <div className="min-h-screen tourism-bg tourism-bg-orbs text-[#17201A]">
      <nav className="flex items-center justify-between px-6 py-2 max-w-7xl mx-auto tourism-nav">
        <Link to="/" className="flex items-center gap-3">
          <ApplicationLogo className="w-12 h-12" />
          <span className="text-xl font-bold text-[#16803C]">TrackTour</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm text-[#16803C] hover:text-[#126B32] transition-colors">
            Sign In
          </Link>
          <Link to="/role-selection" className="btn-tourism px-4 py-1.5 text-sm font-medium">
            Get Started
          </Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-[10px] py-8">
        <Link
          to="/"
          onClick={() => sessionStorage.setItem('tracktour_scroll_to_content', '1')}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#087F3F] hover:text-[#056B35] transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !municipality ? (
          <div className="text-center py-20">
            <Compass className="w-14 h-14 text-[#9AB5A6] mx-auto mb-4" />
            <h2 className="text-xl font-bold text-[#17201A] mb-2">Municipality not found</h2>
            <p className="text-[#68736D] text-sm">The municipality you're looking for doesn't exist.</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A] mb-8">
              {municipality.name}
              {municipality.district ? (
                <span className="block mt-1 text-sm font-medium text-[#68736D]">
                  {municipality.district} District, {municipality.province || 'Oriental Mindoro'}
                </span>
              ) : null}
            </h1>

            <div className="space-y-10">
              {finalSections.map((section) => (
                <section key={section.key}>
                  <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-lg lg:text-xl font-bold text-[#087F3F]">{section.title}</h2>
                    <span className="inline-flex items-center gap-1 bg-white border border-[#E2E8E3] text-[#17201A] text-xs font-semibold px-2.5 py-1 rounded-full">
                      {section.items.length}
                    </span>
                  </div>
                  {loadingDestinations && section.key === 'places' ? (
                    <div className="flex items-center justify-center py-12">
                      <div className="w-5 h-5 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
                    </div>
                  ) : section.items.length === 0 ? (
                    <div className="py-10 text-center bg-white border border-[#E5E9E7] rounded-2xl">
                      <Compass className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" />
                      <p className="text-[#68736D] text-sm">Nothing listed here yet.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                      {section.items.map((item) => (
                        <Card key={item.key} item={item} />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </>
        )}
      </div>

      <footer className="border-t border-ink/5 py-8 text-center text-sm text-ink-soft mt-8">
        &copy; {new Date().getFullYear()} <span className="text-[#16803C] font-semibold">TrackTour</span> — Bansud Tourism Office. All rights reserved.
      </footer>
    </div>
  )
}