import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, put } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { Star, StarOff } from 'lucide-react'

interface Promotion {
  id: number
  title: string
  description: string
  discount_type: string
  discount_value: number
  start_date: string
  end_date: string
  status: string
  is_featured: boolean
  business_name: string
}

export default function BusinessOwnerPromotionFeatured() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['bo-promotions-featured'],
    queryFn: () => get<{ data: Promotion[] }>('/business-owner/promotions/featured'),
  })

  const toggleFeatured = useMutation({
    mutationFn: ({ id, is_featured }: { id: number; is_featured: boolean }) =>
      put(`/business-owner/promotions/${id}`, { is_featured: !is_featured }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-promotions-featured'] })
      queryClient.invalidateQueries({ queryKey: ['bo-promotions'] })
    },
  })

  if (isLoading) return <DashboardSkeleton />

  const promotions = data?.data ?? []

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Featured Promotions</h1>
        <p className="mt-1 text-sm text-[#647067]">Highlight your best promotions for customers</p>
      </div>

      {promotions.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <Star className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-[#647067]">No featured promotions yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {promotions.map((promo) => (
            <div key={promo.id} className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 transition-all hover:border-[#16803C]/40">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-[#EAF6ED] rounded-xl">
                    <Star className="w-4 h-4 text-[#16803C]" />
                  </div>
                  <span className="text-xs font-medium text-[#16803C] uppercase tracking-wider">Featured</span>
                </div>
                <button
                  onClick={() => toggleFeatured.mutate({ id: promo.id, is_featured: promo.is_featured })}
                  disabled={toggleFeatured.isPending}
                  className="p-1.5 rounded-lg text-[#647067] hover:text-[#A66F00] hover:bg-[#FFF7D6] transition"
                  title="Remove from featured"
                >
                  <StarOff className="w-4 h-4" />
                </button>
              </div>

              <h3 className="font-semibold text-[#17201A] mb-1">{promo.title}</h3>
              <p className="text-sm text-[#647067] mb-3 line-clamp-2">{promo.description}</p>

              <div className="flex items-center gap-3 text-sm mb-3">
                <span className="px-2.5 py-1 bg-[#EAF6ED] text-[#16803C] rounded-lg font-medium">
                  {promo.discount_type === 'percentage' ? `${promo.discount_value}% OFF` : `${formatCurrency(promo.discount_value)} OFF`}
                </span>
                <span className="text-[#647067]">•</span>
                <span className="text-[#647067] text-xs">{promo.business_name}</span>
              </div>

              <div className="text-xs text-[#647067]">
                {formatDateTime(promo.start_date)} – {formatDateTime(promo.end_date)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
