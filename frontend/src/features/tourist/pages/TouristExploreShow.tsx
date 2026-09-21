import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatCurrency, formatDateTime, isNewItem, categoryName, toAssetUrl } from '@/shared/utils'
import { ArrowLeft, Star, MapPin, Phone, Clock, Heart, UtensilsCrossed, Plus, Minus, ShoppingCart, X } from 'lucide-react'

interface Variation {
  id: number
  name: string
  price: number
  is_available: boolean
}

interface MenuItem {
  id: number
  name: string
  description?: string
  price: number
  image: string | null
  is_available: boolean
  has_variations: boolean
  bestseller?: boolean
  created_at?: string
  variations?: Variation[]
}

interface CartItem {
  id: number
  name: string
  price: number
  image: string | null
  business_name: string
  business_id: number
  quantity: number
  variation?: string
}

interface BusinessDetail {
  id: number
  name: string
  business_name?: string
  description: string
  business_description?: string
  category: unknown
  municipality: { name: string } | null
  barangay: { name: string } | null
  address: string
  phone: string
  contact_number?: string
  email: string
  logo: string | null
  cover_photo: string | null
  rating: number | null
  is_open: boolean
  is_accepting_orders?: boolean
  status: string
  opening_time: string | null
  closing_time: string | null
  is_favorited: boolean
  menu_items: MenuItem[]
  reviews: { id: number; user_name: string; rating: number; comment: string; created_at: string }[]
}

interface BusinessDetailResponse {
  business: BusinessDetail
  reviews?: BusinessDetail['reviews']
  avgRating?: number
  reviewsCount?: number
  promotions?: { id: number; name: string; description?: string; type?: string; value?: string }[]
  menu_items?: MenuItem[]
}

function getCart(): CartItem[] {
  try { return JSON.parse(localStorage.getItem('food_cart') || '[]') } catch { return [] }
}

function saveCart(cart: CartItem[]) {
  localStorage.setItem('food_cart', JSON.stringify(cart))
  window.dispatchEvent(new Event('cart-updated'))
}

