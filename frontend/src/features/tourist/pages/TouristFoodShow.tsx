import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { formatCurrency, cn, toAssetUrl, categoryName } from '@/shared/utils'
import { ArrowLeft, Star, MapPin, Heart, Share2, Flag, Clock, ShoppingCart, Plus, Minus, UtensilsCrossed } from 'lucide-react'

interface FoodItem {
  id: number
  name: string
  price: number
  image: string | null
  is_available: boolean
  category: string | null
  description?: string | null
}

interface BusinessDetail {
  id: number
  name: string
  business_name?: string
  description: string
  business_description?: string
  category: { id: number; name: string } | string | null
  municipality: { id: number; name: string } | string | null
  address: string
  logo: string | null
  cover_photo: string | null
  rating: number | null
  average_rating?: number | null
  is_open: boolean
  is_accepting_orders: boolean
  availability: string
  open_status: { status: string; label: string }
  schedule_summary: string
  opening_time: string | null
  closing_time: string | null
  is_favorited: boolean
  menu_items: FoodItem[]
  reviews: { id: number; user_name: string; rating: number; comment: string; created_at: string }[]
}

interface BusinessDetailResponse {
  business: BusinessDetail
  avgRating?: number
  reviews?: BusinessDetail['reviews']
  menu_items?: FoodItem[]
}

type DetailTab = 'menu' | 'reviews' | 'photos' | 'info'

const DETAIL_TABS: { key: DetailTab; label: string }[] = [
  { key: 'menu', label: 'Menu' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'photos', label: 'Photos' },
  { key: 'info', label: 'Info' },
]

