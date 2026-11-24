import { useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Camera, CheckCircle2, Clock, Compass, Heart, LogIn, Mail, MapPin, Navigation, Phone, Share2, Star, Ticket, Video, X } from 'lucide-react'
import { get } from '@/shared/services/api'
import { categoryName, formatDateTime, toAssetUrl } from '@/shared/utils'
import { getDiscoveryGroup } from '@/shared/utils/category'
import ResortDetail, { type ResortBusiness, type ResortInfo, type ResortReview } from '@/features/tourist/components/resort/ResortDetail'
import LandingShell from './components/LandingShell'
import { canRouteTo, trackTourDirectionsPath } from '@/features/tourist/map-directions'

interface MediaItem { id: number; type: string; file_path: string; title?: string | null; caption?: string | null }
interface Review { id: number; user_name: string; rating: number; comment: string; created_at: string }

interface PlaceDetail {
  business: {
    id: number
    name?: string
    business_name?: string
    description?: string
    business_description?: string
    category: unknown
    business_category_id?: number
    municipality: { name: string } | null
    barangay: { name: string } | null
    address?: string
    latitude: number | null
    longitude: number | null
    phone?: string
    contact_number?: string
    email?: string
    logo: string | null
    cover_photo: string | null
    opening_time: string | null
    closing_time: string | null
    price_range?: string | null
    category_details?: Record<string, any>
    details?: { field_name: string; field_value: string }[] | Record<string, any>
    media?: MediaItem[]
  }
  reviews?: Review[]
  avgRating?: number
  reviewsCount?: number
  gallery?: MediaItem[]
  resort?: ResortInfo | null
}

/** Guest favourites, shared with the public restaurant page (no account needed). */
const FAVORITES_KEY = 'tracktour_landing_favorites'
const readFavorites = (): number[] => { try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]') } catch { return [] } }

const isVideo = (m: MediaItem) => m.file_path.endsWith('.mp4') || m.file_path.endsWith('.mov') || m.type === 'Promotional Video'

/**
 * Public page for a tourist attraction, resort or other non-food business
 * (/explore/place/:id, 2026-11-24). The landing page's cards used to send
 * guests into the tourist portal (/tourist/explore/:id) with its "Guest · Sign
 * in" sidebar; this keeps them on the public site, like restaurants
 * (/explore/food/:id). Saving, reviewing and booking ask the guest to sign in.
 */