function FoodDetailModal({ item, business, onClose, onAdd, accepting }: {
  item: MenuItem
  business: BusinessDetail
  onClose: () => void
  onAdd: (item: MenuItem, qty: number, variation?: Variation) => void
  accepting: boolean
}) {
  const [qty, setQty] = useState(1)
  const [selectedVariation, setSelectedVariation] = useState<Variation | null>(
    item.has_variations && item.variations?.length ? item.variations[0] : null
  )

  const price = selectedVariation?.price ?? item.price
  const variations = item.variations ?? []

  return (
    <div className="fixed inset-0 z-[3000] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[90vh] overflow-y-auto z-10">
        {/* Image */}
        <div className="relative h-56 sm:h-64">
          {item.image ? (
            <img src={toAssetUrl(item.image)} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center">
              <UtensilsCrossed className="w-12 h-12 text-[#087F3F]/30" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          <button onClick={onClose} className="absolute top-3 right-3 p-2 bg-white/80 backdrop-blur-sm rounded-full hover:bg-white transition">
            <X className="w-4 h-4 text-[#17201B]" />
          </button>
          <div className="absolute bottom-3 left-3 right-3">
            <div className="flex items-center gap-2 mb-1">
              {item.bestseller && (
                <span className="px-2 py-0.5 bg-[#F4B400] text-[#17201B] text-[10px] font-bold rounded-full">BESTSELLER</span>
              )}
              {isNewItem(item.created_at) && (
                <span className="px-2 py-0.5 bg-[#087F3F] text-white text-[10px] font-bold rounded-full">NEW</span>
              )}
            </div>
            <h2 className="text-xl font-bold text-white">{item.name}</h2>
            <p className="text-lg font-bold text-[#86EFAC]">{formatCurrency(price)}</p>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Description */}
          {item.description && (
            <p className="text-sm text-[#6B7280] leading-relaxed">{item.description}</p>
          )}

          {/* Variations */}
          {item.has_variations && variations.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-[#17201B] mb-3">Choose a variation</p>
              <div className="space-y-2">
                {variations.filter((v) => v.is_available).map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariation(v)}
                    className={`w-full flex items-center justify-between p-3 rounded-xl border-2 transition text-left ${
                      selectedVariation?.id === v.id
                        ? 'border-[#087F3F] bg-[#E9F7EF]'
                        : 'border-[#E5E9E7] hover:border-[#087F3F]/40'
                    }`}
                  >
                    <span className="text-sm font-medium text-[#17201B]">{v.name}</span>
                    <span className="text-sm font-semibold text-[#087F3F]">{formatCurrency(v.price)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Quantity */}
          <div>
            <p className="text-sm font-semibold text-[#17201B] mb-3">Quantity</p>
            <div className="flex items-center gap-4">
              <button onClick={() => setQty(Math.max(1, qty - 1))} className="w-10 h-10 rounded-xl bg-[#E5E9E7] flex items-center justify-center hover:bg-[#d1d5db] transition">
                <Minus className="w-4 h-4 text-[#17201B]" />
              </button>
              <span className="text-lg font-bold text-[#17201B] w-8 text-center">{qty}</span>
              <button onClick={() => setQty(qty + 1)} className="w-10 h-10 rounded-xl bg-[#087F3F] flex items-center justify-center hover:bg-[#056B35] transition">
                <Plus className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>

          {/* Add to Cart */}
          <button
            onClick={() => { onAdd(item, qty, selectedVariation ?? undefined); onClose() }}
            disabled={!accepting}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#087F3F] hover:bg-[#056B35] text-white rounded-xl font-semibold transition disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            <ShoppingCart className="w-4 h-4" />
            {accepting ? `Add to Cart — ${formatCurrency(price * qty)}` : 'Restaurant is closed'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function TouristExploreShow() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [cart, setCart] = useState<CartItem[]>(getCart)
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null)

  useEffect(() => {
    const sync = () => setCart(getCart())
    window.addEventListener('cart-updated', sync)
    return () => window.removeEventListener('cart-updated', sync)
  }, [])

  const { data, isLoading } = useQuery<BusinessDetailResponse>({
    queryKey: ['tourist-explore', id],
    queryFn: () => get(`/tourist/explore/${id}`),
  })

  const favoriteMutation = useMutation({
    mutationFn: () => post('/tourist/favorites/toggle', { business_id: Number(id) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tourist-explore', id] }),
  })

  const addToCart = (item: MenuItem, qty = 1, variation?: Variation) => {
    const current = getCart()
    const cartKey = variation ? `${item.id}-${variation.id}` : `${item.id}`
    const existing = current.find((c) => {
      const cKey = c.variation ? `${c.id}-${c.variation}` : `${c.id}`
      return cKey === cartKey
    })

    const price = variation?.price ?? item.price
    let updated: CartItem[]

    if (existing) {
      updated = current.map((c) => {
        const cKey = c.variation ? `${c.id}-${c.variation}` : `${c.id}`
        return cKey === cartKey ? { ...c, quantity: c.quantity + qty } : c
      })
    } else {
      updated = [...current, {
        id: item.id,
        name: variation ? `${item.name} (${variation.name})` : item.name,
        price,
        image: item.image,
        business_name: data?.business?.name || '',
        business_id: data?.business?.id ?? Number(id),
        quantity: qty,
        variation: variation?.name,
      }]
    }
    saveCart(updated)
    setCart(updated)
  }

  const getItemQty = (itemId: number) => cart.filter((c) => c.id === itemId).reduce((s, c) => s + c.quantity, 0)

  const cartCount = cart.reduce((s, c) => s + c.quantity, 0)
  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0)

  if (isLoading) return <DashboardSkeleton />
  if (!data?.business) return <div className="text-center py-20 text-[#6B7280]">Business not found.</div>

  const business = data.business
  const accepting = business.is_accepting_orders ?? business.is_open
  const bizName = business.name || business.business_name || ''
  const bizCover = business.cover_photo ? toAssetUrl(business.cover_photo) : ''
  const bizLogo = business.logo ? toAssetUrl(business.logo) : ''
  const description = business.description || business.business_description || ''
  const phone = business.phone || business.contact_number || ''
  const reviews = data.reviews ?? business.reviews ?? []
  const avgRating = data.avgRating ?? business.rating ?? 0
  const promotions = data.promotions ?? business.promotions ?? []

  const menuItems = business.menu_items?.length ? business.menu_items : (data.menu_items ?? [])

  return (
    <div className="pb-24">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#17201B] mb-6 transition">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="relative rounded-2xl overflow-hidden mb-6 h-48 sm:h-64">
        {bizCover ? (
          <img src={bizCover} alt={bizName} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#087F3F] to-[#17201B]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        {bizLogo && (
          <div className="absolute bottom-4 left-4 w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden ring-4 ring-white/80 shadow-lg bg-white">
            <img src={bizLogo} alt={bizName} className="w-full h-full object-cover" />
          </div>
        )}
        <div className={`absolute bottom-4 left-4 right-4 flex items-end justify-between ${bizLogo ? 'pl-20 sm:pl-24' : ''}`}>
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-white">{bizName}</h1>
            <p className="text-sm text-gray-200 mt-1">{categoryName(business.category)}</p>
          </div>
          <button
            onClick={() => favoriteMutation.mutate()}
            className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center transition hover:bg-white/30"
          >
            <Heart className={`w-5 h-5 ${business.is_favorited ? 'fill-red-500 text-red-500' : 'text-white'}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-[#17201B] mb-3">About</h2>
            <p className="text-sm text-[#6B7280] leading-relaxed">{description || 'No description available yet.'}</p>
          </div>

          {promotions.length > 0 && (
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-[#17201B] mb-4">Promotions</h2>
              <div className="space-y-3">
                {promotions.map((p) => (
                  <div key={p.id} className="p-4 rounded-xl bg-[#FFF7D6] border border-[#F4B400]/30">
                    <p className="text-sm font-semibold text-[#17201B]">{p.name}</p>
                    {p.description && <p className="text-sm text-[#6B7280] mt-1">{p.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {reviews.length > 0 && (
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6">
              <h2 className="text-lg font-semibold text-[#17201B] mb-4">Reviews</h2>
              <div className="space-y-4">
                {reviews.map((r) => (
                  <div key={r.id} className="p-4 rounded-xl bg-[#F8FAF9] border border-[#E5E9E7]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-[#17201B]">{r.user_name}</span>
                      <div className="flex items-center gap-1 text-amber-400 text-xs">
                        <Star className="w-3 h-3 fill-current" /> {r.rating}
                      </div>
                    </div>
                    <p className="text-sm text-[#6B7280]">{r.comment}</p>
                    <p className="text-xs text-[#9CA3AF] mt-2">{formatDateTime(r.created_at)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <StatusBadge status={business.status} size="md" />
              <span className={`text-sm font-medium ${accepting ? 'text-[#087F3F]' : 'text-[#B91C1C]'}`}>
                {accepting ? 'Open Now' : 'Closed'}
              </span>
            </div>

            {!accepting && (
              <div className="rounded-xl border border-[#B91C1C]/20 bg-[#FEE2E2]/80 px-3 py-2.5">
                <p className="text-xs font-semibold text-[#B91C1C]">This restaurant is currently closed and not accepting orders.</p>
              </div>
            )}

            {avgRating > 0 && (
              <div className="flex items-center gap-2 text-sm text-[#6B7280]">
                <Star className="w-4 h-4 text-amber-400 fill-current" /> {Number(avgRating).toFixed(1)} rating
              </div>
            )}

            <div className="flex items-start gap-2 text-sm text-[#6B7280]">
              <MapPin className="w-4 h-4 text-[#9CA3AF] mt-0.5 shrink-0" />
              <div>
                <p>{business.address || 'Bansud, Oriental Mindoro'}</p>
                <p className="text-xs text-[#9CA3AF]">
                  {[business.barangay?.name, business.municipality?.name].filter(Boolean).join(', ') || 'Bansud, Oriental Mindoro'}
                </p>
              </div>
            </div>

            {phone && (
              <div className="flex items-center gap-2 text-sm text-[#6B7280]">
                <Phone className="w-4 h-4 text-[#9CA3AF]" /> {phone}
              </div>
            )}

            {business.opening_time && business.closing_time && (
              <div className="flex items-center gap-2 text-sm text-[#6B7280]">
                <Clock className="w-4 h-4 text-[#9CA3AF]" /> {business.opening_time} – {business.closing_time}
              </div>
            )}
          </div>
        </div>
      </div>

      {menuItems.length > 0 && (
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 mt-8">
          <h2 className="text-lg font-semibold text-[#17201B] mb-4">Menu</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {menuItems.map((item: MenuItem) => {
              const qty = getItemQty(item.id)
              return (
                <div key={item.id} className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition group cursor-pointer" onClick={() => item.is_available && accepting && setDetailItem(item)}>
                  <div className="relative aspect-[4/3] overflow-hidden">
                    {item.image ? (
                      <img src={toAssetUrl(item.image)} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center">
                        <UtensilsCrossed className="w-8 h-8 text-[#087F3F]/30" />
                      </div>
                    )}
                    {item.has_variations && item.variations && item.variations.length > 0 && (
                      <div className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm text-[#087F3F] text-[10px] font-bold px-2 py-0.5 rounded-full">
                        {item.variations.length} options
                      </div>
                    )}
                    {isNewItem(item.created_at) && (
                      <div className="absolute top-2 left-2 bg-[#087F3F] text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        NEW
                      </div>
                    )}
                    {!item.is_available && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <span className="text-xs font-semibold text-white bg-black/60 px-3 py-1 rounded-full">Unavailable</span>
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <p className="text-sm font-semibold text-[#17201B] truncate">{item.name}</p>
                    <p className="text-sm font-extrabold text-[#087F3F] mt-1">
                      {item.has_variations && item.variations?.length
                        ? `${formatCurrency(Math.min(...item.variations.filter(v => v.is_available).map(v => v.price)))} – ${formatCurrency(Math.max(...item.variations.filter(v => v.is_available).map(v => v.price)))}`
                        : formatCurrency(item.price)
                      }
                    </p>
                    {item.is_available && !item.has_variations && (
                      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                        {qty === 0 ? (
                          <button
                            onClick={() => addToCart(item)}
                            disabled={!accepting}
                            className="w-full flex items-center justify-center gap-1.5 py-2 bg-[#087F3F] hover:bg-[#056B35] text-white text-xs font-semibold rounded-xl transition disabled:bg-gray-300 disabled:cursor-not-allowed"
                          >
                            <Plus className="w-3.5 h-3.5" /> {accepting ? 'Add to Cart' : 'Closed'}
                          </button>
                        ) : (
                          <div className="flex items-center justify-between bg-white border border-[#E5E9E7] rounded-xl px-2 py-1">
                            <button onClick={() => addToCart(item, -1)} className="w-7 h-7 rounded-lg bg-[#E5E9E7] flex items-center justify-center hover:bg-[#d1d5db] transition">
                              <Minus className="w-3 h-3 text-[#17201B]" />
                            </button>
                            <span className="text-sm font-semibold text-[#17201B]">{qty}</span>
                            <button onClick={() => addToCart(item)} className="w-7 h-7 rounded-lg bg-[#087F3F] flex items-center justify-center hover:bg-[#056B35] transition">
                              <Plus className="w-3 h-3 text-white" />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {item.is_available && item.has_variations && (
                      <p className="text-[11px] text-[#6B7280] mt-1.5 text-center">Tap to view options</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Floating Cart Bar */}
      {cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-[1001] bg-white border-t border-[#E5E9E7] shadow-[0_-4px_20px_rgba(0,0,0,0.08)]">
          <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 bg-[#087F3F] rounded-xl flex items-center justify-center shrink-0 relative">
                <ShoppingCart className="w-5 h-5 text-white" />
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-[#F4B400] text-[#17201B] text-[10px] font-bold rounded-full flex items-center justify-center">
                  {cartCount}
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#17201B]">{cartCount} item{cartCount !== 1 ? 's' : ''} in cart</p>
                <p className="text-xs text-[#6B7280]">{formatCurrency(cartTotal)}</p>
              </div>
            </div>
            <button
              onClick={() => navigate('/tourist/food/cart')}
              className="bg-[#087F3F] hover:bg-[#056B35] text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition shrink-0"
            >
              View Cart
            </button>
          </div>
        </div>
      )}

      {/* Food Detail Modal */}
      {detailItem && business && (
        <FoodDetailModal
          item={detailItem}
          business={business}
          accepting={accepting}
          onClose={() => setDetailItem(null)}
          onAdd={addToCart}
        />
      )}
    </div>
  )
}
