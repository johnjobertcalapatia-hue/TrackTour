import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatDate } from '@/shared/utils'
import { API_ENDPOINTS } from '@/shared/constants'
import type { Business, PaginatedResponse } from '@/shared/types'
import { Search, ChevronLeft, ChevronRight, Eye } from 'lucide-react'
import { Link } from 'react-router-dom'

const STATUS_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'rejected', label: 'Rejected' },
]

export default function AdminBusinesses() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  const handleSearch = (value: string) => {
    setSearch(value)
    setPage(1)
    const timeout = setTimeout(() => setDebouncedSearch(value), 400)
    return () => clearTimeout(timeout)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin-businesses', debouncedSearch, status, page],
    queryFn: () =>
      get<PaginatedResponse<Business>>(API_ENDPOINTS.ADMIN.BUSINESSES, {
        params: { search: debouncedSearch || undefined, status: status || undefined, page },
      }),
  })

  if (isLoading) return <TableSkeleton rows={8} cols={5} />

  const businesses = data?.data ?? []
  const meta = data?.meta

  return (
    <div>
      <div className="mb-8">
        <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism p-6 lg:p-8 relative overflow-hidden">
          <div className="absolute inset-0 opacity-5 pointer-events-none">
            <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="header-dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                  <circle cx="2" cy="2" r="1" fill="#16803C" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#header-dots)" />
            </svg>
          </div>
          <div className="relative z-10">
            <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Businesses</h1>
            <p className="mt-1 text-sm lg:text-base text-[#6B7280]">Manage all registered businesses</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-[#E2E8E3] rounded-2xl shadow-tourism">
        <div className="p-5 lg:p-6 border-b border-[#E2E8E3]">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
              <input
                type="text"
                placeholder="Search businesses..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50"
              />
            </div>
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1) }}
              className="px-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]/50"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8E3] bg-[#F6F8F4]">
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Business</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Category</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Municipality</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Status</th>
                <th className="text-left px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Created</th>
                <th className="text-right px-5 lg:px-6 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8E3]">
              {businesses.map((biz) => (
                <tr key={biz.id} className="hover:bg-[#F6F8F4] transition-colors">
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-[#EAF6ED] overflow-hidden flex-shrink-0">
                        {biz.logo ? (
                          <img src={biz.logo} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-[#6B7280]">N/A</div>
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-[#17201A]">{biz.name}</div>
                        <div className="text-xs text-[#6B7280]">{biz.phone || biz.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#17201A] whitespace-nowrap">{biz.category}</td>
                  <td className="px-5 lg:px-6 py-3 text-[#17201A] whitespace-nowrap">{biz.municipality}</td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap">
                    <StatusBadge status={biz.status} />
                  </td>
                  <td className="px-5 lg:px-6 py-3 text-[#6B7280] whitespace-nowrap">
                    {formatDate(biz.created_at)}
                  </td>
                  <td className="px-5 lg:px-6 py-3 whitespace-nowrap text-right">
                    <Link
                      to={`/admin/businesses/${biz.id}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#EAF6ED] text-[#16803C] hover:bg-[#D7FAE5] transition"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View
                    </Link>
                  </td>
                </tr>
              ))}
              {businesses.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 lg:px-6 py-12 text-center text-[#6B7280]">No businesses found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {meta && meta.last_page > 1 && (
          <div className="px-5 lg:px-6 py-4 border-t border-[#E2E8E3] flex items-center justify-between">
            <p className="text-sm text-[#6B7280]">
              Showing {((meta.current_page - 1) * meta.per_page) + 1} to{' '}
              {Math.min(meta.current_page * meta.per_page, meta.total)} of {meta.total} businesses
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-lg bg-white border border-[#E2E8E3] text-[#16803C] hover:bg-[#F6F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-[#6B7280] px-3">
                Page {meta.current_page} of {meta.last_page}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
                disabled={page === meta.last_page}
                className="p-2 rounded-lg bg-white border border-[#E2E8E3] text-[#16803C] hover:bg-[#F6F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
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
