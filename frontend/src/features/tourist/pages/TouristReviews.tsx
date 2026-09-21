import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime } from '@/shared/utils'
import { Star, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react'

interface Review {
  id: number
  business_id: number
  business_name: string
  rating: number
  food_rating?: number
  service_rating?: number
  delivery_rating?: number
  would_recommend?: boolean
  comment: string
  created_at: string
}

const ITEMS_PER_PAGE = 8

export default function TouristReviews() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-reviews'],
    queryFn: () => get<{ data: Review[] }>('/tourist/reviews'),
  })

  if (isLoading) return <DashboardSkeleton />

  const reviews = data?.data ?? []
  const totalPages = Math.ceil(reviews.length / ITEMS_PER_PAGE)
  const paginated = reviews.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">My Reviews</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Reviews you've written for food orders</p>
      </div>

      {reviews.length === 0 ? (
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-12 text-center">
          <MessageSquare className="w-12 h-12 text-[#6B7280]/30 mx-auto mb-4" />
          <p className="text-[#6B7280]">No reviews yet. Complete orders and leave your feedback.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {paginated.map((r) => (
              <div
                key={r.id}
                onClick={() => navigate(`/tourist/explore/${r.business_id}`)}
                className="bg-white border border-[#E5E9E7] rounded-2xl p-5 hover:border-[#087F3F]/30 transition-all duration-200 cursor-pointer"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-[#17201B]">{r.business_name}</span>
                    <div className="flex items-center gap-1 text-[#F4B400] text-xs">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star key={i} className={`w-3 h-3 ${i < r.rating ? 'fill-current' : ''}`} />
                      ))}
                    </div>
                  </div>
                  <span className="text-xs text-[#6B7280]">{formatDateTime(r.created_at)}</span>
                </div>
                {r.would_recommend && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-[#087F3F]/10 text-[#087F3F] font-semibold mb-2">
                    Would Recommend
                  </span>
                )}
                <p className="text-sm text-[#6B7280]">{r.comment}</p>
                {(r.food_rating || r.service_rating || r.delivery_rating) && (
                  <div className="flex items-center gap-4 mt-3 text-xs text-[#6B7280]">
                    {r.food_rating && <span>Food: {r.food_rating}/5</span>}
                    {r.service_rating && <span>Service: {r.service_rating}/5</span>}
                    {r.delivery_rating && <span>Delivery: {r.delivery_rating}/5</span>}
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[#6B7280]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, reviews.length)} of {reviews.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-[#E5E9E7] text-[#6B7280] hover:bg-[#E5E9E7] disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#6B7280]">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg border border-[#E5E9E7] text-[#6B7280] hover:bg-[#E5E9E7] disabled:opacity-40 transition">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
