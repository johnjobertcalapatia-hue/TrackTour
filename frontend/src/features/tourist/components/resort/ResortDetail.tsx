import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Car, Clock, Compass, Droplets, Flame, Flower2, Footprints, Heart, Home, Mail, MapPin, Phone,
  Sailboat, Share2, ShowerHead, Star, Sun, Tent, UtensilsCrossed, Waves, Wifi, Baby, Building2, CalendarCheck, Moon, ShieldCheck,
} from 'lucide-react'
import { cn, formatDateTime, toAssetUrl } from '@/shared/utils'
import RestaurantRouteMap from '@/features/tourist/components/RestaurantRouteMap'

/** Stage 1 resort classification, as returned by GET /tourist/explore/{id} → resort. */
export interface ResortInfo {
  types: { id: number; slug: string; name: string }[]
  facilities: { id: number; slug: string; name: string }[]
  custom_facilities: string[]
  /** Published, bookable offerings (Stage 4). */
  offerings?: ResortOfferingItem[]
}

export interface ResortOfferingItem {
  id: number
  category: string
  category_label: string
  name: string
  description: string | null
  booking_mode: 'day_use' | 'overnight' | 'time_slot' | 'duration'
  pricing_basis: 'per_person' | 'per_unit' | 'per_hour' | 'per_night' | 'per_booking'
  price: number
  inventory_mode: 'units' | 'capacity' | 'slots'
  inventory_quantity: number
  min_guests: number | null
  max_guests: number | null
  duration_minutes: number | null
  is_required: boolean
  bookable_independently: boolean
  requires_offering_name: string | null
  images: { id: number; path: string }[]
}

/** "/ person", "/ night", … for prices. */
export const PRICING_BASIS_LABEL: Record<ResortOfferingItem['pricing_basis'], string> = {
  per_person: 'person',
  per_unit: 'unit',
  per_hour: 'hour',
  per_night: 'night',
  per_booking: 'booking',
}

const STAY_CATEGORIES = ['cottage', 'room', 'campsite']

const durationLabel = (m: number | null) => (m == null ? '' : m % 60 === 0 ? `${m / 60} h` : `${m} min`)

function bookingModeLabel(o: ResortOfferingItem): string {
  switch (o.booking_mode) {
    case 'day_use': return 'Day use'
    case 'overnight': return 'Overnight'
    case 'time_slot': return `Time slot · ${durationLabel(o.duration_minutes)}`
    case 'duration': return `${durationLabel(o.duration_minutes)} booking`
  }
}

export interface ResortBusiness {
  id: number
  name?: string
  business_name?: string
  description?: string | null
  business_description?: string | null
  address?: string | null
  municipality?: { name: string } | null
  barangay?: { name: string } | null
  latitude?: number | string | null
  longitude?: number | string | null
  phone?: string | null
  contact_number?: string | null
  email?: string | null
  cover_photo?: string | null
  logo?: string | null
  opening_time?: string | null
  closing_time?: string | null
  schedule_summary?: string | null
  price_range?: string | null
  category_details?: Record<string, string | null> | null
}

export interface ResortReview {
  id: number
  rating: number
  review?: string | null
  created_at?: string | null
  user?: { name?: string | null } | null
}

interface Props {
  business: ResortBusiness
  resort: ResortInfo
  photos: string[]
  reviews: ResortReview[]
  avgRating: number | null
  reviewsCount: number
  isFavorited: boolean
  onToggleFavorite: () => void
  onShare: () => void
}

const FACILITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  swimming_pool: Waves,
  beach_access: Sun,
  river_access: Droplets,
  cottages: Home,
  camping_area: Tent,
  gardens: Flower2,
  nature_trails: Footprints,
  function_area: Building2,
  grilling_area: Flame,
  water_activities: Sailboat,
  restaurant: UtensilsCrossed,
  parking: Car,
  restrooms: ShowerHead,
  wifi: Wifi,
  playground: Baby,
}

