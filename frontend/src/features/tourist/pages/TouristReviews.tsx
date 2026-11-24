import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { cn, formatDateTime, toAssetUrl } from '@/shared/utils'
import { RATING_TAG_LABELS } from '@/features/tourist/components/RatingSheet'
import {
  BedDouble,
  Bike,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Mountain,
  Star,
  Store,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'

type Category = 'food' | 'restaurant' | 'rider' | 'resort' | 'attraction' | 'other'
type Tab = 'all' | Exclude<Category, 'other'>

interface ReviewItem {
  key: string
  category: Category
  title: string
  subtitle: string | null
  rating: number
  comment: string | null
  images: string[]
  tags: string[]
  details: { label: string; value: string }[]
  would_recommend: boolean | null
  status: 'pending' | 'approved' | 'rejected' | null
  link: string | null
  created_at: string | null
}

interface ReviewFeed {
  items: ReviewItem[]
  counts: Record<Tab, number>
}

interface TabMeta {
  label: string
  icon: LucideIcon
  tint: string
  empty: string
  /** Set while tourists cannot write this kind of review yet. */
  unavailable?: boolean
}

const TABS: Tab[] = ['all', 'food', 'restaurant', 'rider', 'resort', 'attraction']

const META: Record<Tab, TabMeta> = {
  all: { label: 'All', icon: Layers, tint: 'bg-[#E9F7EF] text-[#087F3F]', empty: 'No reviews yet. Your reviews of food, restaurants and riders show up here.' },
  food: { label: 'Food', icon: UtensilsCrossed, tint: 'bg-[#FFF1E6] text-[#C2410C]', empty: 'No dish reviews yet. Rate the dishes you ordered from My Orders → To Review.' },
  restaurant: { label: 'Restaurants', icon: Store, tint: 'bg-[#E9F7EF] text-[#087F3F]', empty: 'No restaurant reviews yet. Review a restaurant after your food order arrives.' },
  rider: { label: 'Riders', icon: Bike, tint: 'bg-[#E8F1FD] text-[#2563EB]', empty: 'No rider ratings yet. Rate your rider after a food delivery or a ride.' },
  resort: { label: 'Resorts & stays', icon: BedDouble, tint: 'bg-[#F3E8FF] text-[#7E22CE]', empty: 'Reviews for resorts and stays are not available in the app yet.', unavailable: true },
  attraction: { label: 'Attractions', icon: Mountain, tint: 'bg-[#E0F2F1] text-[#0F766E]', empty: 'Reviews for tourist attractions are not available in the app yet.', unavailable: true },
}

const CATEGORY_LABEL: Record<Category, string> = {
  food: 'Dish',
  restaurant: 'Restaurant',
  rider: 'Rider',
  resort: 'Resort & stay',
  attraction: 'Attraction',
  other: 'Business',
}

const ITEMS_PER_PAGE = 8

function isTab(value: string | null): value is Tab {
  return value !== null && (TABS as string[]).includes(value)
}

/**
 * My Reviews: everything the tourist has reviewed, in tabs by what was
 * reviewed — food (dishes), restaurants, riders, resorts & stays, attractions.
 * The open tab is kept in the URL (?tab=rider) so it survives a back step.
 */
export default function TouristReviews() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'all'
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-reviews', 'grouped'],
    queryFn: () => get<ReviewFeed>('/tourist/reviews'),
  })

  if (isLoading) return <DashboardSkeleton />

  const items = (data?.items ?? []).filter((r) => tab === 'all' || r.category === tab)
  const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE))
  const current = Math.min(page, totalPages)
  const paginated = items.slice((current - 1) * ITEMS_PER_PAGE, current * ITEMS_PER_PAGE)

  const selectTab = (next: Tab) => {
    setPage(1)
    setParams(next === 'all' ? {} : { tab: next }, { replace: true })
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">My Reviews</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Your reviews of food, restaurants, riders, resorts and attractions</p>
      </div>

      <div role="tablist" aria-label="Review categories" className="-mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => {
          const meta = META[t]
          const selected = t === tab
          const count = data?.counts?.[t] ?? 0
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectTab(t)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition',
                selected ? 'border-[#087F3F] bg-[#087F3F] text-white' : 'border-[#DDE3DF] bg-[#fff] text-[#17201B] hover:border-[#087F3F]/40',
              )}
            >
              <meta.icon className="h-4 w-4" aria-hidden="true" />
              {meta.label}
              <span className={cn('rounded-full px-1.5 text-xs tabular-nums', selected ? 'bg-white/20 text-white' : 'bg-[#F1F3F2] text-[#56615B]')}>{count}</span>
            </button>
          )
        })}
      </div>

      <div role="tabpanel" aria-label={META[tab].label}>
        {items.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          <>
            <div className="space-y-3">
              {paginated.map((r) => (
                <ReviewCard key={r.key} review={r} showCategory={tab === 'all'} />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-[#6B7280]">
                  Showing {(current - 1) * ITEMS_PER_PAGE + 1}–{Math.min(current * ITEMS_PER_PAGE, items.length)} of {items.length}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={() => setPage(Math.max(1, current - 1))} disabled={current === 1} aria-label="Previous page" className="rounded-lg border border-[#E5E9E7] p-2 text-[#6B7280] transition hover:bg-[#E5E9E7] disabled:opacity-40">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm text-[#6B7280]">Page {current} of {totalPages}</span>
                  <button onClick={() => setPage(Math.min(totalPages, current + 1))} disabled={current === totalPages} aria-label="Next page" className="rounded-lg border border-[#E5E9E7] p-2 text-[#6B7280] transition hover:bg-[#E5E9E7] disabled:opacity-40">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function EmptyState({ tab }: { tab: Tab }) {
  const meta = META[tab]
  return (
    <div className="rounded-2xl border border-[#E5E9E7] bg-white p-10 text-center">
      <span className={cn('mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl', meta.tint)}>
        <meta.icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="mx-auto max-w-sm text-sm text-[#56615B]">{meta.empty}</p>
      {tab === 'food' && (
        <Link to="/tourist/orders" className="mt-3 inline-block text-sm font-semibold text-[#087F3F] hover:underline">
          Go to My Orders
        </Link>
      )}
      {meta.unavailable && <p className="mt-2 text-xs text-[#7A857F]">Coming soon</p>}
    </div>
  )
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex items-center gap-0.5 text-[#F4B400]" role="img" aria-label={`${rating} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn('h-3.5 w-3.5', i < rating ? 'fill-current' : 'text-[#D9DED9]')} aria-hidden="true" />
      ))}
    </span>
  )
}

function ReviewCard({ review: r, showCategory }: { review: ReviewItem; showCategory: boolean }) {
  const meta = META[r.category === 'other' ? 'all' : r.category]
  const body = (
    <div className="flex gap-3">
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', meta.tint)}>
        <meta.icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-[#17201B]">{r.title}</p>
        {(r.subtitle || showCategory) && (
          <p className="truncate text-xs text-[#56615B]">
            {showCategory && <span className="font-medium text-[#17201B]/70">{CATEGORY_LABEL[r.category]}</span>}
            {showCategory && r.subtitle && ' · '}
            {r.subtitle}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Stars rating={r.rating} />
          {r.status === 'pending' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#FFF5DB] px-2 py-0.5 text-[10px] font-semibold text-[#8A6100]">
              <Clock className="h-3 w-3" aria-hidden="true" /> Awaiting approval
            </span>
          )}
          {r.status === 'rejected' && (
            <span className="rounded-full bg-[#FDECEC] px-2 py-0.5 text-[10px] font-semibold text-[#B91C1C]">Not published</span>
          )}
          {r.would_recommend && (
            <span className="rounded-full bg-[#087F3F]/10 px-2 py-0.5 text-[10px] font-semibold text-[#087F3F]">Would recommend</span>
          )}
          {r.created_at && <span className="w-full text-xs text-[#7A857F] sm:ml-auto sm:w-auto">{formatDateTime(r.created_at)}</span>}
        </div>

        {r.comment && <p className="mt-2 text-sm leading-relaxed text-[#3F4A44]">{r.comment}</p>}

        {r.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {r.tags.map((t) => (
              <span key={t} className="rounded-full border border-[#DDE3DF] px-2 py-0.5 text-[11px] text-[#3F4A44]">{RATING_TAG_LABELS[t] ?? t}</span>
            ))}
          </div>
        )}

        {r.details.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#56615B]">
            {r.details.map((d) => (
              <span key={d.label}>{d.label}: <span className="font-medium text-[#17201B]">{d.value}</span></span>
            ))}
          </div>
        )}

        {r.images.length > 0 && (
          <div className="mt-3 flex gap-2">
            {r.images.slice(0, 5).map((src) => (
              <img key={src} src={toAssetUrl(src)} alt={`Photo from your review of ${r.title}`} className="h-14 w-14 rounded-lg object-cover" />
            ))}
          </div>
        )}
      </div>
    </div>
  )

  const cardClass = 'block bg-white border border-[#E5E9E7] rounded-2xl p-4 sm:p-5'
  return r.link ? (
    <Link to={r.link} data-testid={`review-${r.key}`} className={cn(cardClass, 'transition hover:border-[#087F3F]/30')}>
      {body}
    </Link>
  ) : (
    <div data-testid={`review-${r.key}`} className={cardClass}>{body}</div>
  )
}
