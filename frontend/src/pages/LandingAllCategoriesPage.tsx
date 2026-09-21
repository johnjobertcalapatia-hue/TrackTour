import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { formatCurrency } from '@/shared/utils'
import { Star, MapPin, ArrowLeft, Compass } from 'lucide-react'

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

interface MapBusiness {
  id: number
  name: string
  cover_photo?: string | null
  municipality?: string | null
  category?: string | null
  average_rating?: number
  review_count?: number
}

interface ExploreData {
  places: ExploreItem[]
  food: ExploreItem[]
  stays: ExploreItem[]
  municipalities?: { id: number; name: string; businesses_count?: number }[]
  counts?: { places: number; food: number; stays: number }
}

const TYPE_EMOJI: Record<string, string> = { place: '📍', food: '🍴', stay: '🏨', business: '🏪' }

interface Section {
  key: string
  title: string
  count: number
  countLabel: string
  items: (ExploreItem | MapBusiness)[]
}

export default function LandingAllCategoriesPage() {
  const navigate = useNavigate()

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
  const counts = data?.counts ?? { places: 0, food: 0, stays: 0 }

  const sections: Section[] = [
    { key: 'places', title: 'Tourist Spots', count: counts.places, countLabel: 'tourist spots', items: places },
    { key: 'food', title: 'Food', count: counts.food, countLabel: 'restaurants', items: food },
    { key: 'businesses', title: 'Businesses', count: businesses.length, countLabel: 'businesses', items: businesses },
    { key: 'stays', title: 'Resorts', count: counts.stays, countLabel: 'resorts', items: stays },
  ]

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
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201A] mb-8">Explore All Categories</h1>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-12">
            {sections.map((section) => (
              <section key={section.key}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-lg lg:text-xl font-bold text-[#087F3F]">{section.title}</h2>
                  <span className="inline-flex items-center gap-1 bg-white border border-[#E2E8E3] text-[#17201A] text-xs font-semibold px-2.5 py-1 rounded-full">
                    {section.count} {section.countLabel}
                  </span>
                </div>

                {section.items.length === 0 ? (
                  <div className="py-10 text-center bg-white border border-[#E5E9E7] rounded-2xl">
                    <Compass className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" />
                    <p className="text-[#68736D] text-sm">Nothing found in this category yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {section.items.map((item) => {
                      const isBusiness = !('type' in item)
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
                          key={`${section.key}-${item.id}`}
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
              </section>
            ))}
          </div>
        )}
      </div>

      <footer className="border-t border-ink/5 py-8 text-center text-sm text-ink-soft mt-8">
        &copy; {new Date().getFullYear()} <span className="text-[#16803C] font-semibold">TrackTour</span> — Bansud Tourism Office. All rights reserved.
      </footer>
    </div>
  )
}