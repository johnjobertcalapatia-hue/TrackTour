import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, patch } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatDateTime, toAssetUrl } from '@/shared/utils'
import type { Business } from '@/shared/types'
import { Plus, Building2 } from 'lucide-react'

export default function BusinessOwnerMyBusinesses() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: businesses, isLoading } = useQuery({
    queryKey: ['bo-businesses'],
    queryFn: () => get<Business[]>('/business-owner/businesses'),
  })

  const toggleMutation = useMutation({
    mutationFn: (businessId: number) => patch(`/business-owner/businesses/${businessId}/toggle-open`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-businesses'] })
    },
  })

  if (isLoading) return <DashboardSkeleton />

  const list = businesses ?? []

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">My Businesses</h1>
          <p className="mt-1 text-sm text-[#647067]">Manage your registered businesses</p>
        </div>
        <button
          onClick={() => navigate('/business-owner/businesses/create')}
          className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition"
        >
          <Plus className="w-4 h-4" /> Add Business
        </button>
      </div>

      {list.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <Building2 className="w-12 h-12 text-[#647067] mx-auto mb-4" />
          <p className="text-[#647067]">No businesses yet. Create your first business to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {list.map((biz) => (
            <div
              key={biz.id}
              className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-6 hover:border-[#16803C]/50 hover:shadow-lg transition-all duration-200"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  {biz.logo ? (
                    <img src={toAssetUrl(biz.logo)} alt={biz.name} className="w-12 h-12 rounded-xl object-cover" />
                  ) : (
                    <div className="w-12 h-12 bg-[#EAF6ED] rounded-xl flex items-center justify-center">
                      <Building2 className="w-6 h-6 text-[#16803C]" />
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-[#17201A]">{biz.name}</h3>
                    <p className="text-sm text-[#647067]">{biz.category}</p>
                  </div>
                </div>
                <StatusBadge status={biz.status} />
              </div>
              <div className="flex items-center gap-4 text-sm text-[#647067] mt-4">
                <span>{biz.municipality}</span>
                <span>&bull;</span>
                <button
                  onClick={() => toggleMutation.mutate(biz.id)}
                  disabled={toggleMutation.isPending}
                  className={`font-semibold underline decoration-dotted underline-offset-2 transition hover:opacity-80 disabled:opacity-50 ${biz.is_open ? 'text-[#16803C]' : 'text-[#B91C1C]'}`}
                  title="Click to toggle"
                >
                  {biz.is_open ? 'Open' : 'Closed'}
                </button>
                <span>&bull;</span>
                <span>Created {formatDateTime(biz.created_at)}</span>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                <button onClick={(e) => { e.stopPropagation(); navigate(`/business-owner/businesses/${biz.id}/${biz.category === 'Tourist Attraction' || biz.category_id === 7 ? 'tourist-attraction-edit' : 'edit'}`) }} className="px-3 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] text-white text-sm">Edit</button>
                <button onClick={(e) => { e.stopPropagation(); navigate(`/business-owner/businesses/${biz.id}/documents`) }} className="px-3 py-2 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] text-sm">Documents</button>
                <button onClick={(e) => { e.stopPropagation(); navigate(`/business-owner/businesses/${biz.id}/${biz.category === 'Tourist Attraction' || biz.category_id === 7 ? 'tourist-attraction-gallery' : 'gallery'}`) }} className="px-3 py-2 rounded-xl bg-white text-[#16803C] border border-[#D7E8DB] hover:bg-[#F3F8F4] text-sm">Gallery</button>
                <button onClick={(e) => { e.stopPropagation(); navigate(`/business-owner/businesses/${biz.id}/verification`) }} className="px-3 py-2 rounded-xl bg-[#16803C] hover:bg-[#126B32] text-white text-sm">Verification</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
