import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { formatCurrency } from '@/shared/utils'
import { Star, MapPin, Compass, ArrowLeft, ChevronDown } from 'lucide-react'

type Tab = 'all' | 'places' | 'food' | 'businesses' | 'stays'

interface ExploreItem {
  id: number
  name: string
  cover_photo: string | null
  logo?: string | null
  rating: number | null
  municipality: string
  type: 'place' | 'food' | 'stay'
  starting_price?: number
}

interface ExploreData {
  places: ExploreItem[]
  food: ExploreItem[]
  stays: ExploreItem[]
  municipalities?: { id: number; name: string; businesses_count?: number }[]
}

interface MapBusiness {
  id: number
  name: string
  cover_photo?: string | null
  municipality?: string | null
  category?: string | null
  average_rating?: number
  review_count?: number
}

const TYPE_EMOJI: Record<string, string> = { place: '📍', food: '🍴', stay: '🏨', business: '🏪' }

function initialTabFromParams(param: string | null): Tab {
  return param === 'places' || param === 'food' || param === 'businesses' || param === 'stays' ? param : 'all'
}

export default function LandingExplorePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tab = initialTabFromParams(searchParams.get('tab'))
  const [municipality, setMunicipality] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['landing-explore'],
    queryFn: () => get<ExploreData>('/tourist/explore'),
  })

  const { data: businessData } = useQuery({
    queryKey: ['landing-explore-businesses'],
    queryFn: () => get<MapBusiness[]>('/map/businesses'),
  })

  const places = data?.places ?? []
  const food = data?.food ?? []
  const stays = data?.stays ?? []
  const businesses = businessData ?? []

  let filtered: (ExploreItem | MapBusiness)[] = []
  if (tab === 'all') filtered = [...places, ...food, ...stays]
  else if (tab === 'places') filtered = places
  else if (tab === 'food') filtered = food
  else if (tab === 'businesses') filtered = businesses
  else filtered = stays

  if (municipality) {
    filtered = filtered.filter((item) => item.municipality === municipality)
  }

  const municipalities = data?.municipalities ?? []

  const handleTap = (item: ExploreItem | MapBusiness) => {
    if ('type' in item) {
      if (item.type === 'place') navigate(`/tourist/destinations/${item.id}`)
      else if (item.type === 'food') navigate(`/explore/food/${item.id}`)
      else navigate(`/tourist/explore/${item.id}`)
    } else {
      navigate(`/tourist/explore/${item.id}`)
    }
  }

  return (
    <div className="min-h-screen tourism-bg tourism-bg-orbs text-[#17201A]">
      <nav className="flex items-center justify-between px-6 py-2 max-w-7xl mx-auto tourism-nav">
        <Link to="/" className="flex items-center gap-3">
          <ApplicationLogo className="w-12 h-12" />
          <span className="text-xl font-bold text-[#16803C]">TrackTour</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm text-[#16803C] hover:text-[#126B32] transition-colors">
            Sign In
          </Link>
          <Link to="/role-selection" className="btn-tourism px-4 py-1.5 text-sm font-medium">
            Get Started
          </Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-[10px] py-8">
        <Link
          to="/"
          onClick={() => sessionStorage.setItem('tracktour_scroll_to_content', '1')}
          className="inline-flex items-center gap-2 text-sm font-medium text-[#087F3F] hover:text-[#056B35] transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A]">Explore Bansud &amp; District 2</h1>
          <div className="relative">
            <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#087F3F] pointer-events-none" />
            <select
              value={municipality}
              onChange={(e) => setMunicipality(e.target.value)}
              className="appearance-none pl-10 pr-9 py-2.5 rounded-xl bg-white border border-[#E5E9E7] text-sm font-medium text-[#17201A] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F] cursor-pointer"
            >
              <option value="">All Municipalities</option>
              {municipalities.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#68736D] pointer-events-none" />
          </div>
        </div>

        {/* Grid */}
        {isLoading && tab !== 'businesses' ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Compass className="w-12 h-12 text-[#9CA3AF] mx-auto mb-4" />
            <p className="text-[#68736D]">Nothing found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-4">
            {filtered.map((item) => {
              const isBusiness = !('type' in item)
              const key = isBusiness ? `business-${(item as MapBusiness).id}` : `${(item as ExploreItem).type}-${(item as ExploreItem).id}`
              const name = item.name
              const cover = item.cover_photo
              const rating = isBusiness ? (item as MapBusiness).average_rating ?? null : (item as ExploreItem).rating
              const municipality = isBusiness
                ? (item as MapBusiness).municipality ?? ''
                : (item as ExploreItem).municipality
              const emoji = isBusiness ? TYPE_EMOJI.business : TYPE_EMOJI[item.type]
              const startingPrice = isBusiness ? undefined : (item as ExploreItem).starting_price

              return (
                <div
                  key={key}
                  onClick={() => handleTap(item)}
                  className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden cursor-pointer hover:border-[#087F3F]/40 transition-all group"
                >
                  <div className="aspect-[4/3] bg-[#E9F7EF] overflow-hidden relative">
                    {cover ? (
                      <img src={cover} alt={name} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <span className="text-4xl">{emoji}</span>
                      </div>
                    )}
                    {rating != null && (
                      <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 backdrop-blur-md text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                        <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" /> {rating.toFixed(1)}
                      </div>
                    )}
                  </div>
                  <div className="p-2 h-[80px] flex flex-col justify-center">
                    <h3 className="text-sm font-semibold text-[#17201B] truncate group-hover:text-[#087F3F] transition">{name}</h3>
                    <div className="flex items-center gap-1 mt-0.5 text-[11px] text-[#68736D]">
                      <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{municipality}</span>
                    </div>
                    {!isBusiness && startingPrice != null && startingPrice > 0 && (
                      <p className="text-[11px] font-bold text-[#087F3F] mt-1">From {formatCurrency(startingPrice)}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <footer className="border-t border-ink/5 py-8 text-center text-sm text-ink-soft mt-8">
        &copy; {new Date().getFullYear()} <span className="text-[#16803C] font-semibold">TrackTour</span> — Bansud Tourism Office. All rights reserved.
      </footer>
    </div>
  )
}