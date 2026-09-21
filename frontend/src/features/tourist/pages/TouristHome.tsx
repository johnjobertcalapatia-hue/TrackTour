import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { categoryName, toAssetUrl, safeText } from '@/shared/utils'
import {
  MapPin, Star, Heart, UtensilsCrossed, Building2, Compass, Calendar,
  Mountain, Waves, TreePine, Tent,
  Navigation, Utensils, BedDouble,
} from 'lucide-react'
import HeroCarousel from '../components/home/HeroCarousel'
import SectionHeader from '../components/home/SectionHeader'

interface TouristSpot {
  id: number; name: string; description: string; category: unknown; image: string
  address: string; municipality: string; rating: number; review_count: number; entrance_fee: number
}
interface FoodItem {
  id: number; name: string; description: string; category: unknown; image: string
  price: number; business_name: string; business_id: number; rating: number
}
interface Hotel {
  id: number; name: string; description: string; image: string; address: string
  municipality: string; rating: number; review_count: number; price_range: string
}
interface Activity {
  id: number; name: string; description: string; category: unknown; image: string
  price: number; duration: string; business_name: string; rating: number
}
interface Event {
  id: number; name: string; description: string; category: unknown; image: string
  event_date: string; start_time: string; municipality: string; rating: number
}
interface ForYouItem {
  kind: 'food' | 'stay'
  id: number; name: string; subtitle?: string | null
  image?: string | null; price?: number | null; category?: string | null
  distance_km?: number | null; url: string
}
interface ForYouData {
  kind: 'food' | 'stay'; title: string; has_location: boolean; items: ForYouItem[]
}

