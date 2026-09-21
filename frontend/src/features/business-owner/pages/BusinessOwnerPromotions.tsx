import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, del } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Modal } from '@/shared/components/Modal'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { Plus, Pencil, Archive, ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface Promotion {
  id: number
  title: string
  description: string
  discount_type: string
  discount_value: number
  start_date: string
  end_date: string
  status: string
  business_name: string
}

const ITEMS_PER_PAGE = 8

export default function BusinessOwnerPromotions() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [archiveId, setArchiveId] = useState<number | null>(null)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-promotions', selectedBusinessId],
    queryFn: () => {
      const params = selectedBusinessId ? `?business_id=${selectedBusinessId}` : ''
      return get<{ data: Promotion[] }>(`/business-owner/promotions${params}`)
    },
  })

  const archiveMutation = useMutation({
    mutationFn: (id: number) => del(`/business-owner/promotions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bo-promotions'] })
      setArchiveId(null)
    },
  })

  if (isLoading) return <DashboardSkeleton />

  const promos = data?.data ?? []
  const totalPages = Math.ceil(promos.length / ITEMS_PER_PAGE)
  const paginated = promos.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Promotions</h1>
          <p className="mt-1 text-sm text-[#647067]">Manage your promotions and discounts</p>
        </div>
        <button onClick={() => navigate('/business-owner/promotions/create')} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition">
          <Plus className="w-4 h-4" /> Add Promotion
        </button>
      </div>

      {promos.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <p className="text-[#647067]">No promotions yet. Create your first promotion to attract customers.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Title</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Discount</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Period</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Status</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {paginated.map((promo) => (
                    <tr key={promo.id} className="hover:bg-[#F6F8F4] transition-colors">
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                        <p className="font-medium text-[#17201A]">{promo.title}</p>
                        <p className="text-xs text-[#647067] truncate max-w-[200px]">{promo.description}</p>
                      </td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap">
                        {promo.discount_type === 'percentage' ? `${promo.discount_value}%` : formatCurrency(promo.discount_value)}
                      </td>
                      <td className="px-5 lg:px-6 py-3 text-[#647067] whitespace-nowrap text-xs">
                        {formatDateTime(promo.start_date)} – {formatDateTime(promo.end_date)}
                      </td>
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap"><StatusBadge status={promo.status} /></td>
                      <td className="px-5 lg:px-6 py-3 text-right whitespace-nowrap">
                        <button onClick={() => navigate(`/business-owner/promotions/${promo.id}/edit`)} className="p-1.5 rounded-lg text-[#647067] hover:text-[#16803C] hover:bg-[#EAF6ED] transition">
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button onClick={() => setArchiveId(promo.id)} className="p-1.5 rounded-lg text-[#647067] hover:text-[#A66F00] hover:bg-[#FFF7D6] transition ml-1">
                          <Archive className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[#647067]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, promos.length)} of {promos.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-[#E2E8E3] text-[#647067] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#647067]">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg border border-[#E2E8E3] text-[#647067] hover:bg-[#F3F8F4] disabled:opacity-40 transition">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <Modal show={archiveId !== null} onClose={() => setArchiveId(null)} maxWidth="sm">
        <div className="p-6">
          <h3 className="text-lg font-semibold text-[#17201A] mb-2">Archive Promotion</h3>
          <p className="text-sm text-[#647067] mb-6">Are you sure you want to archive this promotion?</p>
          <div className="flex items-center justify-end gap-3">
            <button onClick={() => setArchiveId(null)} className="px-4 py-2 rounded-xl border border-[#D7E8DB] text-sm font-medium text-[#16803C] hover:bg-[#F3F8F4] transition">
              Cancel
            </button>
            <button
              onClick={() => archiveId && archiveMutation.mutate(archiveId)}
              disabled={archiveMutation.isPending}
              className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-sm font-semibold transition"
            >
              {archiveMutation.isPending ? 'Archiving...' : 'Archive'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
