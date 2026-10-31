import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { API_ENDPOINTS } from '@/shared/constants'
import type { Municipality, PaginatedResponse } from '@/shared/types'
import { useState } from 'react'
import { ChevronDown, ChevronRight, MapPin, Search } from 'lucide-react'

export default function AdminMunicipalities() {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-municipalities', search],
    queryFn: () => get<PaginatedResponse<Municipality>>(API_ENDPOINTS.ADMIN.MUNICIPALITIES, {
      params: { search },
    }),
  })

  if (isLoading) return <TableSkeleton rows={8} cols={3} />

  const municipalities = data?.data ?? []
  const meta = data?.meta

  const handleSearch = (value: string) => {
    setSearch(value)
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Municipalities</h1>
        <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage municipalities and their barangays</p>
      </div>

      <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism">
        <div className="p-5 lg:p-6 border-b border-[#E2E8E3]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
            <input
              type="text"
              placeholder="Search municipalities..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]"
            />
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
              <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Municipality</th>
              <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Province</th>
              <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Barangays</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8E3]">
            {municipalities.map((mun) => (
              <>
                <tr
                  key={mun.id}
                  className="hover:bg-[#F3F8F4] transition-colors cursor-pointer"
                  onClick={() => setExpandedId(expandedId === mun.id ? null : mun.id)}
                >
                  <td className="px-5 lg:px-6 py-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-lg bg-[#EAF6ED] flex items-center justify-center text-sm font-medium text-[#16803C] overflow-hidden"
                      >
                        <span className="font-bold text-[#16803C]">
                          {mun.name?.charAt(0)?.toUpperCase() ?? '?'}
                        </span>
                      </div>
                      <div>
                        <div className="font-medium text-[#17201A]">{mun.name}</div>
                        <div className="text-xs text-[#6B7280]">{mun.district?.trim() || ''} District</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                    {mun.province || 'Oriental Mindoro'}
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-right">
                    <span className="inline-flex items-center justify-center min-w-[3rem] px-3 py-2 rounded-full bg-[#EAF6ED] text-[#16803C] text-xs font-medium">
                      {mun.barangays?.length ?? 0}
                    </span>
                  </td>
                </tr>
                {expandedId === mun.id && mun.barangays && (
                  <tr key={`${mun.id}-barangays`}>
                    <td colSpan={3} className="px-5 lg:px-6 py-4 bg-[#F6F8F4]">
                      <div className="ml-8">
                        <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Barangays</p>
                        <div className="space-y-2">
                          {mun.barangays.map((brgy) => (
                            <div
                              key={brgy.id}
                              className="flex items-center px-3 py-2 rounded-full bg-white border border-[#D7E8DB] text-sm text-[#17201A]"
                            >
                              <span className="font-medium">{brgy.name}</span>
                              <span className="ml-2 text-xs text-[#6B7280]">
                                ({brgy.businesses?.length ?? 0} businesses)
                              </span>
                            </div>
                          ))}
                          {mun.barangays.length === 0 && (
                            <p className="text-xs text-[#6B7280]">No barangays</p>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {municipalities.length === 0 && (
              <tr>
                <td colSpan={3} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No municipalities found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {meta && meta.last_page > 1 && (
        <div className="px-5 lg:px-6 py-4 border-t border-[#E2E8E3] flex items-center justify-between">
          <p className="text-sm text-[#6B7280]">
            Showing {((meta.current_page - 1) * meta.per_page) + 1} to{' '}
            {Math.min(meta.current_page * meta.per_page, meta.total)} of {meta.total} municipalities
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={meta.current_page === 1}
              className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm text-[#6B7280] px-3">
              Page {meta.current_page} of {meta.last_page}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
              disabled={meta.current_page === meta.last_page}
              className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}