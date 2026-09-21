import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post, del } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Archive, RotateCcw, Trash2, Search, Filter } from 'lucide-react'

interface ArchivedItem {
  id: number
  type: string
  name: string
  business_id: number
  deleted_at: string
}

interface ArchiveResponse {
  items: ArchivedItem[]
}

const typeConfig: Record<string, { label: string; color: string }> = {
  offering: { label: 'Offering', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
  promotion: { label: 'Promotion', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
  order: { label: 'Order', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
  booking: { label: 'Booking', color: 'text-[#A66F00] bg-[#FFF7D6] border-[#F4B400]/40' },
  staff: { label: 'Staff', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
  media: { label: 'Media', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
  category: { label: 'Category', color: 'text-[#16803C] bg-[#EAF6ED] border-[#BFE3CB]' },
  document: { label: 'Document', color: 'text-[#647067] bg-[#F3F4F6] border-[#E5E7EB]' },
}

export default function BusinessOwnerArchiveVault() {
  const queryClient = useQueryClient()
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery<ArchiveResponse>({
    queryKey: ['bo-archive'],
    queryFn: () => get<ArchiveResponse>('/business-owner/archive'),
  })

  const items = data?.items ?? []

  const filtered = items.filter((item) => {
    if (typeFilter && item.type !== typeFilter) return false
    if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const restoreMutation = useMutation({
    mutationFn: ({ type, id }: { type: string; id: number }) =>
      post(`/business-owner/archive/${type}/${id}/restore`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-archive'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: ({ type, id }: { type: string; id: number }) =>
      del(`/business-owner/archive/${type}/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bo-archive'] }),
  })

  const types = Array.from(new Set(items.map((i) => i.type)))

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#126B32] flex items-center gap-2">
            <Archive className="w-8 h-8 text-[#16803C]" />
            Archive Vault
          </h1>
          <p className="mt-1 text-sm text-[#647067]">View and restore archived items across all your businesses</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-4 lg:p-5">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#647067]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search archived items..."
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition"
            />
          </div>
          <div className="relative w-full sm:w-48">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#647067]" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#16803C]/25 focus:border-[#16803C] transition appearance-none"
            >
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>{typeConfig[t]?.label ?? t}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {isLoading ? (
        <DashboardSkeleton />
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] p-12 text-center">
          <Archive className="w-12 h-12 text-[#647067] mx-auto mb-3" />
          <p className="text-[#647067] font-medium">No archived items found</p>
          <p className="text-sm text-[#647067] mt-1">Archived items from all modules will appear here</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-[#E2E8E3] shadow-[0_6px_18px_rgba(22,101,52,0.06)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="bg-[#F6F8F4] border-b border-[#E2E8E3]">
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Name</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Type</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067]">Archived At</th>
                  <th className="px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-[#647067] text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8E3]">
                {filtered.map((item) => (
                  <tr key={`${item.type}-${item.id}`} className="hover:bg-[#F6F8F4] transition-colors">
                    <td className="px-5 py-3.5 font-medium text-[#17201A]">{item.name}</td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${typeConfig[item.type]?.color ?? 'text-[#647067] bg-[#F3F4F6] border-[#E5E7EB]'}`}>
                        {typeConfig[item.type]?.label ?? item.type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-[#647067] text-xs">
                      {new Date(item.deleted_at).toLocaleDateString('en-US', {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => restoreMutation.mutate({ type: item.type, id: item.id })}
                          className="p-2 text-[#16803C] hover:bg-[#EAF6ED] rounded-lg transition-colors"
                          title="Restore"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('Permanently delete this item? This cannot be undone.')) {
                              deleteMutation.mutate({ type: item.type, id: item.id })
                            }
                          }}
                          className="p-2 text-[#B91C1C] hover:bg-[#FEF2F2] rounded-lg transition-colors"
                          title="Permanently Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
