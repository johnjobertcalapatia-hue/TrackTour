import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  ArrowRight, Bookmark, Check, Circle, Eye, ExternalLink, ImagePlus, Images, MapPin, MessageSquareText, Pencil, Star, Ticket,
} from 'lucide-react'
import { apiErrorMessage, get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDate, getInitials, toAssetUrl } from '@/shared/utils'
import { CARD, Kpi, Trend } from './OwnerDashboardParts'

/** GET /business-owner/dashboard/attraction/{id}. */
export interface AttractionDashboardData {
  business: {
    id: number
    name: string
    category: string | null
    address: string | null
    photo: string | null
    open_status: { status: string; label: string }
    attraction_type: string | null
    entrance_fee: string | null
  }
  views: { last_30_days: number; previous_30_days: number; daily: { date: string; views: number }[] }
  saves: { total: number; last_30_days: number }
  reviews: {
    average: number
    count: number
    breakdown: Record<string, number>
    last_30_days: number
    latest: { id: number; rating: number; review: string | null; created_at: string | null; user_name: string; user?: { avatar?: string | null } | null }[]
  }
  gallery: { photos: number; videos: number }
  checklist: { key: string; label: string; done: boolean; hint?: string }[]
}

const BAR = '#1B7F3B'

const dayLabel = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function feeLabel(fee: string | null): string | null {
  if (fee == null || fee.trim() === '') return null
  const n = Number(fee)
  if (Number.isFinite(n)) return n <= 0 ? 'Free entrance' : `₱${n.toLocaleString('en-PH', { maximumFractionDigits: 2 })} entrance`
  return fee
}

/**
 * Tourist attraction owner dashboard (redesign 2026-11-24). Attractions take
 * no orders and sell nothing in the app, so instead of orders, revenue and
 * menu items it shows how tourists find and rate the place: page views, saves,
 * reviews, the gallery and a checklist of the visitor information that is
 * still missing.
 */
