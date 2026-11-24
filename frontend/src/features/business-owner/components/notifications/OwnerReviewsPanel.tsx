import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Star } from 'lucide-react'
import { get } from '@/shared/services/api'
import { Skeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import { useBusinessOwnerStore } from '@/features/business-owner/services/business-owner-store'

interface OwnerReview {
  key: string
  kind: 'restaurant' | 'food'
  business_id: number
  business_name: string
  item_name: string | null
  rating: number
  comment: string | null
  customer_name: string
  order_number: string | null
  images: string[]
  created_at: string | null
}

interface ReviewsResponse {
  data: OwnerReview[]
  meta?: {
    current_page: number
    last_page: number
    total: number
    summary: { average: number; count: number; distribution: Record<string, number> }
  }
}

const KINDS = [
  { key: 'all', label: 'All reviews' },
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'food', label: 'Dishes' },
] as const

function Stars({ value, size = 'h-4 w-4' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`${size} ${i <= Math.round(value) ? 'fill-[#F5B301] text-[#F5B301]' : 'text-[#D1D5DB]'}`} aria-hidden="true" />
      ))}
    </span>
  )
}

/**
 * Reviews & Ratings: every customer review of your businesses (restaurant
 * reviews and dish reviews), a rating summary, and filters.
 */
export default function OwnerReviewsPanel() {
  const businesses = useBusinessOwnerStore((s) => s.businesses)
  const [businessId, setBusinessId] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('all')
  const [page, setPage] = useState(1)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['bo-reviews', businessId, rating, kind, page],
    queryFn: () => {
      const q = new URLSearchParams({ page: String(page), kind })
      if (businessId) q.set('business_id', businessId)
      if (rating) q.set('rating', String(rating))
      return get<ReviewsResponse>(`/business-owner/reviews?${q.toString()}`)
    },
    placeholderData: (previous) => previous,
  })

  const summary = data?.meta?.summary
  const reviews = data?.data ?? []
  const totalPages = Math.max(1, data?.meta?.last_page ?? 1)
  const max = Math.max(1, ...Object.values(summary?.distribution ?? {}))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {businesses.length > 1 && (
          <>
            <label htmlFor="reviews-business" className="sr-only">Business</label>
            <select
              id="reviews-business"
              value={businessId}
              onChange={(e) => { setBusinessId(e.target.value); setPage(1) }}
              className="h-10 rounded-xl border border-[#E2E8E3] bg-white px-3 text-sm focus:border-[#16803C] focus:outline-none"
            >
              <option value="">All businesses</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </>
        )}
        <div role="group" aria-label="Review type" className="flex gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-pressed={kind === k.key}
              onClick={() => { setKind(k.key); setPage(1) }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${kind === k.key ? 'bg-[#16803C] text-white' : 'border border-[#D7E8DB] bg-white text-[#16803C] hover:bg-[#F3F8F4]'}`}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? <Skeleton className="h-64 w-full" /> : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          {/* Rating summary; a star row filters the list. */}
          <section aria-label="Rating summary" className="h-fit rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
            <p className="text-4xl font-extrabold text-[#17201B] tabular-nums">{summary?.count ? summary.average.toFixed(1) : '—'}</p>
            <div className="mt-1"><Stars value={summary?.average ?? 0} /></div>
            <p className="mt-1 text-sm text-[#647067]">{summary?.count ?? 0} review{summary?.count === 1 ? '' : 's'}</p>
            <ul className="mt-4 space-y-1.5">
              {[5, 4, 3, 2, 1].map((star) => {
                const n = summary?.distribution?.[star] ?? 0
                const active = rating === star
                return (
                  <li key={star}>
                    <button
                      type="button"
                      aria-pressed={active}
                      aria-label={`${star} stars: ${n} review${n === 1 ? '' : 's'}`}
                      onClick={() => { setRating(active ? null : star); setPage(1) }}
                      className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-xs transition ${active ? 'bg-[#EAF6ED]' : 'hover:bg-[#F6F8F6]'}`}
                    >
                      <span className="w-6 text-left font-semibold text-[#17201B]">{star}★</span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#EEF2EF]">
                        <span className="block h-full rounded-full bg-[#16803C]" style={{ width: `${(n / max) * 100}%` }} />
                      </span>
                      <span className="w-6 text-right tabular-nums text-[#647067]">{n}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {rating && (
              <button type="button" onClick={() => { setRating(null); setPage(1) }} className="mt-3 text-xs font-semibold text-[#16803C] hover:underline">
                Show all ratings
              </button>
            )}
          </section>

          <div>
            {reviews.length === 0 ? (
              <div className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-12 text-center shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
                <Star className="mx-auto mb-4 h-12 w-12 text-[#9CA3AF]" aria-hidden="true" />
                <p className="text-[#647067]">{rating || kind !== 'all' || businessId ? 'No reviews match these filters.' : 'No customer reviews yet.'}</p>
              </div>
            ) : (
              <ul className={`space-y-3 transition-opacity ${isFetching ? 'opacity-60' : ''}`} aria-label="Customer reviews">
                {reviews.map((r) => (
                  <li key={r.key} className="rounded-[20px] border border-[#E2E8E3] bg-[#fff] p-5 shadow-[0_6px_18px_rgba(22,101,52,0.06)]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-[#17201B]">{r.customer_name}</p>
                        <p className="text-xs text-[#647067]">
                          {r.kind === 'food' ? <>Dish: <span className="font-semibold text-[#2F4A3A]">{r.item_name}</span></> : 'Restaurant review'}
                          {' · '}{r.business_name}{r.order_number ? ` · Order #${r.order_number}` : ''}
                        </p>
                      </div>
                      <Stars value={r.rating} />
                    </div>
                    {r.comment ? <p className="mt-3 whitespace-pre-wrap text-sm text-[#2F3B33]">{r.comment}</p> : <p className="mt-3 text-sm italic text-[#9CA3AF]">No written comment</p>}
                    {r.images.length > 0 && (
                      <div className="mt-3 flex gap-2">
                        {r.images.map((src) => <img key={src} src={src} alt={`Photo from ${r.customer_name}`} className="h-16 w-16 rounded-lg border border-[#E2E8E3] object-cover" />)}
                      </div>
                    )}
                    {r.created_at && <p className="mt-3 text-xs text-[#647067]">{formatDateTime(r.created_at)}</p>}
                  </li>
                ))}
              </ul>
            )}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-end gap-2">
                <button type="button" aria-label="Previous page" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-lg border border-[#D7E8DB] bg-white p-2 text-[#16803C] disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <span className="text-sm text-[#647067]">Page {page} of {totalPages}</span>
                <button type="button" aria-label="Next page" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-lg border border-[#D7E8DB] bg-white p-2 text-[#16803C] disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
