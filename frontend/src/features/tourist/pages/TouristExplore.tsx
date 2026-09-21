import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { Star, MapPin, Compass } from 'lucide-react'
import { formatCurrency, cn, toAssetUrl } from '@/shared/utils'

type Tab = 'all' | 'places' | 'food' | 'stays'

interface ExploreItem {
  id: number
  name: string
  cover_photo: string | null
  rating: number | null
  municipality: string
  type: 'place' | 'food' | 'stay'
  starting_price?: number
}

interface ExploreData {
  places: ExploreItem[]
  food: ExploreItem[]
  stays: ExploreItem[]
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'places', label: 'Places' },
  { key: 'food', label: 'Food' },
  { key: 'stays', label: 'Stays' },
]

const TYPE_EMOJI: Record<string, string> = { place: '📍', food: '🍴', stay: '🏨' }

function initialTabFromParams(param: string | null): Tab {
  return param === 'places' || param === 'food' || param === 'stays' ? param : 'all'
}

export default function TouristExplore() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => initialTabFromParams(searchParams.get('tab')))

  useEffect(() => {
    setTab(initialTabFromParams(searchParams.get('tab')))
  }, [searchParams])

  const handleTabChange = (key: Tab) => {
    setTab(key)
    setSearchParams(key === 'all' ? {} : { tab: key }, { replace: true })
  }

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-explore-v2'],
    queryFn: () => get<ExploreData>('/tourist/explore'),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const places = data?.places ?? []
  const food = data?.food ?? []
  const stays = data?.stays ?? []

  let filtered: ExploreItem[] = []
  if (tab === 'all') filtered = [...places, ...food, ...stays]
  else if (tab === 'places') filtered = places
  else if (tab === 'food') filtered = food
  else filtered = stays

  const handleTap = (item: ExploreItem) => {
    if (item.type === 'place') navigate(`/tourist/destinations/${item.id}`)
    else if (item.type === 'food') navigate(`/tourist/food/${item.id}`)
    else navigate(`/tourist/stays/${item.id}`)
  }

  return (
    <div className="space-y-4 px-4 pt-4">
      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={cn(
              'px-4 py-2 rounded-full text-sm font-medium transition whitespace-nowrap',
              tab === t.key
                ? 'bg-[#087F3F] text-white'
                : 'bg-white border border-[#E5E9E7] text-[#68736D] hover:text-[#17201B] hover:border-[#087F3F]/40'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
                <div className="py-16 text-center">
          <Compass className="w-12 h-12 text-[#9CA3AF] mx-auto mb-4" />
          <p className="text-[#68736D]">Nothing found</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pb-4">
          {filtered.map((item) => (
            <div
              key={`${item.type}-${item.id}`}
              onClick={() => handleTap(item)}
              className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden cursor-pointer hover:border-[#087F3F]/40 transition-all group"
            >
              <div className="aspect-[4/3] bg-[#E9F7EF] overflow-hidden relative">
                {item.cover_photo ? (
                  <img src={toAssetUrl(item.cover_photo)} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-4xl">{TYPE_EMOJI[item.type]}</span>
                  </div>
                )}
                {item.rating != null && (
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/60 backdrop-blur-md text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-md">
                    <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" /> {item.rating.toFixed(1)}
                  </div>
                )}
              </div>
              <div className="p-3">
                <h3 className="text-sm font-semibold text-[#17201B] truncate group-hover:text-[#087F3F] transition">{item.name}</h3>
                <div className="flex items-center gap-1 mt-1 text-xs text-[#68736D]">
                  <MapPin className="w-3 h-3" /> {item.municipality}
                </div>
                {item.type === 'stay' && item.starting_price != null && item.starting_price > 0 && (
                  <p className="text-xs font-bold text-[#087F3F] mt-1">From {formatCurrency(item.starting_price)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