export default function AttractionDashboard({ businessId }: { businessId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['bo-attraction-dashboard', businessId],
    queryFn: () => get<AttractionDashboardData>(`/business-owner/dashboard/attraction/${businessId}`),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className={`${CARD} p-12 text-center text-sm text-[#5E6B63]`}>{apiErrorMessage(error, "Couldn't load your dashboard.")}</div>

  const { business, views, saves, reviews, gallery, checklist } = data
  const editTo = `/business-owner/businesses/${business.id}/tourist-attraction-edit`
  const galleryTo = `/business-owner/businesses/${business.id}/tourist-attraction-gallery`
  const fixTo = (key: string) => (key === 'photos' ? galleryTo : editTo)
  const photo = business.photo ? toAssetUrl(business.photo) : ''
  const fee = feeLabel(business.entrance_fee)
  const done = checklist.filter((c) => c.done).length
  const pct = checklist.length ? Math.round((done / checklist.length) * 100) : 100

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section aria-label="Your attraction" className={`${CARD} overflow-hidden`}>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,300px)_1fr]">
          <div className="relative h-48 bg-gradient-to-br from-[#0F4D2B] to-[#1F7A45] md:h-full md:min-h-[200px]">
            {photo ? (
              <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
            ) : (
              <Link to={galleryTo} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm font-semibold text-white/90 hover:text-white">
                <ImagePlus className="h-8 w-8" aria-hidden="true" /> Add your first photo
              </Link>
            )}
          </div>
          <div className="flex flex-col justify-between gap-4 p-5 sm:p-6">
            <div>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-full bg-[#E9F7EF] px-2.5 py-1 text-xs font-semibold text-[#16803C]">{business.attraction_type || business.category || 'Tourist attraction'}</span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${business.open_status.status === 'open' ? 'bg-[#E9F7EF] text-[#16803C]' : 'bg-[#FDECEC] text-[#B91C1C]'}`}>{business.open_status.label}</span>
                {fee && <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF6DB] px-2.5 py-1 text-xs font-semibold text-[#7A5A00]"><Ticket className="h-3.5 w-3.5" aria-hidden="true" /> {fee}</span>}
              </div>
              <h1 className="mt-3 text-2xl font-bold text-[#17201B] lg:text-3xl">{business.name}</h1>
              {business.address && (
                <p className="mt-1 flex items-start gap-1.5 text-sm text-[#5E6B63]"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {business.address}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={editTo} className="inline-flex items-center gap-1.5 rounded-xl bg-[#16803C] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#126B32]">
                <Pencil className="h-4 w-4" aria-hidden="true" /> Edit visitor info
              </Link>
              <Link to={galleryTo} className="inline-flex items-center gap-1.5 rounded-xl border border-[#D7E8DB] bg-[#fff] px-4 py-2.5 text-sm font-semibold text-[#16803C] transition hover:bg-[#F3F8F4]">
                <Images className="h-4 w-4" aria-hidden="true" /> Gallery
              </Link>
              <a href={`/explore/place/${business.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-xl border border-[#D7E8DB] bg-[#fff] px-4 py-2.5 text-sm font-semibold text-[#16803C] transition hover:bg-[#F3F8F4]">
                <ExternalLink className="h-4 w-4" aria-hidden="true" /> See it as tourists do
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section aria-label="Last 30 days" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi testId="kpi-views" label="Page views · 30 days" value={views.last_30_days.toLocaleString()} icon={<Eye />}>
          <Trend now={views.last_30_days} before={views.previous_30_days} />
        </Kpi>
        <Kpi testId="kpi-saves" label="Saved by tourists" value={saves.total.toLocaleString()} icon={<Bookmark />}>
          <span className="text-xs text-[#5E6B63]">{saves.last_30_days > 0 ? `+${saves.last_30_days} in the last 30 days` : 'Tourists save places they plan to visit'}</span>
        </Kpi>
        <Kpi testId="kpi-rating" label="Rating" value={reviews.count > 0 ? <span className="inline-flex items-center gap-1.5">{Number(reviews.average).toFixed(1)}<Star className="h-6 w-6 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" /></span> : '–'} icon={<Star />}>
          <span className="text-xs text-[#5E6B63]">{reviews.count > 0 ? `${reviews.count} review${reviews.count === 1 ? '' : 's'}${reviews.last_30_days ? ` · ${reviews.last_30_days} new` : ''}` : 'No reviews yet'}</span>
        </Kpi>
        <Kpi testId="kpi-gallery" label="Gallery" value={gallery.photos.toLocaleString()} icon={<Images />}>
          <span className="text-xs text-[#5E6B63]">photo{gallery.photos === 1 ? '' : 's'}{gallery.videos ? ` · ${gallery.videos} video${gallery.videos === 1 ? '' : 's'}` : ''}</span>
        </Kpi>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* Views per day */}
        <section className={`${CARD} min-w-0 p-5 sm:p-6`} aria-labelledby="attraction-views-heading">
          <h2 id="attraction-views-heading" className="text-lg font-bold text-[#17201B]">Page views per day</h2>
          <p className="mb-4 text-sm text-[#5E6B63]">Tourists who opened your page, last 30 days (each counted once a day)</p>
          <div className="relative h-56 w-full min-w-0">
            <div className="absolute inset-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={views.daily} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke="#EEF2EF" />
                  <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fontSize: 11, fill: '#5E6B63' }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#5E6B63' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#F3F8F4' }} labelFormatter={(v) => dayLabel(String(v))} formatter={(v) => [String(v), 'Views']} />
                  <Bar dataKey="views" fill={BAR} radius={[4, 4, 0, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <table className="sr-only">
            <caption>Page views per day</caption>
            <thead><tr><th>Day</th><th>Views</th></tr></thead>
            <tbody>{views.daily.map((d) => <tr key={d.date}><td>{dayLabel(d.date)}</td><td>{d.views}</td></tr>)}</tbody>
          </table>
        </section>

        {/* Listing checklist */}
        <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="attraction-checklist-heading">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="attraction-checklist-heading" className="text-lg font-bold text-[#17201B]">Visitor information</h2>
            <span className="text-sm font-semibold tabular-nums text-[#16803C]">{done} of {checklist.length}</span>
          </div>
          <p className="text-sm text-[#5E6B63]">{done === checklist.length ? 'Everything tourists look for is filled in.' : 'Complete pages get more visits.'}</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#E9F0EA]" role="progressbar" aria-label="Visitor information complete" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
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
                  <Link to={fixTo(item.key)} className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition hover:bg-[#F3F8F4]" data-testid={`todo-${item.key}`}>
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

      {/* Latest reviews */}
      <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="attraction-reviews-heading">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="attraction-reviews-heading" className="text-lg font-bold text-[#17201B]">Latest reviews</h2>
            <p className="text-sm text-[#5E6B63]">What visitors say on your public page</p>
          </div>
          {reviews.count > 0 && (
            <Link to="/business-owner/notifications?tab=reviews" className="rounded-xl border border-[#D7E8DB] bg-[#fff] px-4 py-2 text-sm font-semibold text-[#16803C] transition hover:bg-[#EAF6ED]">
              All reviews
            </Link>
          )}
        </div>
        {reviews.latest.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[#EAF6ED]"><MessageSquareText className="h-7 w-7 text-[#16803C]" aria-hidden="true" /></span>
            <p className="text-sm font-medium text-[#17201B]">No reviews yet</p>
            <p className="mt-1 max-w-sm text-sm text-[#5E6B63]">Visitors who reach you with TrackTour can rate their trip. Good photos and visitor info help.</p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {reviews.latest.map((r) => {
              const avatar = r.user?.avatar ? toAssetUrl(r.user.avatar) : ''
              return (
                <li key={r.id} className="flex gap-3 rounded-2xl border border-[#EEF2EF] bg-[#FAFBF9] p-4">
                  {avatar ? (
                    <img src={avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E9F7EF] text-xs font-bold text-[#087F3F]">{getInitials(r.user_name)}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-x-2">
                      <p className="text-sm font-semibold text-[#17201B]">{r.user_name}</p>
                      {r.created_at && <p className="text-[11px] text-[#8A948E]">{formatDate(r.created_at)}</p>}
                    </div>
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