const truthy = (v?: string | null) => ['1', 'true', 'yes', 'on'].includes(String(v ?? '').trim().toLowerCase())
const splitList = (v?: string | null) => String(v ?? '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean)
const formatTime = (t?: string | null) => {
  if (!t) return null
  const [h, m] = t.split(':').map(Number)
  if (Number.isNaN(h)) return t
  const d = new Date(2000, 0, 1, h, m || 0)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

/**
 * Reusable resort detail page (dynamic resort system, Stage 3). Assembled
 * from the resort's real data: every section is hidden when it has nothing
 * published, so a resort without cottages never shows an empty cottage area.
 * Order: gallery & overview · types & facilities · about · activities ·
 * availability · reviews · location & directions · policies & contact.
 * Bookable offerings and the reservation builder arrive in later stages.
 */
export default function ResortDetail({ business, resort, photos, reviews, avgRating, reviewsCount, isFavorited, onToggleFavorite, onShare }: Props) {
  const navigate = useNavigate()
  const [photoIndex, setPhotoIndex] = useState(0)

  const name = business.name || business.business_name || 'Resort'
  const description = business.description || business.business_description || ''
  const details = business.category_details ?? {}
  const place = [business.barangay?.name, business.municipality?.name].filter(Boolean).join(', ')
  const lat = business.latitude != null ? Number(business.latitude) : null
  const lng = business.longitude != null ? Number(business.longitude) : null
  const hasCoords = lat != null && lng != null && !Number.isNaN(lat) && !Number.isNaN(lng)
  const phone = business.phone || business.contact_number || ''
  const gallery = photos.length > 0 ? photos : business.cover_photo ? [business.cover_photo] : []
  const rating = avgRating != null && avgRating > 0 && reviewsCount > 0 ? avgRating : null

  // Activities (owner-entered at registration) and availability facts.
  const activities = splitList(details.recreational_activities)
  const availability = [
    truthy(details.day_tour_available) && { icon: Sun, label: 'Day tour available' },
    truthy(details.overnight_stay) && { icon: Moon, label: 'Overnight stays' },
    (details.check_in_time || details.check_out_time) && {
      icon: Clock,
      label: [details.check_in_time && `Check-in ${formatTime(details.check_in_time)}`, details.check_out_time && `Check-out ${formatTime(details.check_out_time)}`].filter(Boolean).join(' · '),
    },
    business.schedule_summary
      ? { icon: CalendarCheck, label: business.schedule_summary }
      : business.opening_time && business.closing_time
        ? { icon: CalendarCheck, label: `Open ${formatTime(business.opening_time)} – ${formatTime(business.closing_time)}` }
        : null,
  ].filter(Boolean) as { icon: React.ComponentType<{ className?: string }>; label: string }[]
  const policies = [
    details.house_rules && { title: 'House rules', body: details.house_rules },
    details.cancellation_policy && { title: 'Cancellation', body: details.cancellation_policy },
    details.payment_terms && { title: 'Payment', body: details.payment_terms },
  ].filter(Boolean) as { title: string; body: string }[]
  const hasFacilities = resort.facilities.length + resort.custom_facilities.length > 0
  const offerings = resort.offerings ?? []
  const stayOfferings = offerings.filter((o) => STAY_CATEGORIES.includes(o.category))
  const otherOfferings = offerings.filter((o) => !STAY_CATEGORIES.includes(o.category))
  const hasContact = Boolean(phone || business.email)

  return (
    <main aria-label={`${name} resort`} className="pb-24 max-w-6xl mx-auto px-4 sm:px-6 space-y-6">
      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm font-medium text-[#56615B] hover:text-[#17201B]">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onShare} aria-label="Share" className="w-10 h-10 rounded-full bg-white border border-[#E5E9E7] flex items-center justify-center text-[#3B4540] hover:text-[#087F3F]">
            <Share2 className="w-4 h-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={onToggleFavorite} aria-pressed={isFavorited} aria-label={isFavorited ? 'Saved' : 'Save'} className="w-10 h-10 rounded-full bg-white border border-[#E5E9E7] flex items-center justify-center">
            <Heart className={cn('w-4 h-4', isFavorited ? 'fill-red-500 text-red-500' : 'text-[#3B4540]')} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 1. Gallery & overview */}
      <section aria-labelledby="resort-overview-title">
        <div className="relative rounded-3xl overflow-hidden aspect-[16/9] sm:aspect-[21/9] bg-gradient-to-br from-[#087F3F] to-[#0B2A17]">
          {gallery.length > 0 ? (
            <img src={toAssetUrl(gallery[photoIndex] ?? gallery[0]!)} alt={`${name} photo ${photoIndex + 1}`} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center"><Compass className="w-16 h-16 text-white/30" aria-hidden="true" /></div>
          )}
        </div>
        {gallery.length > 1 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Resort photos">
            {gallery.map((src, i) => (
              <button
                key={`${src}-${i}`}
                type="button"
                onClick={() => setPhotoIndex(i)}
                aria-label={`Show photo ${i + 1} of ${gallery.length}`}
                aria-pressed={i === photoIndex}
                className={cn('shrink-0 w-20 h-14 sm:w-24 sm:h-16 rounded-xl overflow-hidden border-2', i === photoIndex ? 'border-[#087F3F]' : 'border-transparent opacity-75 hover:opacity-100')}
              >
                <img src={toAssetUrl(src)} alt="" loading="lazy" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

        <div className="mt-4">
          {resort.types.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 mb-2" aria-label="Resort types">
              {resort.types.map((t) => (
                <li key={t.slug} className="h-6 px-2.5 rounded-full bg-[#E9F7EF] text-xs font-bold text-[#047332] leading-6">{t.name}</li>
              ))}
            </ul>
          )}
          <h1 id="resort-overview-title" className="text-[clamp(1.6rem,3.5vw,2.25rem)] font-extrabold text-[#17201B] leading-tight">{name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#56615B]">
            {(place || business.address) && (
              <span className="inline-flex items-center gap-1"><MapPin className="w-4 h-4 text-[#087F3F]" aria-hidden="true" /> {place || business.address}</span>
            )}
            {rating !== null ? (
              <span className="inline-flex items-center gap-1">
                <Star className="w-4 h-4 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" />
                <span className="font-bold text-[#17201B]">{rating.toFixed(1)}</span> ({reviewsCount} review{reviewsCount === 1 ? '' : 's'})
              </span>
            ) : (
              <span>No reviews yet</span>
            )}
            {business.price_range && <span className="font-semibold text-[#087F3F]">{business.price_range}</span>}
          </div>
        </div>
      </section>

      {/* 2. Facilities */}
      {hasFacilities && (
        <section aria-labelledby="resort-facilities-title" className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5">
          <h2 id="resort-facilities-title" className="text-lg font-bold text-[#17201B] mb-3">Facilities</h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2" aria-label="Facilities">
            {resort.facilities.map((f) => {
              const Icon = FACILITY_ICON[f.slug] ?? ShieldCheck
              return (
                <li key={f.slug} className="flex items-center gap-2 text-sm text-[#17201B]">
                  <span className="w-8 h-8 rounded-lg bg-[#E9F7EF] flex items-center justify-center shrink-0"><Icon className="w-4 h-4 text-[#087F3F]" /></span>
                  {f.name}
                </li>
              )
            })}
            {resort.custom_facilities.map((name2) => (
              <li key={`custom-${name2}`} className="flex items-center gap-2 text-sm text-[#17201B]">
                <span className="w-8 h-8 rounded-lg bg-[#F3F4F6] flex items-center justify-center shrink-0"><ShieldCheck className="w-4 h-4 text-[#56615B]" /></span>
                {name2}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 3. About */}
      {description && (
        <section aria-labelledby="resort-about-title" className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5">
          <h2 id="resort-about-title" className="text-lg font-bold text-[#17201B] mb-2">About</h2>
          <p className="text-[15px] leading-relaxed text-[#3B4540] whitespace-pre-line">{description}</p>
        </section>
      )}

      {/* 4–5. Bookable offerings (published only; sections hidden when empty) */}
      {stayOfferings.length > 0 && <OfferingSection id="resort-stays" title="Cottages & stays" offerings={stayOfferings} />}
      {otherOfferings.length > 0 && <OfferingSection id="resort-services" title="Activities & services" offerings={otherOfferings} />}

      {/* Activities (owner-entered) */}
      {activities.length > 0 && (
        <section aria-labelledby="resort-activities-title" className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5">
          <h2 id="resort-activities-title" className="text-lg font-bold text-[#17201B] mb-3">Activities</h2>
          <ul className="flex flex-wrap gap-2" aria-label="Activities">
            {activities.map((a) => <li key={a} className="h-8 px-3 rounded-full bg-[#F3F8F4] text-sm text-[#17201B] leading-8">{a}</li>)}
          </ul>
        </section>
      )}

      {/* 6. Availability (the reservation builder arrives in a later stage) */}
      {availability.length > 0 && (
        <section aria-labelledby="resort-availability-title" className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5">
          <h2 id="resort-availability-title" className="text-lg font-bold text-[#17201B] mb-3">Availability</h2>
          <ul className="space-y-2" aria-label="Availability">
            {availability.map((a) => (
              <li key={a.label} className="flex items-center gap-2 text-sm text-[#17201B]"><a.icon className="w-4 h-4 text-[#087F3F]" /> {a.label}</li>
            ))}
          </ul>
        </section>
      )}

      {/* 7. Reviews */}
      {reviews.length > 0 && (
        <section aria-labelledby="resort-reviews-title" className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5">
          <h2 id="resort-reviews-title" className="text-lg font-bold text-[#17201B] mb-3">
            Reviews {rating !== null && <span className="text-sm font-semibold text-[#56615B]">· {rating.toFixed(1)} ★ from {reviewsCount}</span>}
          </h2>
          <ul className="divide-y divide-[#EEF2EF]" aria-label="Reviews">
            {reviews.slice(0, 5).map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#17201B]">{r.user?.name || 'Tourist'}</p>
                  <span className="inline-flex" aria-label={`${r.rating} out of 5`}>
                    {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cn('w-3.5 h-3.5', n <= r.rating ? 'fill-[#F4B400] text-[#F4B400]' : 'text-[#D7DDD9]')} aria-hidden="true" />)}
                  </span>
                </div>
                {r.review && <p className="mt-1 text-sm text-[#3B4540]">{r.review}</p>}
                {r.created_at && <p className="mt-1 text-[11px] text-[#56615B]">{formatDateTime(r.created_at)}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 8. Location & directions (in-app route from the tourist's location) */}
      {(hasCoords || business.address || place) && (
        <section aria-labelledby="resort-location-title" className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5">
          <h2 id="resort-location-title" className="text-lg font-bold text-[#17201B] mb-2">Location</h2>
          {(business.address || place) && (
            <p className="flex items-start gap-2 text-sm text-[#3B4540] mb-3"><MapPin className="w-4 h-4 mt-0.5 text-[#087F3F] shrink-0" aria-hidden="true" /> {[business.address, place].filter(Boolean).join(', ')}</p>
          )}
          {hasCoords && (
            <RestaurantRouteMap restaurantName={name} destination={[lat!, lng!]} locationLabel={place || business.address || name} photo={business.logo || business.cover_photo} />
          )}
        </section>
      )}

      {/* 9. Policies & contact */}
      {(policies.length > 0 || hasContact) && (
        <section aria-labelledby="resort-contact-title" className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5 space-y-4">
          <h2 id="resort-contact-title" className="text-lg font-bold text-[#17201B]">{policies.length > 0 ? 'Policies & contact' : 'Contact'}</h2>
          {policies.map((p) => (
            <div key={p.title}>
              <h3 className="text-sm font-bold text-[#17201B]">{p.title}</h3>
              <p className="text-sm text-[#3B4540] whitespace-pre-line">{p.body}</p>
            </div>
          ))}
          {hasContact && (
            <div className="flex flex-wrap gap-2">
              {phone && (
                <a href={`tel:${phone}`} className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-[#087F3F] text-white text-sm font-semibold hover:bg-[#056B35]">
                  <Phone className="w-4 h-4" aria-hidden="true" /> {phone}
                </a>
              )}
              {business.email && (
                <a href={`mailto:${business.email}`} className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-[#087F3F] text-[#087F3F] text-sm font-semibold hover:bg-[#E9F7EF]">
                  <Mail className="w-4 h-4" aria-hidden="true" /> {business.email}
                </a>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  )
}

function OfferingSection({ id, title, offerings }: { id: string; title: string; offerings: ResortOfferingItem[] }) {
  return (
    <section aria-labelledby={`${id}-title`} className="bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5">
      <h2 id={`${id}-title`} className="text-lg font-bold text-[#17201B] mb-3">{title}</h2>
      <ul className="grid gap-3 sm:grid-cols-2" aria-label={title}>
        {offerings.map((o) => <OfferingCard key={o.id} offering={o} />)}
      </ul>
    </section>
  )
}

/** One bookable offering. Reserving comes with the reservation builder (later stage). */
function OfferingCard({ offering: o }: { offering: ResortOfferingItem }) {
  const img = o.images[0]?.path
  const facts = [
    bookingModeLabel(o),
    o.max_guests ? `Up to ${o.max_guests} guest${o.max_guests === 1 ? '' : 's'}` : null,
    o.inventory_mode === 'units' ? `${o.inventory_quantity} available` : o.inventory_mode === 'capacity' ? `Capacity ${o.inventory_quantity}` : `${o.inventory_quantity} per slot`,
  ].filter(Boolean) as string[]

  return (
    <li className="flex gap-3 rounded-xl border border-[#EEF2EF] p-3">
      <div className="w-24 h-24 shrink-0 rounded-lg overflow-hidden bg-[#E9F7EF] flex items-center justify-center">
        {img ? <img src={toAssetUrl(img)} alt="" loading="lazy" className="w-full h-full object-cover" /> : <Home className="w-7 h-7 text-[#087F3F]/40" aria-hidden="true" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#047332]">{o.category_label}</p>
        <h3 className="text-[15px] font-bold text-[#17201B] leading-snug">{o.name}</h3>
        {o.description && <p className="mt-0.5 text-xs text-[#56615B] line-clamp-2">{o.description}</p>}
        <p className="mt-1 text-sm font-extrabold text-[#087F3F]">
          {o.price > 0 ? <>₱{o.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} <span className="text-xs font-semibold text-[#56615B]">/ {PRICING_BASIS_LABEL[o.pricing_basis]}</span></> : 'Free'}
        </p>
        <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-[#56615B]" aria-label={`${o.name} details`}>
          {facts.map((f) => <li key={f}>{f}</li>)}
          {o.is_required && <li className="font-semibold text-[#B45309]">Required</li>}
          {!o.bookable_independently && o.requires_offering_name && <li className="font-semibold">Only with {o.requires_offering_name}</li>}
        </ul>
      </div>
    </li>
  )
}

