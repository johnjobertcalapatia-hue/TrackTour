import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Bike, Building2, ChevronLeft, ChevronRight, Home, Plus, Search, ShieldAlert, ShieldCheck, Store } from 'lucide-react'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { useDebounce } from '@/shared/hooks/use-debounce'
import { API_ENDPOINTS } from '@/shared/constants'
import type { PaginatedResponse } from '@/shared/types'
import { MunicipalityFormModal } from '@/features/admin/components/MunicipalityFormModal'

interface MunicipalitySummary {
  id: number
  name: string
  district: string | null
  province: string | null
  logo: string | null
  is_home: boolean
  barangays_count: number
  businesses_count: number
  pending_businesses_count: number
  riders_count: number
  admins_count: number
}

export default function AdminMunicipalities() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)
  const debounced = useDebounce(search)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-municipalities', debounced, page],
    queryFn: () =>
      get<PaginatedResponse<MunicipalitySummary>>(API_ENDPOINTS.ADMIN.MUNICIPALITIES, {
        params: { search: debounced || undefined, page },
      }),
    placeholderData: keepPreviousData,
  })

  const municipalities = data?.data ?? []
  const meta = data?.meta

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Municipalities</h1>
          <p className="mt-1 text-sm lg:text-base text-[#6B7280]">
            Municipalities under the Bansud Tourism Office. Each one manages its own business owners, businesses, riders and tourists.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="self-start sm:self-auto px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#16803C] text-white hover:bg-[#126B32] inline-flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Add municipality
        </button>
      </div>

      <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism mb-6 p-5 lg:p-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
          <input
            type="search"
            aria-label="Search municipalities"
            placeholder="Search municipalities..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]"
          />
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={8} cols={3} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {municipalities.map((mun) => (
            <button
              type="button"
              key={mun.id}
              className="text-left bg-white rounded-xl border border-[#E2E8E3] shadow-sm hover:border-[#16803C] transition-all duration-200 hover:shadow-md group"
              onClick={() => navigate(`/admin/municipalities/${mun.id}`)}
            >
              <div className="p-5">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#EAF6ED] to-[#D1FAE5] flex items-center justify-center shrink-0 overflow-hidden">
                    {mun.logo ? (
                      <img src={mun.logo} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="font-bold text-lg text-[#16803C]">{mun.name?.charAt(0)?.toUpperCase() ?? '?'}</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-[#17201A] truncate group-hover:text-[#16803C] transition-colors flex items-center gap-1.5">
                      {mun.name}
                      {mun.is_home && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#16803C] bg-[#EAF6ED] rounded-full px-1.5 py-0.5">
                          <Home className="w-3 h-3" /> Home
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[#6B7280] mt-0.5">{mun.district || 'N/A'}</div>
                    <div className="text-xs text-[#6B7280] mt-0.5">{mun.province || 'Oriental Mindoro'}</div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-[#6B7280] group-hover:text-[#16803C] transition-colors shrink-0" />
                </div>

                <dl className="mt-4 pt-3 border-t border-[#E2E8E3] grid grid-cols-3 gap-2 text-center">
                  <div>
                    <dt className="flex items-center justify-center gap-1 text-[11px] text-[#6B7280]">
                      <Building2 className="w-3.5 h-3.5" /> Barangays
                    </dt>
                    <dd className="text-sm font-semibold text-[#17201A]">{mun.barangays_count}</dd>
                  </div>
                  <div>
                    <dt className="flex items-center justify-center gap-1 text-[11px] text-[#6B7280]">
                      <Store className="w-3.5 h-3.5" /> Businesses
                    </dt>
                    <dd className="text-sm font-semibold text-[#17201A]">
                      {mun.businesses_count}
                      {mun.pending_businesses_count > 0 && (
                        <span className="ml-1 text-[11px] font-medium text-amber-600">+{mun.pending_businesses_count}</span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="flex items-center justify-center gap-1 text-[11px] text-[#6B7280]">
                      <Bike className="w-3.5 h-3.5" /> Riders
                    </dt>
                    <dd className="text-sm font-semibold text-[#17201A]">{mun.riders_count}</dd>
                  </div>
                </dl>

                <div
                  className={`mt-3 flex items-center gap-1.5 text-xs font-medium ${
                    mun.admins_count > 0 || mun.is_home ? 'text-[#16803C]' : 'text-amber-600'
                  }`}
                >
                  {mun.admins_count > 0 || mun.is_home ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                  {mun.is_home
                    ? 'Managed by the Bansud Tourism Office'
                    : mun.admins_count > 0
                      ? `${mun.admins_count} Tourism Office account${mun.admins_count > 1 ? 's' : ''}`
                      : 'No Tourism Office account yet'}
                </div>
              </div>
            </button>
          ))}
          {municipalities.length === 0 && (
            <div className="col-span-full bg-white rounded-xl border border-[#E2E8E3] shadow-sm p-12 text-center text-[#6B7280]">
              No municipalities found
            </div>
          )}
        </div>
      )}

      {meta && meta.last_page > 1 && (
        <div className="mt-6 bg-white rounded-xl border border-[#E2E8E3] shadow-sm px-5 lg:px-6 py-4 flex items-center justify-between">
          <p className="text-sm text-[#6B7280]">
            Showing {(meta.current_page - 1) * meta.per_page + 1} to {Math.min(meta.current_page * meta.per_page, meta.total)} of{' '}
            {meta.total} municipalities
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Previous page"
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
              type="button"
              aria-label="Next page"
              onClick={() => setPage((p) => Math.min(meta.last_page, p + 1))}
              disabled={meta.current_page === meta.last_page}
              className="p-2 rounded-lg bg-white border border-[#D7E8DB] text-[#16803C] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <MunicipalityFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSaved={(id) => navigate(`/admin/municipalities/${id}`)}
      />
    </div>
  )
}
