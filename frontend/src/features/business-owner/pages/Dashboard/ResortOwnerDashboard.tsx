import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight, BedDouble, CalendarCheck, CalendarOff, Check, Circle, ExternalLink, Eye, Home, ImagePlus, Images, MapPin,
  Megaphone, MessageSquareText, Star, Tag, Users,
} from 'lucide-react'
import { apiErrorMessage, get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDate, getInitials, toAssetUrl } from '@/shared/utils'
import { CARD, Kpi, Trend } from './OwnerDashboardParts'

/** GET /business-owner/dashboard/resort/{id}. */
export interface ResortDashboardData {
  business: {
    id: number
    name: string
    address: string | null
    photo: string | null
    open_status: { status: string; label: string }
    types: string[]
    facilities: string[]
  }
  today: {
    date: string
    closed: boolean
    offerings: { id: number; name: string; booking_mode: string; capacity: number; available: number; blocked: boolean; closed: boolean }[]
  }
  reservations: {
    pending: number
    upcoming: number
    this_month: number
    next: { id: number; booking_number: string; customer_name: string; status: string; check_in_date: string; check_out_date: string | null; guests: number | null; total_amount: number | string | null }[]
  }
  offerings: { total: number; published: number; from_price: number | null; by_category: { category: string; label: string; count: number }[] }
  closures: { id: number; start_date: string; end_date: string; offering: string | null; reason: string | null }[]
  deals: { active: number; posts: number }
  views: { last_30_days: number; previous_30_days: number; daily: { date: string; views: number }[] }
  saves: { total: number; last_30_days: number }
  reviews: {
    average: number
    count: number
    last_30_days: number
    latest: { id: number; rating: number; review: string | null; created_at: string | null; user_name: string; user?: { avatar?: string | null } | null }[]
  }
  checklist: { key: string; label: string; done: boolean; hint?: string }[]
}

