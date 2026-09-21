import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import {
  Star, MapPin, Heart, Search, UtensilsCrossed, Clock, ArrowRight,
} from 'lucide-react'
import { formatCurrency, cn } from '@/shared/utils'

interface DashboardData {
  foodCategories: { id: number; name: string; slug: string; icon: string }[]
  nearbyFoodBusinesses: BusinessCard[]
  popularFood: BusinessCard[]
  recentOrders: RecentOrder[]
  savedIds: number[]
}

interface RecentOrder {
  id: number
  order_number: string
  business_name: string
  total: number
  status: string
  created_at: string
}

interface BusinessCard {
  id: number
  name: string
  category: unknown
  cover_photo: string
  avg_rating: number | null
  is_open: boolean
  distance_km?: number | null
  address?: string | null
  delivery_available?: boolean
}

const HERO_MS = 5000

function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={cn('flex items-center gap-0.5 text-[#F4B400]', className)} aria-label={`${rating.toFixed(1)} out of 5 stars`}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star key={i} className={cn('w-3 h-3', i < Math.round(rating) ? 'fill-current' : 'text-gray-300 fill-current')} />
      ))}
    </span>
  )
}

function OpenBadge({ open }: { open: boolean }) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-semibold',
      open ? 'bg-[#087F3F] text-white' : 'bg-gray-200 text-[#6B7280]'
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', open ? 'bg-white animate-pulse' : 'bg-gray-400')} />
      {open ? 'Open' : 'Closed'}
    </span>
  )
}

