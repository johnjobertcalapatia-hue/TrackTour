import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { Search, Star, MapPin, Calendar, Heart } from 'lucide-react'
import { toAssetUrl, categoryName, formatCurrency, cn } from '@/shared/utils'

interface BackendStaysPage {
  data: BackendStay[]
}

interface BackendStay {
  id: number
  name: string
  business_name?: string | null
  cover_photo: string | null
  average_rating: number | null
  reviews_avg_rating?: number | null
  municipality: { id: number; name: string } | null
  category: { id: number; name: string } | null
  is_open: boolean
}

interface Stay {
  id: number
  name: string
  cover_photo: string | null
  rating: number | null
  municipality: string
  starting_price: number
  category: unknown
  is_open: boolean
  is_favorited: boolean
}

const FILTERS = ['All', 'Resorts', 'Hotels', 'Budget', 'Popular']

export default function TouristStays() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('All')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-stays-v2', filter, search],
    queryFn: () => {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (filter !== 'All') params.set('filter', filter.toLowerCase())
      return get<{ accommodations: BackendStaysPage; rentals: BackendStaysPage }>(`/tourist/booking?${params.toString()}`)
    },
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const stays: Stay[] = [
    ...(data?.accommodations?.data ?? []),
    ...(data?.rentals?.data ?? []),
  ].map((b) => ({
    id: b.id,
    name: b.name ?? b.business_name ?? 'Stay',
    cover_photo: toAssetUrl(b.cover_photo),
    rating: b.reviews_avg_rating ?? b.average_rating,
    municipality: b.municipality?.name ?? '',
    starting_price: 0,
    category: b.category,
    is_open: b.is_open,
    is_favorited: false,
  }))

  return (
    <div className="space-y-4 px-4 pt-4 pb-4">
      {/* Header */}
      <h1 className="text-xl lg:text-2xl font-bold text-[#17201B]">Stays</h1>

      {/* Dates */}
      <div className="bg-white border border-[#E5E9E7] rounded-2xl p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-[#68736D] mb-1 block">Check-in</label>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9CA3AF]" />
              <input
                type="date"
                value={checkIn}
                onChange={(e) => setCheckIn(e.target.value)}
                className="w-full pl-8 pr-2 py-2 bg-white border border-[#E5E9E7] rounded-lg text-xs text-[#17201B] focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F] outline-none"
              />
            </div>
          </div>
          <div>
            <label className="text-[10px] text-[#68736D] mb-1 block">Check-out</label>
            <div className="relative">
              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#9CA3AF]" />
              <input
                type="date"
                value={checkOut}
                onChange={(e) => setCheckOut(e.target.value)}
                className="w-full pl-8 pr-2 py-2 bg-white border border-[#E5E9E7] rounded-lg text-xs text-[#17201B] focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F] outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search resorts, hotels..."
          className="w-full pl-10 pr-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F] outline-none transition shadow-sm"
        />
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium transition whitespace-nowrap',
              filter === f ? 'bg-[#087F3F] text-white' : 'bg-white border border-[#E5E9E7] text-[#68736D] hover:text-[#17201B] hover:border-[#087F3F]/40'
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Stays grid */}
      {stays.length === 0 ? (
        <div className="py-16 text-center">
          <span className="text-5xl block mb-4">🏨</span>
          <p className="text-[#68736D] font-medium">No stays found</p>
          <p className="text-[#9CA3AF] text-sm mt-1">Try another date or location</p>
        </div>
      ) : (
        <div className="space-y-3">
          {stays.map((stay) => (
            <div
              key={stay.id}
              onClick={() => navigate(`/tourist/stays/${stay.id}`)}
              className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden cursor-pointer hover:border-[#087F3F]/40 transition-all group"
            >
              <div className="relative h-44 bg-[#E9F7EF] overflow-hidden">
                {stay.cover_photo ? (
                  <img src={stay.cover_photo} alt={stay.name} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-5xl">🏨</span>
                  </div>
                )}
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/80 backdrop-blur-md flex items-center justify-center"
                >
                  <Heart className={cn('w-4 h-4', stay.is_favorited ? 'fill-red-500 text-red-500' : 'text-[#68736D]')} />
                </button>
                {stay.category && (
                  <span className="absolute top-3 left-3 bg-[#087F3F] text-white text-[10px] px-2 py-0.5 rounded-full font-semibold">
                    {categoryName(stay.category)}
                  </span>
                )}
                {stay.rating != null && (
                  <div className="absolute bottom-3 left-3 flex items-center gap-1 bg-black/55 backdrop-blur-md text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                    <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" /> {stay.rating.toFixed(1)}
                  </div>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-[#17201B] group-hover:text-[#087F3F] transition">{stay.name}</h3>
                <div className="flex items-center gap-1 mt-1 text-xs text-[#68736D]">
                  <MapPin className="w-3 h-3" /> {stay.municipality}
                </div>
                {stay.starting_price > 0 && (
                  <p className="mt-2 text-sm font-bold text-[#087F3F]">From {formatCurrency(stay.starting_price)} / night</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
