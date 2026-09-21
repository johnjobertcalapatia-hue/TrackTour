import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency } from '@/shared/utils'
import { useBusinessOwnerStore } from '../services/business-owner-store'
import { ChevronLeft, ChevronRight, Plus, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface Offering {
  id: number
  name: string
  type: string
  price: number
  status: string
  business_name: string
  created_at: string
}

const ITEMS_PER_PAGE = 8

export default function BusinessOwnerOfferings() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)

  const { data, isLoading } = useQuery({
    queryKey: ['bo-offerings', selectedBusinessId],
    queryFn: () => {
      const params = selectedBusinessId ? `?business_id=${selectedBusinessId}` : ''
      return get<{ data: Offering[] }>(`/business-owner/offerings${params}`)
    },
  })

  if (isLoading) return <DashboardSkeleton />

  const offerings = data?.data ?? []
  const totalPages = Math.ceil(offerings.length / ITEMS_PER_PAGE)
  const paginated = offerings.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32]">Offerings</h1>
          <p className="mt-1 text-sm text-[#647067]">Manage your business offerings</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/business-owner/offerings/categories')} className="inline-flex items-center gap-2 bg-white hover:bg-[#F3F8F4] text-[#16803C] border border-[#D7E8DB] px-4 py-2.5 rounded-xl text-sm font-medium transition">
            <Settings className="w-4 h-4" /> Manage Categories
          </button>
          <button onClick={() => navigate('/business-owner/offerings/create')} className="inline-flex items-center gap-2 bg-[#16803C] hover:bg-[#126B32] text-white px-4 py-2.5 rounded-xl text-sm font-semibold transition">
            <Plus className="w-4 h-4" /> Add Offering
          </button>
        </div>
      </div>

      {offerings.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <p className="text-[#647067]">No offerings available.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Name</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Type</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Business</th>
                    <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Price</th>
                    <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#647067]">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8E3]">
                  {paginated.map((o) => (
                    <tr key={o.id} className="hover:bg-[#F6F8F4] transition-colors">
                      <td className="px-5 lg:px-6 py-3 font-medium text-[#17201A] whitespace-nowrap">{o.name}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap capitalize">{o.type}</td>
                      <td className="px-5 lg:px-6 py-3 text-[#4B5563] whitespace-nowrap">{o.business_name}</td>
                      <td className="px-5 lg:px-6 py-3 text-right font-medium text-[#17201A] whitespace-nowrap">{formatCurrency(o.price)}</td>
                      <td className="px-5 lg:px-6 py-3 whitespace-nowrap"><StatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[#647067]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, offerings.length)} of {offerings.length}
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
    </div>
  )
}