const day = (iso: string) => new Date(`${iso}T12:00:00+08:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'Asia/Manila' })
const range = (from: string, to: string | null) => (to && to !== from ? `${day(from)} – ${day(to)}` : day(from))

/** Where each unfinished setup item is fixed. */
function fixTo(key: string, businessId: number): string {
  switch (key) {
    case 'types': return '/business-owner/resort/profile'
    case 'offerings':
    case 'offering_photos': return '/business-owner/resort/offerings'
    case 'cover':
    case 'photos': return `/business-owner/businesses/${businessId}/gallery`
    default: return `/business-owner/businesses/${businessId}/edit`
  }
}

/**
 * Resort owner dashboard (redesign 2026-11-24), in the style of the attraction
 * and restaurant dashboards. What a resort owner checks each day: how many
 * cottages, rooms and other offerings are still free today (Stage 6
 * availability), reservations waiting for them, coming closures, deals, how
 * tourists find and rate the resort, and what is left to set up.
 */
export default function ResortOwnerDashboard({ businessId }: { businessId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['bo-resort-dashboard', businessId],
    queryFn: () => get<ResortDashboardData>(`/business-owner/dashboard/resort/${businessId}`),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className={`${CARD} p-12 text-center text-sm text-[#5E6B63]`}>{apiErrorMessage(error, "Couldn't load your dashboard.")}</div>

  const { business, today, reservations, offerings, closures, deals, views, saves, reviews, checklist } = data
  const photo = business.photo ? toAssetUrl(business.photo) : ''
  const done = checklist.filter((c) => c.done).length
  const pct = checklist.length ? Math.round((done / checklist.length) * 100) : 100
  const freeToday = today.offerings.reduce((sum, o) => sum + o.available, 0)
  const capacityToday = today.offerings.reduce((sum, o) => sum + o.capacity, 0)

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section aria-label="Your resort" className={`${CARD} overflow-hidden`}>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,320px)_1fr]">
          <div className="relative h-48 bg-gradient-to-br from-[#0F4D2B] to-[#1F7A45] md:h-full md:min-h-[210px]">
            {photo ? (
              <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <Link to={`/business-owner/businesses/${business.id}/gallery`} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm font-semibold text-white/90 hover:text-white">
                <ImagePlus className="h-8 w-8" aria-hidden="true" /> Add a cover photo
              </Link>
            )}
          </div>
          <div className="flex flex-col justify-between gap-4 p-5 sm:p-6">
            <div>
              <div className="flex flex-wrap gap-1.5">
                {(business.types.length ? business.types : ['Resort']).map((t) => (
                  <span key={t} className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-xs font-semibold text-[#16803C]">{t}</span>
                ))}
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${business.open_status.status === 'open' ? 'bg-[#E9F7EF] text-[#16803C]' : 'bg-[#FDECEC] text-[#B91C1C]'}`}>{business.open_status.label}</span>
                {offerings.from_price != null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF6DB] px-2.5 py-1 text-xs font-semibold text-[#7A5A00]"><Tag className="h-3.5 w-3.5" aria-hidden="true" /> From {formatCurrency(offerings.from_price)}</span>
                )}
              </div>
              <h1 className="mt-3 text-2xl font-bold text-[#17201B] lg:text-3xl">{business.name}</h1>
              {business.address && (
                <p className="mt-1 flex items-start gap-1.5 text-sm text-[#5E6B63]"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {business.address}</p>
              )}
              {business.facilities.length > 0 && (
                <p className="mt-2 text-sm text-[#3F4A43]">{business.facilities.slice(0, 6).join(' · ')}{business.facilities.length > 6 ? ` · +${business.facilities.length - 6} more` : ''}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/business-owner/resort/offerings" className="inline-flex items-center gap-1.5 rounded-xl bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32]">
                <Home className="h-4 w-4" aria-hidden="true" /> Cottages &amp; Offerings
              </Link>
              <Link to="/business-owner/bookings" className="inline-flex items-center gap-1.5 rounded-xl border border-[#D7E8DB] bg-[#fff] px-4 py-2.5 text-sm font-semibold text-[#16803C] transition hover:bg-[#F3F8F4]">
                <CalendarCheck className="h-4 w-4" aria-hidden="true" /> Reservations
              </Link>
              <a href={`/explore/place/${business.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-[#D7E8DB] bg-[#fff] px-4 py-2.5 text-sm font-semibold text-[#16803C] transition hover:bg-[#F3F8F4]">
                <ExternalLink className="h-4 w-4" aria-hidden="true" /> See it as tourists do
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section aria-label="At a glance" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi testId="kpi-reservations" label="Waiting for you" value={reservations.pending.toLocaleString()} icon={<CalendarCheck />}>
          <span className="text-xs text-[#5E6B63]">{reservations.pending === 1 ? 'reservation to confirm' : 'reservations to confirm'} · {reservations.upcoming} upcoming</span>
        </Kpi>
        <Kpi testId="kpi-today" label="Free today" value={capacityToday ? `${freeToday}/${capacityToday}` : '–'} icon={<BedDouble />}>
          <span className="text-xs text-[#5E6B63]">{today.closed ? 'The resort is closed today' : 'units and places across your offerings'}</span>
        </Kpi>
        <Kpi testId="kpi-views" label="Page views · 30 days" value={views.last_30_days.toLocaleString()} icon={<Eye />}>
          <Trend now={views.last_30_days} before={views.previous_30_days} />
        </Kpi>
        <Kpi testId="kpi-rating" label="Rating" value={reviews.count > 0 ? <span className="inline-flex items-center gap-1.5">{Number(reviews.average).toFixed(1)}<Star className="h-6 w-6 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" /></span> : '–'} icon={<Star />}>
          <span className="text-xs text-[#5E6B63]">{reviews.count > 0 ? `${reviews.count} review${reviews.count === 1 ? '' : 's'} · ${saves.total} saved` : `No reviews yet · ${saves.total} saved`}</span>
        </Kpi>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Today at the resort */}
        <section className={`${CARD} min-w-0 p-5 sm:p-6`} aria-labelledby="resort-today-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="resort-today-heading" className="text-lg font-bold text-[#17201B]">Today at the resort</h2>
            <span className="text-sm text-[#5E6B63]">{formatDate(today.date)}</span>
          </div>
          <p className="mb-4 text-sm text-[#5E6B63]">What tourists can still reserve for today</p>
          {today.offerings.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#EAF6ED]"><Home className="h-7 w-7 text-[#16803C]" aria-hidden="true" /></span>
              <p className="text-sm font-medium text-[#17201B]">No published offerings yet</p>
              <Link to="/business-owner/resort/offerings/new" className="mt-2 text-sm font-semibold text-[#16803C] hover:underline">Add a cottage or room</Link>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Free today">
              {today.offerings.map((o) => {
                const used = o.capacity ? Math.round(((o.capacity - o.available) / o.capacity) * 100) : 0
                const off = o.blocked || (o.closed && o.booking_mode !== 'overnight')
                return (
                  <li key={o.id} data-testid={`today-${o.id}`}>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium text-[#17201B]">{o.name}</span>
                      <span className={`shrink-0 tabular-nums ${off ? 'font-semibold text-[#B91C1C]' : o.available === 0 ? 'font-semibold text-[#B45309]' : 'text-[#3F4A43]'}`}>
                        {o.blocked ? 'Blocked' : off ? 'Closed' : o.available === 0 ? 'Fully booked' : `${o.available} of ${o.capacity} free`}
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#E9F0EA]" aria-hidden="true">
                      <div className={`h-full rounded-full ${off ? 'bg-[#E5B3B3]' : 'bg-[#16803C]'}`} style={{ width: `${off ? 100 : used}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Setup checklist */}
        <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="resort-checklist-heading">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="resort-checklist-heading" className="text-lg font-bold text-[#17201B]">Resort setup</h2>
            <span className="text-sm font-semibold tabular-nums text-[#16803C]">{done} of {checklist.length}</span>
          </div>
          <p className="text-sm text-[#5E6B63]">{done === checklist.length ? 'Everything guests look for is filled in.' : 'Complete resorts get more reservations.'}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#E9F0EA]" role="progressbar" aria-label="Resort setup complete" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-[#16803C]" style={{ width: `${pct}%` }} />
          </div>
          <ul className="mt-4 space-y-1">
            {[...checklist].sort((a, b) => Number(a.done) - Number(b.done)).map((item) => (
              <li key={item.key}>
                {item.done ? (
                  <p className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-[#5E6B63]">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#16803C] text-white"><Check className="h-3 w-3" aria-hidden="true" /></span>
                    {item.label}
                  </p>
                ) : (
                  <Link to={fixTo(item.key, business.id)} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition hover:bg-[#F3F8F4]" data-testid={`todo-${item.key}`}>
                    <Circle className="h-5 w-5 shrink-0 text-[#C9D6CC]" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-[#17201B]">{item.label}</span>
                      {item.hint && <span className="block text-xs text-[#8A948E]">{item.hint}</span>}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-[#8A948E] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Upcoming reservations */}
        <section className={`${CARD} p-5 sm:p-6 lg:col-span-2`} aria-labelledby="resort-upcoming-heading">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 id="resort-upcoming-heading" className="text-lg font-bold text-[#17201B]">Upcoming reservations</h2>
              <p className="text-sm text-[#5E6B63]">{reservations.this_month} this month</p>
            </div>
            <Link to="/business-owner/bookings" className="rounded-xl border border-[#D7E8DB] bg-[#fff] px-4 py-2 text-sm font-semibold text-[#16803C] transition hover:bg-[#EAF6ED]">All reservations</Link>
          </div>
          {reservations.next.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#EAF6ED]"><Users className="h-7 w-7 text-[#16803C]" aria-hidden="true" /></span>
              <p className="text-sm font-medium text-[#17201B]">No upcoming reservations</p>
              <p className="mt-1 max-w-sm text-sm text-[#5E6B63]">Reservations from tourists will appear here for you to confirm.</p>
            </div>
          ) : (
            <ul className="divide-y divide-[#EEF2EF]">
              {reservations.next.map((r) => (
                <li key={r.id}>
                  <Link to={`/business-owner/bookings/${r.id}`} className="flex items-center gap-3 py-3 hover:bg-[#F8FBF8]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#EAF6ED]"><CalendarCheck className="h-5 w-5 text-[#16803C]" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#17201B]">{r.customer_name}</span>
                      <span className="block text-xs text-[#5E6B63]">{range(r.check_in_date, r.check_out_date)}{r.guests ? ` · ${r.guests} guest${r.guests === 1 ? '' : 's'}` : ''} · {r.booking_number}</span>
                    </span>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${r.status === 'pending' ? 'bg-[#FFF6DB] text-[#7A5A00]' : 'bg-[#E9F7EF] text-[#16803C]'}`}>{r.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="space-y-6">
          {/* Closures */}
          <section className={`${CARD} p-5`} aria-labelledby="resort-closures-heading">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 id="resort-closures-heading" className="flex items-center gap-2 text-base font-bold text-[#17201B]"><CalendarOff className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> Closures · next 30 days</h2>
              <Link to="/business-owner/resort/offerings" className="text-sm font-semibold text-[#16803C] hover:underline">Manage</Link>
            </div>
            {closures.length === 0 ? (
              <p className="text-sm text-[#5E6B63]">No closed or blocked dates coming up.</p>
            ) : (
              <ul className="space-y-2">
                {closures.map((c) => (
                  <li key={c.id} className="text-sm">
                    <span className="font-semibold text-[#17201B]">{range(c.start_date, c.end_date)}</span>
                    <span className="block text-xs text-[#5E6B63]">{c.offering ?? 'Whole resort'}{c.reason ? ` · ${c.reason}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Offerings & deals */}
          <section className={`${CARD} p-5`} aria-labelledby="resort-offerings-heading">
            <h2 id="resort-offerings-heading" className="mb-3 flex items-center gap-2 text-base font-bold text-[#17201B]"><Home className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> Offerings</h2>
            <p className="text-sm text-[#3F4A43]"><span className="font-semibold tabular-nums">{offerings.published}</span> of {offerings.total} published</p>
            {offerings.by_category.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {offerings.by_category.map((c) => <span key={c.category} className="rounded-lg border border-[#E2E8E3] bg-[#F6F8F4] px-2 py-0.5 text-xs text-[#374151]">{c.count} {c.label}</span>)}
              </div>
            )}
            <Link to="/business-owner/promotions" className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-[#F3F8F4] px-3 py-2.5 text-sm hover:bg-[#EAF6ED]">
              <span className="inline-flex items-center gap-2 font-medium text-[#17201B]"><Megaphone className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> {deals.active} active deal{deals.active === 1 ? '' : 's'} · {deals.posts} post{deals.posts === 1 ? '' : 's'}</span>
              <ArrowRight className="h-4 w-4 text-[#5E6B63]" aria-hidden="true" />
            </Link>
            <Link to={`/business-owner/businesses/${business.id}/gallery`} className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-[#F3F8F4] px-3 py-2.5 text-sm hover:bg-[#EAF6ED]">
              <span className="inline-flex items-center gap-2 font-medium text-[#17201B]"><Images className="h-4 w-4 text-[#16803C]" aria-hidden="true" /> Business gallery</span>
              <ArrowRight className="h-4 w-4 text-[#5E6B63]" aria-hidden="true" />
            </Link>
          </section>
        </div>
      </div>

      {/* Latest reviews */}
      <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="resort-reviews-heading">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="resort-reviews-heading" className="text-lg font-bold text-[#17201B]">Latest reviews</h2>
            <p className="text-sm text-[#5E6B63]">What guests say on your public page</p>
          </div>
          {reviews.count > 0 && (
            <Link to="/business-owner/notifications?tab=reviews" className="rounded-xl border border-[#D7E8DB] bg-[#fff] px-4 py-2 text-sm font-semibold text-[#16803C] transition hover:bg-[#EAF6ED]">All reviews</Link>
          )}
        </div>
        {reviews.latest.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#EAF6ED]"><MessageSquareText className="h-7 w-7 text-[#16803C]" aria-hidden="true" /></span>
            <p className="text-sm font-medium text-[#17201B]">No reviews yet</p>
            <p className="mt-1 max-w-sm text-sm text-[#5E6B63]">Guests who stay with you can rate their visit. Good photos of your cottages and rooms help.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {reviews.latest.map((r) => {
              const avatar = r.user?.avatar ? toAssetUrl(r.user.avatar) : ''
              return (
                <li key={r.id} className="flex gap-3 rounded-2xl border border-[#EEF2EF] bg-[#FAFBF9] p-4">
                  {avatar ? <img src={avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" /> : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E9F7EF] text-xs font-bold text-[#087F3F]">{getInitials(r.user_name)}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[#17201B]">{r.user_name}</p>
                    <span className="inline-flex gap-0.5" aria-label={`${r.rating} out of 5 stars`}>
                      {Array.from({ length: 5 }, (_, i) => <Star key={i} aria-hidden="true" className={`h-3 w-3 ${i < r.rating ? 'fill-[#F4B400] text-[#F4B400]' : 'fill-gray-200 text-gray-200'}`} />)}
                    </span>
                    {r.review && <p className="mt-1 line-clamp-3 break-words text-sm text-[#3F4A43]">{r.review}</p>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
