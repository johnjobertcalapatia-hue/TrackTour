import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { API_ENDPOINTS } from '@/shared/constants'
import type { Municipality, PaginatedResponse } from '@/shared/types'
import { useState } from 'react'
import { ChevronDown, ChevronRight, Search, Building2, MapPin } from 'lucide-react'

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
        <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage municipalities and their barangays with businesses</p>
      </div>

      <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism mb-6">
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {municipalities.map((mun) => (
          <div key={mun.id} className="bg-white rounded-xl border border-[#E2E8E3] shadow-sm hover:border-[#16803C] transition-all duration-200 cursor-pointer hover:shadow-md">
            <div
              className="p-5"
              onClick={() => setExpandedId(expandedId === mun.id ? null : mun.id)}
            >
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#EAF6ED] to-[#D1FAE5] flex items-center justify-center shrink-0">
                  <span className="font-bold text-lg text-[#16803C]">
                    {mun.name?.charAt(0)?.toUpperCase() ?? '?'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[#17201A] truncate">{mun.name}</div>
                  <div className="text-xs text-[#6B7280] mt-0.5">{mun.district || 'N/A'} District</div>
                  <div className="text-xs text-[#6B7280] mt-0.5">{mun.province || 'Oriental Mindoro'}</div>
                </div>
                <div className="shrink-0">
                  {expandedId === mun.id ? (
                    <ChevronDown className="w-5 h-5 text-[#6B7280]" />
                  ) : (
                    <ChevronRight className="w-5 h-5 text-[#6B7280]" />
                  )}
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[#E2E8E3] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#6B7280]" />
                  <span className="text-sm text-[#6B7280]">Barangays</span>
                </div>
                <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-[#EAF6ED] text-[#16803C] text-xs font-semibold">
                  {mun.barangays?.length ?? 0}
                </span>
              </div>
            </div>

            {expandedId === mun.id && mun.barangays && (
              <div className="border-t border-[#E2E8E3] bg-[#F6F8F4] p-5">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">Barangays</p>
                <div className="space-y-3">
                  {mun.barangays.map((brgy) => (
                    <div
                      key={brgy.id}
                      className="bg-white rounded-lg p-4 border border-[#D7E8DB] shadow-sm hover:border-[#16803C] transition-colors"
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <MapPin className="w-4 h-4 text-[#16803C]" />
                          <span className="font-medium text-[#17201A]">{brgy.name}</span>
                        </div>
                        <span className="text-xs text-[#6B7280] bg-[#EAF6ED] px-2 py-1 rounded-full">
                          {brgy.businesses?.length ?? 0} businesses
                        </span>
                      </div>
                      <div className="space-y-2">
                        {brgy.businesses?.map((business) => (
                          <a
                            key={business.id}
                            href={`/admin/businesses/${business.id}`}
                            className="block text-sm text-[#16803C] hover:text-[#0d5f2e] hover:underline transition-colors"
                          >
                            {business.business_name || 'Unnamed Business'}
                          </a>
                        ))}
                        {brgy.businesses?.length === 0 && (
                          <span className="text-sm text-[#6B7280] italic">No businesses yet</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {municipalities.length === 0 && (
          <div className="col-span-full bg-white rounded-xl border border-[#E2E8E3] shadow-sm p-12 text-center text-[#6B7280]">
            No municipalities found
          </div>
        )}
      </div>

      {meta && meta.last_page > 1 && (
        <div className="mt-6 bg-white rounded-xl border border-[#E2E8E3] shadow-sm px-5 lg:px-6 py-4 flex items-center justify-between">
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