export default function TouristHome() {
  const user = useAuthStore((s) => s.user)
  const [savedItems, setSavedItems] = useState<Set<string>>(new Set())
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)

  useEffect(() => {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { timeout: 5000, maximumAge: 300000 },
    )
  }, [])

  const { data: forYouData } = useQuery({
    queryKey: ['tourist-for-you', coords?.lat ?? 'default', coords?.lng ?? 'default'],
    queryFn: () => get<ForYouData>('/tourist/for-you', coords ? { params: { lat: coords.lat, lng: coords.lng } } : undefined),
    staleTime: 120_000,
  })

  const { data: spotsData } = useQuery({
    queryKey: ['tourist-spots-home'],
    queryFn: () => get<{ data: TouristSpot[] }>('/tourist/destinations', { params: { limit: 8 } }),
    staleTime: 60_000,
  })
  const { data: foodsData } = useQuery({
    queryKey: ['tourist-foods-home'],
    queryFn: () => get<{ data: FoodItem[] }>('/tourist/food', { params: { limit: 8 } }),
    staleTime: 60_000,
  })
  const { data: exploreData } = useQuery({
    queryKey: ['tourist-explore-home'],
    queryFn: () => get<{ places: unknown[]; food: unknown[]; stays: unknown[] }>('/tourist/explore'),
    staleTime: 60_000,
  })
  const { data: eventsData } = useQuery({
    queryKey: ['tourist-events-home'],
    queryFn: () => get<{ data: Event[] }>('/tourist/events', { params: { limit: 4 } }),
    staleTime: 60_000,
  })

  const spots = spotsData?.data ?? []
  const foods = foodsData?.data ?? []
  const hotels = exploreData?.stays ?? []
  const activities = exploreData?.places ?? []
  const events = eventsData?.data ?? []
  const forYouItems = forYouData?.items ?? []

  const toggleSave = (key: string) => {
    setSavedItems((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const getGreeting = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    return 'Good evening'
  }

  const getSpotIcon = (cat: string) => {
    switch (cat) {
      case 'beach': return <Waves className="w-3.5 h-3.5" />
      case 'mountain': return <Mountain className="w-3.5 h-3.5" />
      case 'waterfall': return <Waves className="w-3.5 h-3.5" />
      case 'nature': return <TreePine className="w-3.5 h-3.5" />
      case 'adventure': return <Tent className="w-3.5 h-3.5" />
      default: return <MapPin className="w-3.5 h-3.5" />
    }
  }

  return (
    <div className="space-y-10 pb-12">
      {/* Hero */}
      <HeroCarousel />

      {/* Personalized Greeting */}
      <div className="px-4 lg:px-0">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-[#17201B]">
          {getGreeting()}, {user?.name?.split(' ')[0] || 'Traveler'} <span className="inline-block animate-[wave_0.4s_ease-in-out_2]">👋</span>
        </h2>
        <p className="mt-2 text-[#68736D] text-lg">Discover something amazing around Bansud.</p>
      </div>

      {/* For You (Near You) */}
      {forYouItems.length > 0 && (
        <section className="px-4 lg:px-0">
          <SectionHeader
            title={forYouData?.title ?? 'For You'}
            subtitle={forYouData?.has_location ? 'Recommended from the businesses nearest to you' : 'Recommended for you'}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {forYouItems.map((item) => (
              <ForYouCard key={`${item.kind}-${item.id}`} item={item} />
            ))}
          </div>
        </section>
      )}

      {/* Recommended Destinations */}
      {spots.length > 0 && (
        <section className="px-4 lg:px-0">
          <SectionHeader title="Trending Tourist Spots" viewAllLink="/tourist/destinations" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {spots.slice(0, 4).map((spot) => (
              <SpotCard key={spot.id} spot={spot} saved={savedItems.has(`spot-${spot.id}`)} onToggleSave={() => toggleSave(`spot-${spot.id}`)} getIcon={getSpotIcon} />
            ))}
          </div>
          {spots.length > 4 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 mt-5">
              {spots.slice(4, 8).map((spot) => (
                <SpotCard key={spot.id} spot={spot} saved={savedItems.has(`spot-${spot.id}`)} onToggleSave={() => toggleSave(`spot-${spot.id}`)} getIcon={getSpotIcon} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Recommended Food */}
      {foods.length > 0 && (
        <section className="px-4 lg:px-0">
          <SectionHeader title="Recommended Food" viewAllLink="/tourist/food" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {foods.slice(0, 4).map((food) => (
              <FoodCard key={food.id} food={food} saved={savedItems.has(`food-${food.id}`)} onToggleSave={() => toggleSave(`food-${food.id}`)} />
            ))}
          </div>
        </section>
      )}

      {/* Places To Stay */}
      {hotels.length > 0 && (
        <section className="px-4 lg:px-0">
          <SectionHeader title="Places To Stay" viewAllLink="/tourist/stays" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {hotels.map((hotel) => (
              <HotelCard key={hotel.id} hotel={hotel} saved={savedItems.has(`hotel-${hotel.id}`)} onToggleSave={() => toggleSave(`hotel-${hotel.id}`)} />
            ))}
          </div>
        </section>
      )}

      {/* Activities */}
      {activities.length > 0 && (
        <section className="px-4 lg:px-0">
          <SectionHeader title="Activities" viewAllLink="/tourist/explore" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {activities.map((act) => (
              <ActivityCard key={act.id} activity={act} saved={savedItems.has(`act-${act.id}`)} onToggleSave={() => toggleSave(`act-${act.id}`)} />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming Events */}
      {events.length > 0 && (
        <section className="px-4 lg:px-0">
          <SectionHeader title="Upcoming Events" viewAllLink="/tourist/events" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
            {events.map((evt) => (
              <EventCard key={evt.id} event={evt} saved={savedItems.has(`evt-${evt.id}`)} onToggleSave={() => toggleSave(`evt-${evt.id}`)} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

/* ─── Card components ────────────────────────────────────────── */

function SpotCard({ spot, saved, onToggleSave, getIcon }: { spot: TouristSpot; saved: boolean; onToggleSave: () => void; getIcon: (c: string) => React.ReactNode }) {
  const img = toAssetUrl(spot.image)
  const spotCategory = categoryName(spot.category)
  return (
    <Link to={`/tourist/destinations/${spot.id}`} className="block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition-all duration-300 group">
      <div className="relative h-52 overflow-hidden">
        {img ? <img src={img} alt={spot.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /> : (
          <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center"><MapPin className="w-12 h-12 text-[#087F3F]/30" /></div>
        )}
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2.5 py-1 bg-white/90 backdrop-blur-sm rounded-full text-xs font-semibold text-[#087F3F]">{getIcon(spotCategory)} {spotCategory}</span>
        <button onClick={(e) => { e.preventDefault(); onToggleSave() }} className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition">
          <Heart className={`w-4 h-4 ${saved ? 'fill-red-500 text-red-500' : 'text-[#68736D]'}`} />
        </button>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-[#17201B] text-lg line-clamp-1">{spot.name}</h3>
        <div className="flex items-center gap-1.5 text-[#68736D] text-sm mt-1"><MapPin className="w-3.5 h-3.5" /> <span className="truncate">{safeText(spot.municipality) || 'Bansud'}</span></div>
        <p className="text-sm text-[#68736D] line-clamp-2 mt-2">{spot.description}</p>
        <div className="flex items-center justify-between mt-3">
          <div className="flex items-center gap-1"><Star className="w-4 h-4 text-[#F4B400] fill-[#F4B400]" /><span className="text-sm font-bold text-[#17201B]">{spot.rating || '4.5'}</span><span className="text-xs text-[#9CA3AF]">({spot.review_count || 0})</span></div>
          {spot.entrance_fee > 0 && <span className="text-sm font-bold text-[#087F3F]">₱{spot.entrance_fee.toLocaleString()}</span>}
        </div>
      </div>
    </Link>
  )
}

function FoodCard({ food, saved, onToggleSave }: { food: FoodItem; saved: boolean; onToggleSave: () => void }) {
  const img = toAssetUrl(food.image)
  return (
    <Link to={`/tourist/food/${food.business_id}`} className="block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition-all duration-300 group">
      <div className="relative h-52 overflow-hidden">
        {img ? <img src={img} alt={food.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /> : (
          <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center"><UtensilsCrossed className="w-12 h-12 text-[#087F3F]/30" /></div>
        )}
        <span className="absolute top-3 left-3 inline-flex items-center px-2.5 py-1 bg-[#087F3F]/90 backdrop-blur-sm rounded-full text-xs font-semibold text-white">{food.category}</span>
        <button onClick={(e) => { e.preventDefault(); onToggleSave() }} className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition">
          <Heart className={`w-4 h-4 ${saved ? 'fill-red-500 text-red-500' : 'text-[#68736D]'}`} />
        </button>
        <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur-sm rounded-lg text-xs font-bold"><Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" /> {food.rating || '4.5'}</span>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-[#17201B] text-lg line-clamp-1">{food.name}</h3>
        <div className="flex items-center gap-1.5 text-[#68736D] text-sm mt-1"><MapPin className="w-3.5 h-3.5" /> <span className="truncate">{food.business_name}</span></div>
        <div className="mt-2"><span className="text-lg font-extrabold text-[#087F3F]">₱{food.price?.toLocaleString() || '0'}</span></div>
      </div>
    </Link>
  )
}

function HotelCard({ hotel, saved, onToggleSave }: { hotel: Hotel; saved: boolean; onToggleSave: () => void }) {
  const img = toAssetUrl(hotel.image)
  return (
    <Link to={`/tourist/stays/${hotel.id}`} className="block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition-all duration-300 group">
      <div className="relative h-52 overflow-hidden">
        {img ? <img src={img} alt={hotel.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /> : (
          <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center"><Building2 className="w-12 h-12 text-[#087F3F]/30" /></div>
        )}
        <button onClick={(e) => { e.preventDefault(); onToggleSave() }} className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition">
          <Heart className={`w-4 h-4 ${saved ? 'fill-red-500 text-red-500' : 'text-[#68736D]'}`} />
        </button>
        <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur-sm rounded-lg text-xs font-bold"><Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" /> {hotel.rating || '4.5'}</span>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-[#17201B] text-lg line-clamp-1">{hotel.name}</h3>
        <div className="flex items-center gap-1.5 text-[#68736D] text-sm mt-1"><MapPin className="w-3.5 h-3.5" /> <span className="truncate">{safeText(hotel.municipality) || 'Bansud'}</span></div>
        <div className="mt-2"><span className="text-lg font-extrabold text-[#087F3F]">{hotel.price_range || 'Contact for price'}</span></div>
      </div>
    </Link>
  )
}

function ActivityCard({ activity, saved, onToggleSave }: { activity: Activity; saved: boolean; onToggleSave: () => void }) {
  const img = toAssetUrl(activity.image)
  return (
    <Link to={`/tourist/explore/${activity.id}`} className="block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition-all duration-300 group">
      <div className="relative h-52 overflow-hidden">
        {img ? <img src={img} alt={activity.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /> : (
          <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center"><Compass className="w-12 h-12 text-[#087F3F]/30" /></div>
        )}
        <span className="absolute top-3 left-3 inline-flex items-center px-2.5 py-1 bg-[#087F3F]/90 backdrop-blur-sm rounded-full text-xs font-semibold text-white capitalize">{activity.category?.replace('_', ' ')}</span>
        <button onClick={(e) => { e.preventDefault(); onToggleSave() }} className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition">
          <Heart className={`w-4 h-4 ${saved ? 'fill-red-500 text-red-500' : 'text-[#68736D]'}`} />
        </button>
      </div>
      <div className="p-4">
        <h3 className="font-bold text-[#17201B] text-lg line-clamp-1">{activity.name}</h3>
        <div className="flex items-center gap-1.5 text-[#68736D] text-sm mt-1"><MapPin className="w-3.5 h-3.5" /> <span className="truncate">{activity.business_name || 'Bansud'}</span></div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-lg font-extrabold text-[#087F3F]">₱{activity.price?.toLocaleString() || '0'}</span>
          <span className="text-xs text-[#68736D]">/ person</span>
        </div>
      </div>
    </Link>
  )
}

function EventCard({ event, saved, onToggleSave }: { event: Event; saved: boolean; onToggleSave: () => void }) {
  const img = toAssetUrl(event.image)
  const dateObj = event.event_date ? new Date(event.event_date) : null
  return (
    <Link to={`/tourist/events/${event.id}`} className="block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition-all duration-300 group">
      <div className="relative h-52 overflow-hidden">
        {img ? <img src={img} alt={event.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /> : (
          <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center"><Calendar className="w-12 h-12 text-[#087F3F]/30" /></div>
        )}
        <span className="absolute top-3 left-3 inline-flex items-center px-2.5 py-1 bg-[#087F3F]/90 backdrop-blur-sm rounded-full text-xs font-semibold text-white capitalize">{event.category?.replace('_', ' ')}</span>
        <button onClick={(e) => { e.preventDefault(); onToggleSave() }} className="absolute top-3 right-3 p-2 bg-white/90 backdrop-blur-sm rounded-full hover:bg-white transition">
          <Heart className={`w-4 h-4 ${saved ? 'fill-red-500 text-red-500' : 'text-[#68736D]'}`} />
        </button>
      </div>
      <div className="p-4">
        {dateObj && (
          <div className="flex items-center gap-3 mb-2">
            <div className="flex flex-col items-center justify-center w-12 h-12 bg-[#087F3F] rounded-xl text-white shrink-0">
              <span className="text-[9px] font-bold uppercase">{dateObj.toLocaleDateString('en-US', { month: 'short' })}</span>
              <span className="text-lg font-extrabold leading-none">{dateObj.getDate()}</span>
            </div>
            <div>
              <h3 className="font-bold text-[#17201B] line-clamp-1">{event.name}</h3>
              {event.start_time && <p className="text-xs text-[#68736D] mt-0.5">{event.start_time}</p>}
            </div>
          </div>
        )}
        {!dateObj && <h3 className="font-bold text-[#17201B] text-lg line-clamp-1">{event.name}</h3>}
        <div className="flex items-center gap-1.5 text-[#68736D] text-sm"><MapPin className="w-3.5 h-3.5" /> <span className="truncate">{safeText(event.municipality) || 'Bansud'}</span></div>
      </div>
    </Link>
  )
}

function ForYouCard({ item }: { item: ForYouItem }) {
  const isFood = item.kind === 'food'
  const img = toAssetUrl(item.image ?? '')
  return (
    <Link to={item.url} className="block bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition-all duration-300 group">
      <div className="relative h-52 overflow-hidden">
        {img ? <img src={img} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" /> : (
          <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center">
            {isFood ? <Utensils className="w-12 h-12 text-[#087F3F]/30" /> : <BedDouble className="w-12 h-12 text-[#087F3F]/30" />}
          </div>
        )}
        <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2.5 py-1 bg-[#087F3F]/90 backdrop-blur-sm rounded-full text-xs font-semibold text-white capitalize">
          {isFood ? <UtensilsCrossed className="w-3 h-3" /> : <BedDouble className="w-3 h-3" />} {categoryName(item.category) || (isFood ? 'Food' : 'Stay')}
        </span>
        {item.distance_km != null && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 px-2 py-1 bg-white/90 backdrop-blur-sm rounded-lg text-[11px] font-bold text-[#17201B]">
            <Navigation className="w-3 h-3 text-[#087F3F]" /> {item.distance_km} km
          </span>
        )}
      </div>
      <div className="p-4">
        <h3 className="font-bold text-[#17201B] text-lg line-clamp-1">{item.name}</h3>
        <div className="flex items-center gap-1.5 text-[#68736D] text-sm mt-1">
          <MapPin className="w-3.5 h-3.5" /> <span className="truncate">{safeText(item.subtitle) || 'Bansud'}</span>
        </div>
        {isFood && item.price != null && (
          <div className="mt-2"><span className="text-lg font-extrabold text-[#087F3F]">₱{item.price.toLocaleString()}</span></div>
        )}
      </div>
    </Link>
  )
}
