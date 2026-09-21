import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { API_ENDPOINTS } from '@/shared/constants'
import type { Municipality, PaginatedResponse } from '@/shared/types'
import { useState } from 'react'
import { ChevronDown, ChevronRight, MapPin } from 'lucide-react'

export default function AdminMunicipalities() {
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-municipalities'],
    queryFn: () => get<PaginatedResponse<Municipality>>(API_ENDPOINTS.ADMIN.MUNICIPALITIES),
  })

  if (isLoading) return <TableSkeleton rows={8} cols={3} />

  const municipalities = data?.data ?? []

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Municipalities</h1>
        <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage municipalities and their barangays</p>
      </div>

      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280] w-8" />
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Municipality</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Slug</th>
                <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Barangays</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {municipalities.map((mun) => (
                <>
                  <tr
                    key={mun.id}
                    className="hover:bg-[#F6F8F4] transition-colors cursor-pointer"
                    onClick={() => setExpandedId(expandedId === mun.id ? null : mun.id)}
                  >
                    <td className="px-5 lg:px-6 py-3">
                      {expandedId === mun.id ? (
                        <ChevronDown className="w-4 h-4 text-[#6B7280]" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-[#6B7280]" />
                      )}
                    </td>
                    <td className="px-5 lg:px-6 py-3">
                      <div className="flex items-center gap-2">
                        <div className="bg-[#EAF6ED] p-1.5 rounded-lg">
                          <MapPin className="w-4 h-4 text-[#16803C]" />
                        </div>
                        <span className="font-medium text-[#17201A]">{mun.name}</span>
                      </div>
                    </td>
                    <td className="px-5 lg:px-6 py-3 text-[#6B7280] font-mono text-xs">{mun.slug}</td>
                    <td className="px-5 lg:px-6 py-3 text-right">
                      <span className="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full bg-[#EAF6ED] text-[#16803C] text-xs font-medium">
                        {mun.barangays?.length ?? 0}
                      </span>
                    </td>
                  </tr>
                  {expandedId === mun.id && mun.barangays && (
                    <tr key={`${mun.id}-barangays`}>
                      <td colSpan={4} className="px-5 lg:px-6 py-4 bg-[#F6F8F4]">
                        <div className="ml-8">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-2">Barangays</p>
                          <div className="flex flex-wrap gap-2">
                            {mun.barangays.map((brgy) => (
                              <span
                                key={brgy.id}
                                className="inline-flex items-center px-3 py-1 rounded-full bg-white border border-[#D7E8DB] text-xs text-[#17201A]"
                              >
                                {brgy.name}
                              </span>
                            ))}
                            {mun.barangays.length === 0 && (
                              <span className="text-xs text-[#6B7280]">No barangays</span>
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
                  <td colSpan={4} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No municipalities found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
