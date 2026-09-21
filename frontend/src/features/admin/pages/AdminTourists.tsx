import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDate } from '@/shared/utils'
import { API_ENDPOINTS } from '@/shared/constants'
import type { User, PaginatedResponse } from '@/shared/types'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'

export default function AdminTourists() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
    const timeout = setTimeout(() => setDebouncedSearch(value), 400)
    return () => clearTimeout(timeout)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tourists', debouncedSearch, page],
    queryFn: () =>
      get<PaginatedResponse<User>>(API_ENDPOINTS.ADMIN.TOURISTS, {
        params: { search: debouncedSearch || undefined, page },
      }),
  })

  if (isLoading) return <TableSkeleton rows={8} cols={5} />

  const tourists = data?.data ?? []
  const meta = data?.meta

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Tourists</h1>
        <p className="mt-1 text-sm lg:text-base text-[#6B7280]">View and manage tourist accounts</p>
      </div>

      <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism">
        <div className="p-5 lg:p-6 border-b border-[#E2E8E3]">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
            <input
              type="text"
              placeholder="Search tourists..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Tourist</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Location</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Verified</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {tourists.map((tourist) => (
                <tr key={tourist.id} className="hover:bg-[#F3F8F4] transition-colors">
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-[#EAF6ED] flex items-center justify-center text-sm font-medium text-[#16803C] overflow-hidden">
                        {tourist.profile_photo ? (
                          <img src={tourist.profile_photo} alt="" className="w-full h-full object-cover" />
                        ) : (
                          (tourist.name ?? '?').charAt(0).toUpperCase()
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-[#17201A]">{tourist.name}</div>
                        <div className="text-xs text-[#6B7280]">{tourist.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#17201A] whitespace-nowrap">
                    {tourist.municipality || '—'}
                    {tourist.barangay && <span className="text-[#6B7280]">, {tourist.barangay}</span>}
                  </td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <StatusBadge status={tourist.account_status} />
                  </td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    {tourist.email_verified_at ? (
                      <span className="text-[#16803C] text-xs font-medium">Verified</span>
                    ) : (
                      <span className="text-[#6B7280] text-xs font-medium">Unverified</span>
                    )}
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                    {formatDate(tourist.created_at)}
                  </td>
                </tr>
              ))}
              {tourists.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No tourists found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {meta && meta.last_page > 1 && (
          <div className="px-5 lg:px-6 py-4 border-t border-[#E2E8E3] flex items-center justify-between">
            <p className="text-sm text-[#6B7280]">
              Showing {((meta.current_page - 1) * meta.per_page) + 1} to{' '}
              {Math.min(meta.current_page * meta.per_page, meta.total)} of {meta.total} tourists
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-[#6B7280] px-3">
                Page {meta.current_page} of {meta.last_page}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                disabled={page === meta.last_page}
                className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
