import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { get } from '@/shared/services/api'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { API_ENDPOINTS } from '@/shared/constants'
import type { Municipality, PaginatedResponse } from '@/shared/types'
import { useState } from 'react'
import { ChevronLeft, MapPin, Building2, Search, Store, UtensilsCrossed, Eye, EyeOff } from 'lucide-react'

interface MunicipalityData {
  municipality: Municipality
  barangays: any[]
}

export default function AdminMunicipalityShow() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [expandedBrgr, setExpandedBrgr] = useState<number | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-municipality', id, search],
    queryFn: () => get<MunicipalityData>(`/admin/municipalities/${id}`, {
      params: { search },
    }),
  })

  if (isLoading) return <TableSkeleton rows={8} cols={3} />

  const municipality = data?.municipality
  const barangays = data?.barangays ?? []

  const handleSearch = (value: string) => {
    setSearch(value)
  }

  if (!municipality) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Municipality Not Found</h1>
          <p className="mt-1 text-sm lg:text-base text-[#6B7280]">The municipality you're looking for doesn't exist.</p>
        </div>
        <button
          onClick={() => navigate('/admin/municipalities')}
          className="text-[#16803C] hover:text-[#0d5f2e] font-medium flex items-center gap-1"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Municipalities
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <button
          onClick={() => navigate('/admin/municipalities')}
          className="text-[#16803C] hover:text-[#0d5f2e] font-medium flex items-center gap-1 mb-4"
        >
          <ChevronLeft className="w-4 h-4" />
          Back to Municipalities
        </button>
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#EAF6ED] to-[#D1FAE5] flex items-center justify-center shrink-0">
            <span className="font-bold text-2xl text-[#16803C]">
              {municipality.name?.charAt(0)?.toUpperCase() ?? '?'}
            </span>
          </div>
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">{municipality.name}</h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              {municipality.district ? `${municipality.district} District, ` : ''}{municipality.province || 'Oriental Mindoro'}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-[#E2E8E3] shadow-tourism mb-6">
        <div className="p-5 lg:p-6 border-b border-[#E2E8E3]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6B7280]" />
            <input
              type="text"
              placeholder="Search barangays or businesses..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E2E8E3] rounded-xl text-sm text-[#17201A] placeholder-[#6B7280] focus:outline-none focus:ring-2 focus:ring-[#16803C]/50 focus:border-[#16803C]"
            />
          </div>
        </div>
      </div>

      <div className="space-y-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-[#16803C]" />
            <span className="text-lg font-semibold text-[#17201A]">Barangays</span>
            <span className="text-sm text-[#6B7280]">({barangays.length})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpandedBrgr(null)}
              className="text-sm text-[#6B7280] hover:text-[#16803C] transition-colors"
            >
              Collapse All
            </button>
            <span className="text-[#E2E8E3]">|</span>
            <button
              onClick={() => setExpandedBrgr(-1)}
              className="text-sm text-[#6B7280] hover:text-[#16803C] transition-colors"
            >
              Expand All
            </button>
          </div>
        </div>

        {barangays.length === 0 && (
          <div className="bg-white rounded-xl border border-[#E2E8E3] shadow-sm p-12 text-center text-[#6B7280]">
            No barangays found
          </div>
        )}

        {barangays.map((brgy) => {
          const isExpanded = expandedBrgr === -1 || expandedBrgr === brgy.id
          const businessCount = brgy.businesses?.length ?? 0
          const touristAttractions = brgy.businesses?.filter((b: any) => 
            b.category?.toLowerCase().includes('tourist') || 
            b.category?.toLowerCase().includes('attraction')
          ).length ?? 0
          const restaurants = brgy.businesses?.filter((b: any) => 
            b.category?.toLowerCase().includes('restaurant') || 
            b.category?.toLowerCase().includes('food')
          ).length ?? 0

          return (
            <div
              key={brgy.id}
              className="bg-white rounded-xl border border-[#E2E8E3] shadow-sm overflow-hidden hover:border-[#16803C] transition-all duration-200"
            >
              <div
                className="p-5 cursor-pointer hover:bg-[#F3F8F4] transition-colors"
                onClick={() => setExpandedBrgr(expandedBrgr === brgy.id ? null : brgy.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-[#EAF6ED] flex items-center justify-center">
                      <MapPin className="w-5 h-5 text-[#16803C]" />
                    </div>
                    <div>
                      <div className="font-semibold text-[#17201A]">{brgy.name}</div>
                      <div className="text-sm text-[#6B7280] mt-0.5">
                        {businessCount} businesses
                        {touristAttractions > 0 && ` • ${touristAttractions} attractions`}
                        {restaurants > 0 && ` • ${restaurants} restaurants`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold bg-[#EAF6ED] text-[#16803C] px-3 py-1 rounded-full">
                      {businessCount}
                    </span>
                    {isExpanded ? (
                      <EyeOff className="w-5 h-5 text-[#6B7280]" />
                    ) : (
                      <Eye className="w-5 h-5 text-[#6B7280]" />
                    )}
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-[#E2E8E3] bg-[#F6F8F4] p-5">
                  <div className="space-y-6">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280] mb-3">All Businesses</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {brgy.businesses?.map((business: any) => (
                          <a
                            key={business.id}
                            href={`/admin/businesses/${business.id}`}
                            className="bg-white rounded-lg p-4 border border-[#D7E8DB] shadow-sm hover:border-[#16803C] transition-all duration-200 hover:shadow-md group"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <Store className="w-4 h-4 text-[#16803C]" />
                                <span className="font-medium text-[#17201A] group-hover:text-[#16803C] transition-colors truncate">
                                  {business.business_name || 'Unnamed Business'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-[#6B7280] bg-[#EAF6ED] px-2 py-1 rounded-full">
                                {business.category || 'Business'}
                              </span>
                            </div>
                          </a>
                        ))}
                        {brgy.businesses?.length === 0 && (
                          <div className="col-span-full bg-white rounded-lg p-8 border border-[#D7E8DB] text-center text-[#6B7280]">
                            No businesses yet in this barangay
                          </div>
                        )}
                      </div>
                    </div>

                    {touristAttractions > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <MapPin className="w-4 h-4 text-[#16803C]" />
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Tourist Attractions</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                          {brgy.businesses?.filter((b: any) => 
                            b.category?.toLowerCase().includes('tourist') || 
                            b.category?.toLowerCase().includes('attraction')
                          ).map((business: any) => (
                            <a
                              key={business.id}
                              href={`/admin/businesses/${business.id}`}
                              className="bg-white rounded-lg p-4 border border-[#D7E8DB] shadow-sm hover:border-[#16803C] transition-all duration-200 hover:shadow-md group"
                            >
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <MapPin className="w-4 h-4 text-[#16803C]" />
                                  <span className="font-medium text-[#17201A] group-hover:text-[#16803C] transition-colors truncate">
                                    {business.business_name || 'Unnamed Business'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-[#6B7280] bg-[#EAF6ED] px-2 py-1 rounded-full">
                                  {business.category || 'Business'}
                                </span>
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {restaurants > 0 && (
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <UtensilsCrossed className="w-4 h-4 text-[#16803C]" />
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Restaurants & Food</p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                          {brgy.businesses?.filter((b: any) => 
                            b.category?.toLowerCase().includes('restaurant') || 
                            b.category?.toLowerCase().includes('food')
                          ).map((business: any) => (
                            <a
                              key={business.id}
                              href={`/admin/businesses/${business.id}`}
                              className="bg-white rounded-lg p-4 border border-[#D7E8DB] shadow-sm hover:border-[#16803C] transition-all duration-200 hover:shadow-md group"
                            >
                              <div className="flex items-start justify-between mb-3">
                                <div className="flex items-center gap-2">
                                  <UtensilsCrossed className="w-4 h-4 text-[#16803C]" />
                                  <span className="font-medium text-[#17201A] group-hover:text-[#16803C] transition-colors truncate">
                                    {business.business_name || 'Unnamed Business'}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs text-[#6B7280] bg-[#EAF6ED] px-2 py-1 rounded-full">
                                  {business.category || 'Business'}
                                </span>
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}