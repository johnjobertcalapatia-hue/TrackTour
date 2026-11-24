import { useQuery } from '@tanstack/react-query'
import { MessageSquareText, Star } from 'lucide-react'
import { get } from '@/shared/services/api'
import { formatDate, getInitials, toAssetUrl } from '@/shared/utils'

/** GET /tourist/explore/{id}/reviews (public; Review::publicCard). */
export interface PublicReview {
  id: number
  rating: number
  review: string | null
  created_at: string | null
  user_name: string
  user?: { name: string; avatar?: string | null } | null
}

interface ReviewsData {
  average: number
  count: number
  breakdown: Record<string, number>
  reviews: PublicReview[]
}

function Stars({ value, size = 'h-4 w-4' }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value.toFixed(1)} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} aria-hidden="true" className={`${size} ${i < Math.round(value) ? 'fill-[#F4B400] text-[#F4B400]' : 'fill-gray-200 text-gray-200'}`} />
      ))}
    </span>
  )
}

/**
 * A business's reviews (2026-11-24): the rating summary, then the latest
 * reviews with the reviewer's first name + initial, stars, date and text.
 * Used by the map place panel (Explore and Ride Hailing) and the landing page.
 * Public: no sign-in needed.
 */
export default function BusinessReviews({ businessId, limit = 10 }: { businessId: number; limit?: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['business-reviews', businessId, limit],
    queryFn: () => get<ReviewsData>(`/tourist/explore/${businessId}/reviews?limit=${limit}`),
    staleTime: 60_000,
  })

  if (isLoading) {
    return (
      <div className="space-y-3 py-4" aria-busy="true" aria-label="Loading reviews">
        {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}
      </div>
    )
  }
  if (isError || !data) return <p className="py-8 text-center text-sm text-gray-500">Reviews couldn&apos;t load right now.</p>

  const max = Math.max(1, ...Object.values(data.breakdown ?? {}))

  return (
    <div className="py-4" data-testid="business-reviews">
      <div className="flex items-center gap-4 rounded-xl bg-[#F7F9F7] p-4">
        <div className="text-center">
          <p className="text-3xl font-bold text-gray-900">{data.count > 0 ? Number(data.average).toFixed(1) : '–'}</p>
          <Stars value={Number(data.average)} size="h-3.5 w-3.5" />
          <p className="mt-0.5 text-xs text-gray-500">{data.count} review{data.count === 1 ? '' : 's'}</p>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {[5, 4, 3, 2, 1].map((star) => {
            const n = Number(data.breakdown?.[String(star)] ?? 0)
            return (
              <div key={star} className="flex items-center gap-2 text-[11px] text-gray-500">
                <span className="w-2 text-right">{star}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                  <span className="block h-full rounded-full bg-[#F4B400]" style={{ width: `${(n / max) * 100}%` }} />
                </span>
                <span className="w-4 tabular-nums">{n}</span>
              </div>
            )
          })}
        </div>
      </div>

      {data.reviews.length === 0 ? (
        <div className="py-8 text-center">
          <MessageSquareText className="mx-auto h-8 w-8 text-gray-300" aria-hidden="true" />
          <p className="mt-2 text-sm font-medium text-gray-700">No reviews yet</p>
          <p className="mt-0.5 text-xs text-gray-500">Reviews from tourists will appear here.</p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-gray-100">
          {data.reviews.map((r) => {
            const avatar = r.user?.avatar ? toAssetUrl(r.user.avatar) : ''
            return (
              <li key={r.id} className="flex gap-3 py-3 text-left">
                {avatar ? (
                  <img src={avatar} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E9F7EF] text-xs font-bold text-[#087F3F]">{getInitials(r.user_name)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-x-2">
                    <p className="text-sm font-semibold text-gray-900">{r.user_name}</p>
                    {r.created_at && <p className="text-[11px] text-gray-400">{formatDate(r.created_at)}</p>}
                  </div>
                  <Stars value={r.rating} size="h-3 w-3" />
                  {r.review && <p className="mt-1 whitespace-pre-line break-words text-sm text-gray-700">{r.review}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