export default function TouristFoodShow() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [detailTab, setDetailTab] = useState<DetailTab>('menu')
  const [menuFilter, setMenuFilter] = useState('All')
  const [selectedItem, setSelectedItem] = useState<FoodItem | null>(null)
  const [itemQty, setItemQty] = useState(1)
  const [, setCartVersion] = useState(0)

  function getCart(): { id: number; name: string; price: number; image: string | null; business_name: string; business_id: number; business_latitude?: number | null; business_longitude?: number | null; quantity: number }[] {
    try { return JSON.parse(localStorage.getItem('food_cart') || '[]') } catch { return [] }
  }

  function saveCart(cart: { id: number; name: string; price: number; image: string | null; business_name: string; business_id: number; business_latitude?: number | null; business_longitude?: number | null; quantity: number }[]) {
    localStorage.setItem('food_cart', JSON.stringify(cart))
    window.dispatchEvent(new Event('cart-updated'))
    setCartVersion((v) => v + 1)
  }

  const { data, isLoading } = useQuery<BusinessDetailResponse>({
    queryKey: ['tourist-food-business-v2', id],
    queryFn: () => get(`/tourist/explore/${id}`),
  })
  const business = data?.business
  const bizRating = data?.avgRating ?? business?.rating ?? business?.average_rating ?? null
  const bizReviews = data?.reviews ?? business?.reviews ?? []
  const bizCategory = business?.category ? categoryName(business.category) : ''
  const bizMunicipality = business?.municipality && typeof business.municipality === 'object' ? business.municipality.name : (business?.municipality || '')

  const favoriteMutation = useMutation({
    mutationFn: () => post('/tourist/favorites/toggle', { business_id: Number(id) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tourist-food-business-v2', id] }),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!business) return <div className="text-center py-20 text-gray-500">Restaurant not found.</div>

  const menuItems = business.menu_items ?? []
  const accepting = business.is_accepting_orders
  const openStatusLabel = business.open_status?.label ?? (business.is_open ? 'Open now' : 'Closed')
  const categories = ['All', ...new Set(menuItems.map((m) => m.category).filter(Boolean) as string[])]
  const filteredMenu = menuFilter === 'All' ? menuItems : menuItems.filter((m) => m.category === menuFilter)
  const cart = getCart()
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0)
  const cartTotal = cart.reduce((sum, c) => sum + c.price * c.quantity, 0)

  const addToCart = (item: FoodItem, qty: number) => {
    const existingCart = getCart()
    const existing = existingCart.find((c) => c.id === item.id)
    if (existing) {
      existing.quantity += qty
    } else {
      existingCart.push({
        id: item.id,
        name: item.name,
        price: Number(item.price),
        image: item.image,
        business_name: business!.name,
        business_id: business!.id,
        business_latitude: business!.latitude,
        business_longitude: business!.longitude,
        quantity: qty,
      })
    }
    saveCart(existingCart)
    setSelectedItem(null)
    setItemQty(1)
  }

  return (
    <div className="min-h-screen">
      {/* Back button */}
      <div className="sticky top-14 z-30 px-4 py-2 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center">
          <ArrowLeft className="w-5 h-5 text-white" />
        </button>
        <div className="flex gap-2">
          <button onClick={() => favoriteMutation.mutate()} className="w-9 h-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center">
            <Heart className={cn('w-5 h-5', business.is_favorited ? 'fill-red-500 text-red-500' : 'text-white/80')} />
          </button>
          <button className="w-9 h-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center">
            <Share2 className="w-5 h-5 text-white/80" />
          </button>
          <button className="w-9 h-9 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center">
            <Flag className="w-5 h-5 text-white/80" />
          </button>
        </div>
      </div>

      {/* Hero image */}
      <div className="relative h-56 sm:h-72 -mt-14">
        {toAssetUrl(business.cover_photo) ? (
          <img src={toAssetUrl(business.cover_photo)} alt={business.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#087F3F]/30 to-[#17201B] flex items-center justify-center">
            <span className="text-6xl">🍴</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#17201B] via-transparent to-transparent" />
      </div>

      {/* Business info */}
      <div className="px-4 -mt-16 relative z-10">
        <div className="flex items-center gap-3 mb-2">
          {business.logo ? (
            <img src={toAssetUrl(business.logo)} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-white/10" />
          ) : (
            <div className="w-14 h-14 rounded-full bg-white/10 flex items-center justify-center text-xl">🍴</div>
          )}
          <div>
            <h1 className="text-xl font-bold text-white">{business.name}</h1>
            <p className="text-xs text-gray-400">{bizCategory || 'Restaurant'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {bizRating != null && (
            <span className="flex items-center gap-1 text-[#F4B400]">
              <Star className="w-4 h-4 fill-current" /> {Number(bizRating).toFixed(1)}
            </span>
          )}
          <span className={cn('flex items-center gap-1 text-xs font-medium', accepting ? 'text-[#087F3F]' : 'text-[#B91C1C]')}>
            <span className={cn('w-2 h-2 rounded-full', accepting ? 'bg-[#087F3F]' : 'bg-[#B91C1C]')} />
            {accepting ? 'Open Now' : openStatusLabel}
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
          <MapPin className="w-3 h-3" /> {bizMunicipality}
        </div>
      </div>

      {/* Closed banner */}
      {!accepting && (
        <div className="px-4 mt-3">
          <div className="rounded-xl border border-[#B91C1C]/20 bg-[#FEE2E2]/90 px-4 py-3 flex items-start gap-3">
            <span className="flex items-center gap-1.5 text-sm font-bold text-[#B91C1C]">
              <span className="w-2 h-2 rounded-full bg-[#B91C1C]" /> Closed
            </span>
            <p className="text-xs text-[#B91C1C]">{openStatusLabel}. Ordering is currently disabled for this restaurant.</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="px-4 mt-4">
        <div className="flex gap-1 border-b border-white/5">
          {DETAIL_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setDetailTab(t.key)}
              className={cn(
                'px-4 py-2.5 text-sm font-medium transition border-b-2 -mb-px',
                detailTab === t.key ? 'text-[#087F3F] border-[#087F3F]' : 'text-gray-500 border-transparent hover:text-white'
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="px-4 mt-4 pb-24">
        {detailTab === 'menu' && (
          <div className="space-y-4">
            {/* Category chips */}
            {categories.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {categories.map((c) => (
                  <button
                    key={c}
                    onClick={() => setMenuFilter(c)}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-xs font-medium transition whitespace-nowrap border',
                      menuFilter === c ? 'bg-[#087F3F] text-white border-[#087F3F]' : 'bg-white text-[#6B7280] border-[#E5E9E7] hover:border-[#087F3F]/40 hover:text-[#087F3F]'
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}

            {/* Food grid */}
            {filteredMenu.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No menu items available</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredMenu.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden group hover:shadow-lg hover:shadow-[#087F3F]/8 transition"
                  >
                    <div className="aspect-[4/3] overflow-hidden relative">
                      {item.image ? (
                        <img src={toAssetUrl(item.image)} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center">
                          <UtensilsCrossed className="w-8 h-8 text-[#087F3F]/30" />
                        </div>
                      )}
                      {!item.is_available && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <span className="bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">Unavailable</span>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <h3 className="text-sm font-semibold text-[#17201B] truncate">{item.name}</h3>
                      <p className="text-sm font-extrabold text-[#087F3F] mt-0.5">{formatCurrency(item.price)}</p>
                      {item.is_available && accepting && (
                        <button
                          onClick={() => setSelectedItem(item)}
                          className="mt-2 w-full py-1.5 bg-[#087F3F] text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1 hover:bg-[#056B35] transition"
                        >
                          <Plus className="w-3 h-3" /> Add
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {detailTab === 'reviews' && (
          <div className="space-y-3">
            {bizReviews.length === 0 ? (
              <p className="text-center text-gray-500 py-8">No reviews yet</p>
            ) : (
              bizReviews.map((r) => (
                <div key={r.id} className="bg-white border border-[#E5E9E7] rounded-2xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[#17201B]">{r.user_name}</span>
                    <div className="flex items-center gap-1 text-[#F4B400] text-xs">
                      <Star className="w-3 h-3 fill-current" /> {r.rating}
                    </div>
                  </div>
                  <p className="text-sm text-[#68736D]">{r.comment}</p>
                </div>
              ))
            )}
          </div>
        )}

        {detailTab === 'info' && (
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-5 space-y-3">
            <div><p className="text-[10px] text-[#9CA3AF]">About</p><p className="text-sm text-[#68736D]">{business.description || business.business_description || 'No description available yet.'}</p></div>
            {business.address && <div><p className="text-[10px] text-[#9CA3AF]">Address</p><p className="text-sm text-[#17201B]">{business.address}</p></div>}
            {business.opening_time && business.closing_time && (
              <div className="flex items-center gap-2 text-sm text-[#68736D]">
                <Clock className="w-4 h-4 text-[#9CA3AF]" /> {business.opening_time} – {business.closing_time}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cart bar */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 z-[2100] px-4 bottom-[calc(5rem+env(safe-area-inset-bottom))]">
          <button
            onClick={() => navigate('/tourist/food/cart')}
            className="w-full max-w-md mx-auto bg-[#087F3F] text-white py-3.5 rounded-xl font-semibold text-sm flex items-center justify-between px-5 hover:bg-[#056B35] transition shadow-lg shadow-[#087F3F]/20"
          >
            <span className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4" /> {cartCount} item{cartCount !== 1 ? 's' : ''}
            </span>
            <span>{formatCurrency(cartTotal)}</span>
          </button>
        </div>
      )}

      {/* Food item bottom sheet */}
      {selectedItem && (
        <div className="fixed inset-0 z-[2100] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedItem(null)} />
          <div className="relative w-full max-w-lg bg-white rounded-t-3xl shadow-2xl border-t border-[#E5E9E7]">
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 bg-[#E5E9E7] rounded-full" />
            </div>
            <div className="px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              <div className="aspect-video bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] rounded-xl overflow-hidden mb-4">
                {selectedItem.image ? (
                  <img src={toAssetUrl(selectedItem.image)} alt={selectedItem.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <UtensilsCrossed className="w-14 h-14 text-[#087F3F]/30" />
                  </div>
                )}
              </div>
              <h3 className="text-lg font-bold text-[#17201B]">{selectedItem.name}</h3>
              <p className="text-xl font-extrabold text-[#087F3F] mt-1">{formatCurrency(selectedItem.price)}</p>
              {selectedItem.description && <p className="text-sm text-[#6B7280] mt-2">{selectedItem.description}</p>}

              {/* Quantity */}
              <div className="flex items-center justify-between mt-6">
                <span className="text-sm text-[#6B7280]">Quantity</span>
                <div className="flex items-center gap-3">
                  <button onClick={() => setItemQty((q) => Math.max(1, q - 1))} className="w-8 h-8 rounded-lg bg-[#E9F7EF] text-[#087F3F] flex items-center justify-center hover:bg-[#DDF4E6] transition">
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-medium text-[#17201B] w-8 text-center">{itemQty}</span>
                  <button onClick={() => setItemQty((q) => q + 1)} className="w-8 h-8 rounded-lg bg-[#E9F7EF] text-[#087F3F] flex items-center justify-center hover:bg-[#DDF4E6] transition">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <button
                onClick={() => addToCart(selectedItem, itemQty)}
                className="w-full mt-6 py-3.5 bg-[#087F3F] text-white font-semibold text-sm rounded-xl hover:bg-[#056B35] transition flex items-center justify-center gap-2"
              >
                Add to Cart · {formatCurrency(selectedItem.price * itemQty)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
