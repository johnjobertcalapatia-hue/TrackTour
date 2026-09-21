import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { categoryName, formatCurrency, safeText, toAssetUrl } from '@/shared/utils'
import {
  MapPin,
  Star,
  ArrowLeft,
  UtensilsCrossed,
  Hotel,
  Mountain,
  Store,
  Compass,
  Navigation,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

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
  description?: string
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
    current_page?: number
    last_page?: number
    per_page?: number
  }
}

const RESTAURANT_CATEGORIES = ['restaurant', 'café', 'cafe', 'food hub', 'hotel & restaurant combination']
const RESORT_CATEGORIES = ['resort', 'hotel', 'homestay', 'camping site', 'farm tourism']
const PLACEHOLDER_COLORS = [
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-blue-500 to-indigo-600',
  'from-orange-500 to-red-600',
  'from-pink-500 to-rose-600',
  'from-amber-500 to-yellow-600',
]

function Section({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string
  icon: LucideIcon
  count: number
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="flex items-center gap-2 text-xl lg:text-2xl font-bold text-[#17201B]">
          <Icon className="w-6 h-6 text-[#087F3F]" />
          {title}
          <span className="px-2 py-0.5 rounded-full bg-[#E9F7EF] text-[#087F3F] text-xs font-semibold">{count}</span>
        </h2>
      </div>
      {count > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">{children}</div>
      ) : (
        <div className="flex items-center justify-center gap-2 py-10 bg-white border border-dashed border-[#D6DFDA] rounded-2xl text-sm text-[#68736D]">
          <Compass className="w-5 h-5 text-[#9AB5A6]" />
          Nothing listed here yet.
        </div>
      )}
    </section>
  )
}

