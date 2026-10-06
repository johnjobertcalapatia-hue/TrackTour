import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { toAssetUrl } from '@/shared/utils'
import { Calendar, Star, Heart, ChevronDown, Search, MapPin, Clock, Tag } from 'lucide-react'

interface BackendEvent {
  id: number
  name: string
  description: string | null
  location: string | null
  image: string | null
  start_date: string
  end_date: string | null
  municipality: { id: number; name: string } | null
}

interface Event {
  id: number
  name: string
  description: string
  category: string
  image: string
  address: string
  municipality: string
  event_date: string
  start_time: string
  end_time: string
  rating: number
  review_count: number
}

const CATEGORIES = [
  { value: 'all', label: 'All Events' },
  { value: 'festival', label: 'Festivals' },
  { value: 'concert', label: 'Concerts' },
  { value: 'cultural', label: 'Cultural' },
  { value: 'sports', label: 'Sports' },
  { value: 'community', label: 'Community' },
  { value: 'tourism', label: 'Tourism' },
  { value: 'food', label: 'Food Events' },
]

const SORT_OPTIONS = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'popular', label: 'Popular' },
  { value: 'rating', label: 'Highest Rated' },
  { value: 'newest', label: 'Newest' },
]

export default function TouristEvents() {
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [selectedSort, setSelectedSort] = useState('upcoming')
  const [searchQuery, setSearchQuery] = useState('')

  const { data: eventsData, isLoading } = useQuery({
    queryKey: ['tourist-events', selectedCategory, selectedSort, searchQuery],
    queryFn: () => get<{ events: BackendEvent[] }>('/tourist/events', {
      params: { category: selectedCategory, sort: selectedSort, search: searchQuery }
    }),
    staleTime: 60_000,
  })
  const events: Event[] = (eventsData?.events ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    description: e.description ?? '',
    category: '',
    image: e.image ?? '',
    address: e.location ?? '',
    municipality: e.municipality?.name ?? '',
    event_date: e.start_date,
    start_time: '',
    end_time: '',
    rating: 0,
    review_count: 0,
  }))

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return {
      month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      day: date.getDate(),
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-extrabold text-[#17201B] tracking-tight">Events</h1>
        <p className="mt-2 text-[#68736D] text-lg">Discover upcoming events and festivals in Bansud</p>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search events..."
            className="w-full pl-10 pr-4 py-2.5 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
          />
        </div>

        <div className="relative">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="appearance-none bg-white border border-[#E5E9E7] rounded-xl px-4 py-2.5 pr-10 text-sm text-[#17201B] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
        </div>

        <div className="relative">
          <select
            value={selectedSort}
            onChange={(e) => setSelectedSort(e.target.value)}
            className="appearance-none bg-white border border-[#E5E9E7] rounded-xl px-4 py-2.5 pr-10 text-sm text-[#17201B] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>Sort by: {s.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
        </div>
      </div>

      {/* Category Pills */}
      <div className="flex flex-wrap gap-2 mb-8">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setSelectedCategory(cat.value)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all ${
              selectedCategory === cat.value
                ? 'bg-[#087F3F] text-white shadow-md shadow-[#087F3F]/20'
                : 'bg-white border border-[#E5E9E7] text-[#68736D] hover:border-[#087F3F] hover:text-[#087F3F]'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-sm text-[#68736D]">
          Showing <span className="font-semibold text-[#17201B]">{events.length}</span> events
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden animate-pulse">
              <div className="h-52 bg-gray-200" />
              <div className="p-4 space-y-3">
                <div className="h-4 bg-gray-200 rounded w-3/4" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
                <div className="h-3 bg-gray-200 rounded w-full" />
              </div>
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="text-center py-16">
          <Calendar className="w-16 h-16 text-[#E5E9E7] mx-auto mb-4" />
          <h3 className="text-lg font-bold text-[#17201B] mb-2">No events found</h3>
          <p className="text-[#68736D] mb-6">Check back later for upcoming events in Bansud.</p>
          <button
            onClick={() => { setSelectedCategory('all'); setSearchQuery('') }}
            className="px-6 py-2.5 bg-[#087F3F] text-white rounded-xl font-medium hover:bg-[#056B35] transition"
          >
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {events.map((event) => (
            <EventCard key={event.id} event={event} formatDate={formatDate} />
          ))}
        </div>
      )}
    </div>
  )
}

function EventCard({ event, formatDate }: { event: Event; formatDate: (d: string) => { month: string; day: number } }) {
  const [liked, setLiked] = useState(false)
  const imageUrl = toAssetUrl(event.image)
  const dateInfo = event.event_date ? formatDate(event.event_date) : null

  return (
    <div className="bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition-all duration-300 group cursor-pointer">
      {/* Image */}
      <div className="relative h-52 overflow-hidden">
        {imageUrl ? (
          <img src={imageUrl} alt={event.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center">
            <Calendar className="w-12 h-12 text-[#087F3F]/30" />
          </div>
        )}
        {/* Category Badge */}
        <div className="absolute top-3 left-3">
          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#087F3F]/90 backdrop-blur-sm rounded-full text-xs font-semibold text-white capitalize">
            <Tag className="w-3 h-3" />
            {event.category?.replace('_', ' ')}
          </span>
        </div>
        {/* Favorite */}
        <button
          onClick={(e) => { e.stopPropagation(); setLiked(!liked) }}
          className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition"
        >
          <Heart className={`w-4 h-4 ${liked ? 'fill-red-500 text-red-500' : 'text-[#68736D]'}`} />
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Date Badge */}
        {dateInfo && (
          <div className="flex items-center gap-3 mb-3">
            <div className="flex flex-col items-center justify-center w-14 h-14 bg-[#087F3F] rounded-xl text-white">
              <span className="text-[10px] font-bold uppercase">{dateInfo.month}</span>
              <span className="text-xl font-extrabold leading-none">{dateInfo.day}</span>
            </div>
            <div>
              <h3 className="font-bold text-[#17201B] text-lg line-clamp-1">{event.name}</h3>
              <div className="flex items-center gap-1.5 text-[#68736D] text-sm">
                <MapPin className="w-3.5 h-3.5" />
                <span className="truncate">{event.municipality || 'Bansud'}</span>
              </div>
            </div>
          </div>
        )}
        {!dateInfo && (
          <>
            <h3 className="font-bold text-[#17201B] text-lg mb-1 line-clamp-1">{event.name}</h3>
            <div className="flex items-center gap-1.5 text-[#68736D] text-sm mb-2">
              <MapPin className="w-3.5 h-3.5" />
              <span className="truncate">{event.municipality || 'Bansud'}</span>
            </div>
          </>
        )}
        {event.description && (
          <p className="text-sm text-[#68736D] line-clamp-2 mb-3">{event.description}</p>
        )}
        <div className="flex items-center gap-4">
          {event.start_time && (
            <span className="flex items-center gap-1 text-xs text-[#68736D]">
              <Clock className="w-3 h-3" />
              {event.start_time}
            </span>
          )}
          <div className="flex items-center gap-1">
            <Star className="w-3.5 h-3.5 text-[#F4B400] fill-[#F4B400]" />
            <span className="text-sm font-semibold text-[#17201B]">{event.rating || '4.5'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