function FavoriteButton({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={active ? 'Remove from favorites' : 'Add to favorites'}
      className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/80 backdrop-blur-md border border-[#E5E9E7] flex items-center justify-center transition hover:scale-110 active:scale-95"
    >
      <Heart className={cn('w-4 h-4 transition', active ? 'fill-[#F4B400] text-[#F4B400]' : 'text-[#6B7280]')} />
    </button>
  )
}

function distanceText(d?: number | null) {
  if (d == null) return null
  return `${d.toFixed(1)} km`
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-xl lg:text-2xl font-bold text-[#17201B]">{title}</h2>
        {subtitle && <p className="text-sm text-[#6B7280] mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

function SeeAllButton({ onSeeAll }: { onSeeAll: () => void }) {
  return (
    <button onClick={onSeeAll} className="text-xs font-semibold text-[#087F3F] hover:text-[#F4B400] transition inline-flex items-center gap-1">
      See all <ArrowRight className="w-3 h-3" />
    </button>
  )
}

function FoodBusinessCard({ business, saved, onOpen, onToggleFavorite }: { business: BusinessCard; saved: boolean; onOpen: () => void; onToggleFavorite: () => void }) {
  const rating = business.avg_rating ?? 0
  const dist = distanceText(business.distance_km)
  return (
    <div
      onClick={onOpen}
      className="group bg-white rounded-[20px] border border-[#E5E9E7] overflow-hidden cursor-pointer hover:scale-[1.02] hover:shadow-2xl hover:shadow-black/10 hover:border-[#087F3F]/40 transition-all duration-200"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-[#E5E9E7]">
        <img src={business.cover_photo || '/assets/placeholder.svg'} alt={business.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
        <FavoriteButton active={saved} onClick={onToggleFavorite} />
        {rating > 0 && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/55 backdrop-blur-md text-white text-[11px] font-semibold px-1.5 py-0.5 rounded-lg">
            <Star className="w-3 h-3 text-[#F4B400] fill-current" /> {rating.toFixed(1)}
          </div>
        )}
        {business.delivery_available && (
          <span className="absolute top-2 left-2 bg-[#087F3F] text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
            DELIVERY
          </span>
        )}
      </div>
      <div className="p-3">
        <h3 className="font-semibold text-sm text-[#17201B] truncate">{business.name}</h3>
        <div className="flex items-center justify-between mt-1.5">
          <span className="text-xs text-[#6B7280] truncate flex items-center gap-1">
            <MapPin className="w-3 h-3 text-[#087F3F] shrink-0" /> {business.address || 'Bansud'}
          </span>
          <OpenBadge open={business.is_open} />
        </div>
        {dist && <p className="mt-1 text-[11px] text-[#087F3F] font-medium">{dist} away</p>}
      </div>
    </div>
  )
}

function HeroBanner({ slides, onPrimary }: {
  slides: { image?: string; name: string }[]
  onPrimary: () => void
}) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = Math.min(slides.length, 5)

  const go = useCallback((i: number) => {
    if (count === 0) return
    setIndex(((i % count) + count) % count)
  }, [count])

  useEffect(() => {
    if (paused || count <= 1) return
    const t = setInterval(() => go(index + 1), HERO_MS)
    return () => clearInterval(t)
  }, [paused, count, go, index])

  return (
    <section className="relative overflow-hidden rounded-[24px] group" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="relative h-[260px] sm:h-[300px] lg:h-[340px]">
        {slides.slice(0, count).map((s, i) => (
          <div key={i} className={cn('absolute inset-0 transition-opacity duration-700 ease-in-out', i === index ? 'opacity-100' : 'opacity-0')} aria-hidden={i !== index}>
            <img src={s.image || '/assets/placeholder.svg'} alt={s.name} loading={i === 0 ? 'eager' : 'lazy'} className={cn('w-full h-full object-cover', i === index && 'animate-[ken-burns_9s_ease-out_forwards]')} />
            <div className="absolute inset-0 bg-gradient-to-t from-[#17201B] via-[#17201B]/55 to-[#17201B]/20" />
          </div>
        ))}

        <div className="relative z-10 h-full flex flex-col justify-end px-5 sm:px-8 pb-10 lg:justify-center lg:pb-0">
          <div className="max-w-2xl" key={index}>
            <span className="inline-flex items-center gap-2 text-[11px] sm:text-xs font-bold tracking-widest text-[#F4B400] uppercase bg-black/30 border border-[#E5E9E7] rounded-full px-3 py-1 backdrop-blur w-fit">
              <UtensilsCrossed className="w-3.5 h-3.5" /> Craving something?
            </span>
            <h1 className="mt-3 text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white leading-[1.05] drop-shadow-lg animate-[fade-in-up_0.5s_ease-out]">Food & Dining</h1>
            <p className="mt-2 text-sm sm:text-base text-[#6B7280] max-w-md animate-[fade-in-up_0.5s_ease-out_0.08s_both]">Restaurants, cafes, and local delicacies ready for you to try.</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button onClick={onPrimary} className="inline-flex items-center gap-2 bg-[#087F3F] hover:bg-[#056B35] text-white px-5 py-3 rounded-2xl font-semibold transition hover:scale-105 active:scale-95 text-sm shadow-lg shadow-[#087F3F]/30">
                <Search className="w-4 h-4" /> Order Now
              </button>
            </div>
          </div>
        </div>

        {count > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5">
            {Array.from({ length: count }).map((_, i) => (
              <button key={i} onClick={() => go(i)} aria-label={`Go to slide ${i + 1}`} className={cn('h-1.5 rounded-full transition-all duration-300', i === index ? 'w-6 bg-[#F4B400]' : 'w-1.5 bg-white/40 hover:bg-white/70')} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export default function TouristDashboard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-dashboard'],
    queryFn: () => get<DashboardData>('/tourist/dashboard'),
  })

  const favoriteMutation = useMutation({
    mutationFn: (businessId: number) => post('/tourist/favorites/toggle', { business_id: businessId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tourist-dashboard'] }),
  })

  if (isLoading) return <DashboardSkeleton />
  if (!data) return null

  const {
    foodCategories = [], nearbyFoodBusinesses = [], popularFood = [],
    recentOrders = [], savedIds = [],
  } = data

  const navigateId = (id: number) => navigate(`/tourist/business/${id}`)
  const toggleFav = (id: number) => () => favoriteMutation.mutate(id)

  const heroSlides = (() => {
    const base = [...popularFood, ...nearbyFoodBusinesses]
    const slides = base.filter((b) => b.cover_photo).slice(0, 5).map((b) => ({ image: b.cover_photo, name: b.name }))
    if (slides.length === 0) slides.push({ image: '', name: 'Food & Dining' })
    return slides
  })()

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <div className="mt-4">
        <HeroBanner
          slides={heroSlides}
          onPrimary={() => navigate('/tourist/food')}
        />
      </div>

      <div className="py-8 space-y-12">
        {/* Food Categories */}
        {foodCategories.length > 0 && (
          <section>
            <SectionHeader title="Food Categories" subtitle="Browse by cuisine type" />
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
              {foodCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => navigate(`/tourist/food?category=${cat.slug}`)}
                  className="shrink-0 bg-white border border-[#E5E9E7] rounded-2xl px-5 py-3 flex items-center gap-2 hover:border-[#087F3F]/40 hover:shadow-md transition-all"
                >
                  <span className="text-lg">{cat.icon || '🍽️'}</span>
                  <span className="text-sm font-medium text-[#17201B]">{cat.name}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Nearby Food Businesses */}
        {nearbyFoodBusinesses.length > 0 && (
          <section>
            <SectionHeader title="Nearby Food" subtitle="Food businesses close to you" action={<SeeAllButton onSeeAll={() => navigate('/tourist/food')} />} />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {nearbyFoodBusinesses.slice(0, 5).map((b) => (
                <FoodBusinessCard key={b.id} business={b} saved={savedIds.includes(b.id)} onOpen={() => navigateId(b.id)} onToggleFavorite={toggleFav(b.id)} />
              ))}
            </div>
          </section>
        )}

        {/* Popular Food */}
        {popularFood.length > 0 && (
          <section>
            <SectionHeader title="Popular Food" subtitle="Highly rated food spots" action={<SeeAllButton onSeeAll={() => navigate('/tourist/food')} />} />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {popularFood.slice(0, 5).map((b) => (
                <FoodBusinessCard key={b.id} business={b} saved={savedIds.includes(b.id)} onOpen={() => navigateId(b.id)} onToggleFavorite={toggleFav(b.id)} />
              ))}
            </div>
          </section>
        )}

        {/* Recent Orders */}
        {recentOrders.length > 0 && (
          <section>
            <SectionHeader title="Recent Orders" subtitle="Your latest food orders" action={<SeeAllButton onSeeAll={() => navigate('/tourist/history')} />} />
            <div className="space-y-3">
              {recentOrders.slice(0, 3).map((order) => (
                <div
                  key={order.id}
                  onClick={() => navigate(`/tourist/food/order/${order.id}/status`)}
                  className="bg-white border border-[#E5E9E7] rounded-2xl p-4 flex items-center justify-between cursor-pointer hover:shadow-md hover:border-[#087F3F]/40 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-[#087F3F]/10 rounded-xl flex items-center justify-center shrink-0">
                      <UtensilsCrossed className="w-5 h-5 text-[#087F3F]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#17201B] truncate">{order.business_name}</p>
                      <p className="text-xs text-[#6B7280]">#{order.order_number}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-bold text-[#17201B]">{formatCurrency(order.total)}</p>
                    <span className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full font-semibold',
                      order.status === 'delivered' ? 'bg-[#087F3F]/10 text-[#087F3F]' :
                      order.status === 'cancelled' ? 'bg-red-100 text-red-600' :
                      'bg-[#F4B400]/10 text-[#F4B400]'
                    )}>
                      {order.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Empty State */}
        {nearbyFoodBusinesses.length === 0 && popularFood.length === 0 && (
          <section className="text-center py-12">
            <UtensilsCrossed className="w-16 h-16 text-[#6B7280]/30 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-[#17201B] mb-2">Welcome to TrackTour!</h3>
            <p className="text-sm text-[#6B7280] mb-6">Discover delicious food from local businesses.</p>
            <button onClick={() => navigate('/tourist/food')} className="inline-flex items-center gap-2 bg-[#087F3F] hover:bg-[#056B35] text-white px-6 py-3 rounded-2xl font-semibold transition hover:scale-105 active:scale-95 text-sm">
              <Search className="w-4 h-4" /> Browse Food
            </button>
          </section>
        )}
      </div>
    </div>
  )
}