export default function LandingPlacePage() {
  const { id } = useParams<{ id: string }>()
  const [favorites, setFavorites] = useState<number[]>(readFavorites)
  const [photo, setPhoto] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['landing-place', id],
    queryFn: () => get<PlaceDetail>(`/tourist/explore/${id}`),
    enabled: !!id,
    retry: false,
  })

  const business = data?.business
  const media = useMemo(() => {
    const list: MediaItem[] = [...(data?.gallery ?? [])]
    for (const m of business?.media ?? []) if (!list.some((x) => x.file_path === m.file_path)) list.push(m)
    return list.filter((m) => m.file_path)
  }, [data?.gallery, business?.media])

  const isFavorited = !!id && favorites.includes(Number(id))
  const toggleFavorite = () => {
    const bizId = Number(id)
    const next = isFavorited ? favorites.filter((f) => f !== bizId) : [...favorites, bizId]
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next))
    setFavorites(next)
  }
  const share = async () => {
    const url = window.location.href
    try {
      if (typeof navigator.share === 'function') await navigator.share({ title: business?.name ?? 'TrackTour', url })
      else { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 2000) }
    } catch { /* closed */ }
  }

  const back = { to: '/explore', label: 'Back to Explore' }
  if (isLoading) {
    return (
      <LandingShell back={back}>
        <div className="flex items-center justify-center py-20"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#0B5D2E] border-t-transparent" /></div>
      </LandingShell>
    )
  }
  if (!business) {
    return (
      <LandingShell back={back}>
        <div className="py-16 text-center">
          <Compass className="mx-auto mb-4 h-12 w-12 text-[#9CA3AF]" aria-hidden="true" />
          <p className="text-[#68736D]">This place isn&apos;t on TrackTour anymore.</p>
          <Link to="/explore" className="mt-4 inline-flex rounded-full bg-[#0B5D2E] px-5 py-2.5 text-sm font-semibold text-white">Explore places</Link>
        </div>
      </LandingShell>
    )
  }

  const catLabel = categoryName(business.category)
  const group = getDiscoveryGroup(catLabel, business.business_category_id)
  // Restaurants have their own public page with the menu.
  if (group === 'dining') return <Navigate to={`/explore/food/${business.id}`} replace />

  const photos = media.filter((m) => !isVideo(m))
  const videos = media.filter(isVideo)

  // Resorts: the same data-driven resort page the portal shows.
  if (data?.resort) {
    return (
      <LandingShell back={back}>
        <ResortDetail
          business={business as unknown as ResortBusiness}
          resort={data.resort}
          photos={photos.map((m) => m.file_path)}
          reviews={(data.reviews ?? []) as unknown as ResortReview[]}
          avgRating={data.avgRating ?? null}
          reviewsCount={data.reviewsCount ?? 0}
          isFavorited={isFavorited}
          onToggleFavorite={toggleFavorite}
          onShare={() => void share()}
        />
      </LandingShell>
    )
  }

  const isSpot = group === 'spot'
  const isStay = group === 'accommodation'
  const name = business.name || business.business_name || 'Place'
  const cover = toAssetUrl(business.cover_photo)
  const logo = toAssetUrl(business.logo)
  const description = business.description || business.business_description || ''
  const phone = business.phone || business.contact_number || ''
  const reviews = data?.reviews ?? []
  const rating = data?.avgRating ?? 0
  const reviewsCount = data?.reviewsCount ?? reviews.length
  const where = [business.barangay?.name, business.municipality?.name].filter(Boolean).join(', ') || 'Oriental Mindoro'
  const details: Record<string, any> = business.category_details
    ?? (Array.isArray(business.details) ? Object.fromEntries(business.details.map((d) => [d.field_name, d.field_value])) : (business.details ?? {}))
  // Directions open the TrackTour map with the route drawn (not Google Maps); the map is public.
  const directionsPath = canRouteTo(business) ? trackTourDirectionsPath(business.id) : null
  const signIn = { pathname: '/login' }
  const signInState = { from: `/tourist/explore/${business.id}` }
  const cardClass = 'rounded-3xl bg-white p-6 shadow-[0_12px_28px_rgba(6,40,20,0.08)] ring-1 ring-[#E7E2D6]'

  return (
    <LandingShell back={back}>
      {/* Cover */}
      <div className="relative h-56 overflow-hidden rounded-3xl bg-[#E9F7EF] shadow-[0_14px_30px_rgba(6,40,20,0.16)] sm:h-80">
        {cover ? <img src={cover} alt={name} className="h-full w-full object-cover" /> : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#0B5D2E] to-[#2E8B57]"><Compass className="h-16 w-16 text-white/40" aria-hidden="true" /></div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <div className="absolute right-4 top-4 flex gap-2">
          <button type="button" onClick={() => void share()} aria-label="Share" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/60 bg-white/85 text-[#17201A] backdrop-blur-md transition hover:scale-105">
            <Share2 className="h-5 w-5" aria-hidden="true" />
          </button>
          <button type="button" onClick={toggleFavorite} aria-pressed={isFavorited} aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
            className={`flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition hover:scale-105 ${isFavorited ? 'border-[#DC2626] bg-[#DC2626] text-white' : 'border-white/60 bg-white/85 text-[#17201A]'}`}>
            <Heart className={`h-5 w-5 ${isFavorited ? 'fill-current' : ''}`} aria-hidden="true" />
          </button>
        </div>
        {copied && <span role="status" className="absolute left-4 top-4 rounded-full bg-white px-3 py-1 text-xs font-semibold text-[#0B5D2E]">Link copied</span>}
      </div>

      {/* Logo, name, type, place, rating */}
      <div className="relative z-10 -mt-10 flex">
        <div className="mx-4 flex flex-1 items-center gap-4 rounded-3xl bg-white px-5 py-4 shadow-[0_12px_28px_rgba(6,40,20,0.12)] ring-1 ring-[#E7E2D6]">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-[#E2E8E3] bg-white shadow">
            {logo ? <img src={logo} alt="" className="h-full w-full object-cover" /> : <Compass className="h-9 w-9 text-[#2F9E62]" aria-hidden="true" />}
          </div>
          <div className="min-w-0">
            <span className="inline-block rounded-full bg-[#E6F6EC] px-2.5 py-0.5 text-xs font-semibold text-[#0B5D2E]">{isSpot ? 'Tourist Spot' : isStay ? 'Accommodation' : catLabel || 'Business'}</span>
            <h1 className="mt-1 text-2xl font-bold text-[#17201A]">{name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#68736D]">
              <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" /> {where}</span>
              <span className="flex items-center gap-1 font-semibold text-[#17201A]">
                <Star className="h-4 w-4 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" /> {rating > 0 ? Number(rating).toFixed(1) : 'New'}
                <span className="font-normal text-[#68736D]">({reviewsCount} review{reviewsCount === 1 ? '' : 's'})</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className={cardClass} aria-labelledby="about-heading">
            <h2 id="about-heading" className="mb-3 text-lg font-bold text-[#17201A]">{isSpot ? 'About & History' : 'About'}</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-[#4B5563]">{description || `Discover ${name} in ${where}.`}</p>
            {isSpot && details.attraction_type && (
              <p className="mt-4 flex items-center gap-2 border-t border-[#EFF3F0] pt-4 text-xs">
                <span className="font-semibold text-[#68736D]">Type of attraction:</span>
                <span className="rounded-full bg-[#E6F6EC] px-2.5 py-1 font-medium text-[#0B5D2E]">{details.attraction_type}</span>
              </p>
            )}
          </section>

          {isSpot && (details.activities || details.estimated_visit_duration || details.guided_tour_available) && (
            <section className={cardClass} aria-labelledby="activities-heading">
              <h2 id="activities-heading" className="mb-3 text-lg font-bold text-[#17201A]">Activities &amp; Highlights</h2>
              {details.activities && <p className="text-sm leading-relaxed text-[#4B5563]">{details.activities}</p>}
              <div className="mt-4 flex flex-wrap gap-3 text-xs">
                {details.estimated_visit_duration && <span className="flex items-center gap-1.5 rounded-xl border border-[#E5E9E7] bg-[#F8FAF9] px-3 py-1.5"><Clock className="h-4 w-4 text-[#0B5D2E]" aria-hidden="true" /> Est. visit: <strong>{details.estimated_visit_duration}</strong></span>}
                {details.guided_tour_available && <span className="flex items-center gap-1.5 rounded-xl bg-[#E6F6EC] px-3 py-1.5 font-semibold text-[#0B5D2E]"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Guided tours available</span>}
              </div>
            </section>
          )}

          {photos.length > 0 && (
            <section className={cardClass} aria-labelledby="photos-heading">
              <h2 id="photos-heading" className="mb-4 flex items-center gap-2 text-lg font-bold text-[#17201A]"><Camera className="h-5 w-5 text-[#0B5D2E]" aria-hidden="true" /> Photos</h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {photos.map((m) => (
                  <button key={m.id} type="button" onClick={() => setPhoto(m.file_path)} className="relative aspect-[4/3] overflow-hidden rounded-xl border border-[#E5E9E7] bg-gray-100">
                    <img src={toAssetUrl(m.file_path)} alt={m.caption || m.title || `${name} photo`} className="h-full w-full object-cover transition duration-300 hover:scale-105" loading="lazy" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {videos.length > 0 && (
            <section className={cardClass} aria-labelledby="videos-heading">
              <h2 id="videos-heading" className="mb-4 flex items-center gap-2 text-lg font-bold text-[#17201A]"><Video className="h-5 w-5 text-[#0B5D2E]" aria-hidden="true" /> Videos</h2>
              <div className="space-y-4">
                {videos.map((v) => <video key={v.id} src={toAssetUrl(v.file_path)} controls preload="metadata" className="max-h-80 w-full rounded-xl bg-black" />)}
              </div>
            </section>
          )}

          <section className={cardClass} aria-labelledby="reviews-heading">
            <h2 id="reviews-heading" className="mb-4 text-lg font-bold text-[#17201A]">Visitor Reviews</h2>
            {reviews.length > 0 ? (
              <ul className="space-y-3">
                {reviews.map((r) => (
                  <li key={r.id} className="rounded-xl border border-[#E5E9E7] bg-[#F8FAF9] p-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="text-sm font-semibold text-[#17201A]">{r.user_name}</span>
                      <span className="flex items-center gap-1 text-xs text-amber-500"><Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> {r.rating}</span>
                    </div>
                    <p className="text-sm leading-relaxed text-[#4B5563]">{r.comment}</p>
                    <p className="mt-2 text-[11px] text-[#9CA3AF]">{formatDateTime(r.created_at)}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="py-4 text-center text-sm text-[#68736D]">No visitor reviews yet.</p>}
          </section>
        </div>

        <aside className="space-y-5" aria-label={isSpot ? 'Visitor information' : 'Information'}>
          <section className={`${cardClass} space-y-4`}>
            <h2 className="border-b border-[#EFF3F0] pb-3 text-base font-bold text-[#17201A]">{isSpot ? 'Visitor Information' : isStay ? 'Property Details' : 'Business Information'}</h2>
            {isSpot && details.entrance_fee && (
              <div className="flex items-center gap-3 rounded-xl bg-[#E6F6EC] p-3 text-sm">
                <Ticket className="h-5 w-5 shrink-0 text-[#0B5D2E]" aria-hidden="true" />
                <div><p className="text-xs font-semibold text-[#0B5D2E]">Entrance fee</p><p className="font-bold text-[#17201A]">{details.entrance_fee}</p></div>
              </div>
            )}
            {business.price_range && !isSpot && <p className="text-sm text-[#4B5563]"><span className="font-semibold text-[#17201A]">Price range:</span> {business.price_range}</p>}
            {business.opening_time && business.closing_time && (
              <div className="flex items-start gap-2.5 text-sm">
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-[#0B5D2E]" aria-hidden="true" />
                <div><p className="font-medium text-[#17201A]">{isSpot ? 'Visiting hours' : 'Hours'}</p><p className="mt-0.5 text-xs text-[#68736D]">{business.opening_time} – {business.closing_time}</p></div>
              </div>
            )}
            <div className="flex items-start gap-2.5 text-sm">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[#0B5D2E]" aria-hidden="true" />
              <div><p className="font-medium text-[#17201A]">Location</p><p className="mt-0.5 text-xs text-[#68736D]">{business.address || where}</p></div>
            </div>
            {phone && <p className="flex items-center gap-2.5 text-xs font-medium text-[#4B5563]"><Phone className="h-4 w-4 shrink-0 text-[#0B5D2E]" aria-hidden="true" /> {phone}</p>}
            {business.email && <p className="flex items-center gap-2.5 text-xs font-medium text-[#4B5563]"><Mail className="h-4 w-4 shrink-0 text-[#0B5D2E]" aria-hidden="true" /> <span className="truncate">{business.email}</span></p>}
            {directionsPath ? (
              <Link to={directionsPath} className="flex w-full items-center justify-center gap-2 rounded-full bg-[#0B5D2E] py-3 text-sm font-semibold text-white transition hover:bg-[#094A25]">
                <Navigation className="h-4 w-4" aria-hidden="true" /> Get Directions
              </Link>
            ) : (
              <p className="text-center text-xs text-[#68736D]">This place has no map pin yet.</p>
            )}
          </section>

          <section className="rounded-3xl bg-gradient-to-br from-[#0B5D2E] to-[#14532D] p-6 text-white">
            <p className="font-bold">Plan your visit with TrackTour</p>
            <p className="mt-1 text-sm text-white/85">Sign in to save places, write a review, book a ride here and see it on the live map.</p>
            <Link to={signIn} state={signInState} className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#FFD000] px-4 py-2 text-sm font-bold text-[#14351F] hover:bg-[#FFDD33]">
              <LogIn className="h-4 w-4" aria-hidden="true" /> Sign in
            </Link>
          </section>
        </aside>
      </div>

      {photo && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label="Photo" onClick={() => setPhoto(null)}>
          <button type="button" onClick={() => setPhoto(null)} aria-label="Close photo" className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25"><X className="h-5 w-5" aria-hidden="true" /></button>
          <img src={toAssetUrl(photo)} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </LandingShell>
  )
}