function BusinessCard({ biz }: { biz: Biz }) {
  const img = biz.cover_photo ? toAssetUrl(biz.cover_photo) : ''
  const name = biz.business_name ?? biz.name ?? ''
  return (
    <Link
      to={`/tourist/explore/${biz.id}`}
      className="group bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden hover:shadow-lg hover:border-[#087F3F]/40 hover:-translate-y-0.5 transition-all flex flex-col"
    >
      <div className="relative h-40 bg-[#DCE6E0] overflow-hidden">
        {img ? (
          <img
            src={img}
            alt={name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#0c2a17] to-[#087F3F] flex items-center justify-center">
            <UtensilsCrossed className="w-9 h-9 text-white/40" />
          </div>
        )}
        {typeof biz.is_open === 'boolean' && (
          <span
            className={`absolute top-3 left-3 px-2.5 py-1 rounded-full text-[11px] font-semibold text-white ${
              biz.is_open ? 'bg-[#087F3F]' : 'bg-[#DC2626]'
            }`}
          >
            {biz.is_open ? 'Open' : 'Closed'}
          </span>
        )}
        {(biz.average_rating ?? 0) > 0 && (
          <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 backdrop-blur-sm text-[11px] font-semibold text-[#17201B]">
            <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" />
            {Number(biz.average_rating).toFixed(1)}
            {biz.review_count ? <span className="text-[#68736D] font-normal">({biz.review_count})</span> : null}
          </span>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1">
        {categoryName(biz.category) && (
          <p className="text-xs font-semibold text-[#087F3F]">{categoryName(biz.category)}</p>
        )}
        <h3 className="mt-1 text-base font-bold text-[#17201B] leading-snug line-clamp-2 group-hover:text-[#087F3F] transition-colors">
          {name}
        </h3>
        <p className="mt-2 flex items-center gap-1 text-sm text-[#68736D]">
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{biz.address || safeText(biz.municipality) || 'Oriental Mindoro'}</span>
        </p>
        <span className="mt-4 flex-1 flex items-center justify-center py-2 bg-[#E9F7EF] text-[#087F3F] rounded-xl text-sm font-medium border border-[#087F3F]/15 transition-colors group-hover:bg-[#087F3F] group-hover:text-white">
          View Place
        </span>
      </div>
    </Link>
  )
}

function DestinationCard({ dest, index }: { dest: Dest; index: number }) {
  return (
    <Link
      to={`/tourist/destinations/${dest.id}`}
      className="group bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden hover:shadow-lg hover:border-[#087F3F]/40 hover:-translate-y-0.5 transition-all flex flex-col"
    >
      <div className="relative h-40 bg-[#DCE6E0] overflow-hidden">
        {dest.images?.[0] ? (
          <img
            src={dest.images[0]}
            alt={dest.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div
            className={`w-full h-full bg-gradient-to-br ${PLACEHOLDER_COLORS[index % PLACEHOLDER_COLORS.length]} flex items-center justify-center`}
          >
            <Mountain className="w-9 h-9 text-white/40" />
          </div>
        )}
        {dest.rating ? (
          <span className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 rounded-full bg-white/90 backdrop-blur-sm text-[11px] font-semibold text-[#17201B]">
            <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" />
            {Number(dest.rating).toFixed(1)}
          </span>
        ) : null}
        {dest.entrance_fee ? (
          <span className="absolute bottom-3 left-3 px-2 py-1 rounded-full bg-white/90 backdrop-blur-sm text-[11px] font-semibold text-[#087F3F]">
            Entrance {formatCurrency(dest.entrance_fee)}
          </span>
        ) : null}
      </div>
      <div className="p-4 flex flex-col flex-1">
        {categoryName(dest.category) && (
          <p className="text-xs font-semibold text-[#087F3F]">{categoryName(dest.category)}</p>
        )}
        <h3 className="mt-1 text-base font-bold text-[#17201B] leading-snug line-clamp-2 group-hover:text-[#087F3F] transition-colors">
          {dest.name}
        </h3>
        <p className="mt-2 flex items-center gap-1 text-sm text-[#68736D]">
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{dest.municipality?.name || dest.address || 'Oriental Mindoro'}</span>
        </p>
        <span className="mt-4 flex-1 flex items-center justify-center py-2 bg-[#E9F7EF] text-[#087F3F] rounded-xl text-sm font-medium border border-[#087F3F]/15 transition-colors group-hover:bg-[#087F3F] group-hover:text-white">
          View Spot
        </span>
      </div>
    </Link>
  )
}

export default function TouristMunicipality() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data, isLoading, isError } = useQuery<MunicipalityResponse>({
    queryKey: ['tourist', 'municipality', id],
    queryFn: () => get(`/tourist/explore/municipality/${id}`),
    enabled: !!id,
  })

  const { data: destData, isLoading: loadingDestinations } = useQuery<{ data: Dest[] }>({
    queryKey: ['tourist', 'municipality-destinations', id],
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

  const mapQuery = municipality
    ? municipality.latitude && municipality.longitude
      ? `${municipality.latitude},${municipality.longitude}`
      : municipality.name
    : ''

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7FAF7] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="mt-4 text-sm text-[#68736D]">Loading municipality...</p>
        </div>
      </div>
    )
  }

  if (isError || !municipality) {
    return (
      <div className="min-h-screen bg-[#F7FAF7] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <Compass className="w-14 h-14 text-[#9AB5A6] mx-auto mb-4" />
          <h2 className="text-xl font-bold text-[#17201B] mb-2">Municipality not found</h2>
          <p className="text-[#68736D] mb-6">The municipality you're looking for doesn't exist.</p>
          <Link
            to="/explore/categories"
            className="inline-flex items-center gap-2 px-6 py-3 bg-[#087F3F] text-white rounded-xl hover:bg-[#056B35] transition-colors font-medium text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Explore
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F7FAF7]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <button
          onClick={() => navigate(-1)}
          className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-[#68736D] hover:text-[#087F3F] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#0c2a17] via-[#096b35] to-[#087F3F] text-white p-6 lg:p-10 mb-8">
          <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
          <div className="absolute -bottom-16 -left-8 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <div className="flex items-center gap-2 text-[#BDE3CB] text-sm mb-3">
              <Sparkles className="w-4 h-4" />
              Explore the places in
            </div>
            <h1 className="text-3xl lg:text-4xl font-bold">{municipality.name}</h1>
            <p className="mt-2 text-white/85 max-w-2xl">
              {municipality.district ? `${municipality.district} District, ` : ''}
              {municipality.province || 'Oriental Mindoro'}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <span className="px-3 py-1.5 rounded-full bg-white/15 backdrop-blur text-sm font-medium">
                {businesses.length} places
              </span>
              <span className="px-3 py-1.5 rounded-full bg-white/15 backdrop-blur text-sm font-medium">
                {destinations.length} tourist spots
              </span>
              {mapQuery && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white text-[#087F3F] font-semibold text-sm hover:bg-[#EAF6ED] transition-colors"
                >
                  <Navigation className="w-4 h-4" />
                  View on Map
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-10 pb-6">
          <Section title="Restaurants" icon={UtensilsCrossed} count={restaurants.length}>
            {restaurants.map((biz) => (
              <BusinessCard key={biz.id} biz={biz} />
            ))}
          </Section>

          <Section title="Resorts & Stays" icon={Hotel} count={resorts.length}>
            {resorts.map((biz) => (
              <BusinessCard key={biz.id} biz={biz} />
            ))}
          </Section>

          <Section title="Tourist Spots" icon={Mountain} count={destinations.length}>
            {loadingDestinations
              ? null
              : destinations.map((dest, i) => <DestinationCard key={dest.id} dest={dest} index={i} />)}
          </Section>

          {others.length > 0 && (
            <Section title="More Places & Services" icon={Store} count={others.length}>
              {others.map((biz) => (
                <BusinessCard key={biz.id} biz={biz} />
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}