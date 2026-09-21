import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { ApplicationLogo } from '@/shared/components/ApplicationLogo'
import { formatCurrency, toAssetUrl } from '@/shared/utils'
import { Star, MapPin, ArrowLeft, Heart, UtensilsCrossed, BadgeCheck, Clock, ShoppingCart, Plus, Minus, Info, Images, Phone, Mail, Globe, Link as LinkIcon, AtSign, Navigation } from 'lucide-react'

interface MenuItem {
  id: number
  name: string
  description?: string | null
  price: number
  image?: string | null
  is_available?: boolean
  category?: string | null
  bestseller?: boolean
}

interface ReviewItem {
  id: number
  rating?: number
  food_rating?: number | null
  service_rating?: number | null
  review?: string | null
  user?: { id: number; name?: string; profile?: { first_name?: string; last_name?: string } } | null
}

interface RestaurantDetail {
  business: {
    id: number
    name?: string
    business_name?: string
    logo?: string | null
    cover_photo?: string | null
    business_description?: string | null
    tagline?: string | null
    address?: string | null
    price_range?: string | null
    is_open?: boolean
    open_status?: { is_open?: boolean; label?: string } | string
    schedule_summary?: string
    municipality?: { name?: string } | null
    barangay?: { name?: string } | null
    contact_number?: string | null
    email?: string | null
    website?: string | null
    facebook?: string | null
    instagram?: string | null
    other_social_media?: Record<string, string> | null
    landmark?: string | null
    navigation_instructions?: string | null
    opening_time?: string | null
    closing_time?: string | null
    business_hours?: Record<string, unknown> | null
  }
  menu_items?: MenuItem[]
  avgRating?: number
  reviewsCount?: number
  reviews?: ReviewItem[]
  isOpen?: boolean
  gallery?: { id: number; file_path?: string | null; caption?: string | null; title?: string | null }[]
}

type TabKey = 'menu' | 'about' | 'gallery' | 'contact'

const TABS: { key: TabKey; label: string; icon: typeof UtensilsCrossed }[] = [
  { key: 'menu', label: 'Menu', icon: UtensilsCrossed },
  { key: 'about', label: 'About', icon: Info },
  { key: 'gallery', label: 'Gallery', icon: Images },
  { key: 'contact', label: 'Contact Info', icon: Phone },
]

const STORAGE_KEY = 'tracktour_landing_favorites'

interface CartItem {
  id: number
  name: string
  price: number
  image?: string | null
  business_name?: string
  business_id: number
  quantity: number
}

const CART_KEY = 'tracktour_landing_cart'

function getFavorites(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as number[]) : []
  } catch {
    return []
  }
}

function getCart(): CartItem[] {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]') as CartItem[]
  } catch {
    return []
  }
}

function saveCart(cart: CartItem[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart))
  window.dispatchEvent(new Event('landing-cart-updated'))
}

export default function LandingRestaurantPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [isFavorited, setIsFavorited] = useState(false)
  const [cart, setCart] = useState<CartItem[]>(getCart)
  const [activeTab, setActiveTab] = useState<TabKey>('menu')

  const { data, isLoading } = useQuery({
    queryKey: ['landing-restaurant', id],
    queryFn: () => get<RestaurantDetail>(`/tourist/explore/${id}`),
    enabled: !!id,
  })

  useEffect(() => {
    setIsFavorited(!!id && getFavorites().includes(Number(id)))
  }, [id])

  useEffect(() => {
    const sync = () => setCart(getCart())
    window.addEventListener('landing-cart-updated', sync)
    return () => window.removeEventListener('landing-cart-updated', sync)
  }, [])

  const addToCart = (item: Pick<MenuItem, 'id' | 'name' | 'price' | 'image'>, delta = 1) => {
    const current = getCart()
    const existing = current.find((c) => c.id === item.id)
    let updated: CartItem[]
    if (existing) {
      updated = current.map((c) =>
        c.id === item.id ? { ...c, quantity: Math.max(0, c.quantity + delta) } : c
      ).filter((c) => c.quantity > 0)
    } else {
      updated = [...current, {
        id: item.id,
        name: item.name,
        price: item.price,
        image: item.image,
        business_name: name,
        business_id: Number(id),
        quantity: delta,
      }]
    }
    saveCart(updated)
    setCart(updated)
  }

  const getItemQty = (itemId: number) => cart.filter((c) => c.id === itemId).reduce((s, c) => s + c.quantity, 0)

  const toggleFavorite = () => {
    const bizId = Number(id)
    if (!bizId) return
    let favs = getFavorites()
    if (favs.includes(bizId)) {
      favs = favs.filter((f) => f !== bizId)
    } else {
      favs.push(bizId)
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favs))
    setIsFavorited(favs.includes(bizId))
  }

  const restaurant = data?.business
  const name = restaurant?.name ?? restaurant?.business_name ?? 'Restaurant'
  const cover = toAssetUrl(restaurant?.cover_photo)
  const logo = toAssetUrl(restaurant?.logo)
  const about = restaurant?.business_description ?? ''
  const tagline = restaurant?.tagline ?? ''
  const rating = data?.avgRating ?? 0
  const reviewsCount = data?.reviewsCount ?? 0
  const menu = data?.menu_items ?? []
  const isOpen = data?.isOpen ?? restaurant?.is_open ?? false
  const gallery = (data?.gallery ?? []).filter((g) => g.file_path)
  const business = (restaurant ?? {}) as NonNullable<RestaurantDetail['business']>

  const cartCount = cart.reduce((s, c) => s + c.quantity, 0)
  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0)

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
          to="/explore?tab=food"
          className="inline-flex items-center gap-2 text-sm font-medium text-[#087F3F] hover:text-[#056B35] transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Explore
        </Link>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !restaurant ? (
          <div className="py-16 text-center">
            <UtensilsCrossed className="w-12 h-12 text-[#9CA3AF] mx-auto mb-4" />
            <p className="text-[#68736D]">Restaurant not found</p>
          </div>
        ) : (
          <>
            {/* Cover */}
            <div className="relative h-56 sm:h-72 rounded-2xl overflow-hidden border border-[#E2E8E3] bg-[#E9F7EF]">
              {cover ? (
                <img src={cover} alt={name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <UtensilsCrossed className="w-16 h-16 text-[#2F9E62]" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              <button
                onClick={toggleFavorite}
                aria-label={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                className={`absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center backdrop-blur-md border transition-all ${
                  isFavorited
                    ? 'bg-[#DC2626] text-white border-[#DC2626]'
                    : 'bg-white/85 text-[#17201A] border-white/60 hover:scale-105'
                }`}
              >
                <Heart className={`w-5 h-5 ${isFavorited ? 'fill-current' : ''}`} />
              </button>
            </div>

            {/* Logo + name + rating */}
            <div className="flex -mt-10 relative z-10">
              <div className="flex-1 bg-white/90 backdrop-blur rounded-xl px-4 py-3 shadow-sm flex items-center gap-4">
                <div className="w-20 h-20 rounded-2xl border border-[#E2E8E3] bg-white shadow overflow-hidden flex items-center justify-center shrink-0">
                  {logo ? (
                    <img src={logo} alt={name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl">🍽️</span>
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-2xl font-bold text-[#17201A]">{name}</h1>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                        isOpen ? 'bg-[#E6F6EC] text-[#087F3F]' : 'bg-[#FEE2E2] text-[#DC2626]'
                      }`}
                    >
                      <Clock className="w-3 h-3" /> {isOpen ? 'Open' : 'Closed'}
                    </span>
                  </div>
                  {tagline && <p className="text-sm text-[#68736D]">{tagline}</p>}
                  <div className="flex items-center gap-2 mt-1.5 text-sm">
                    <span className="flex items-center gap-1 font-semibold text-[#17201A]">
                      <Star className="w-4 h-4 text-[#F4B400] fill-[#F4B400]" />
                      {rating > 0 ? rating.toFixed(1) : 'New'}
                    </span>
                    <span className="text-[#68736D]">({reviewsCount} review{reviewsCount === 1 ? '' : 's'})</span>
                  </div>
                  <div className="flex items-center gap-1 mt-1 text-xs text-[#68736D]">
                    <MapPin className="w-3 h-3" /> {restaurant?.municipality?.name ?? restaurant?.address ?? 'Oriental Mindoro'}
                  </div>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="mt-6 flex flex-wrap gap-2">
              {TABS.map((tab) => {
                const Icon = tab.icon
                const count = tab.key === 'menu' ? menu.length : tab.key === 'gallery' ? gallery.length : 0
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition ${
                      activeTab === tab.key
                        ? 'bg-[#087F3F] text-white shadow-sm'
                        : 'bg-white text-[#68736D] border border-[#E2E8E3] hover:border-[#087F3F]/40 hover:text-[#087F3F]'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                    {count > 0 && (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-[#087F3F]/10 text-[#087F3F]'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Menu tab */}
            {activeTab === 'menu' && (
              <div className="bg-white border border-[#E2E8E3] rounded-2xl px-5 py-5 mt-4">
                <h2 className="text-lg font-bold text-[#17201A] mb-4">Food Menu</h2>
                {menu.length === 0 ? (
                  <div className="py-10 text-center">
                    <UtensilsCrossed className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" />
                    <p className="text-[#68736D] text-sm">No menu items yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {menu.map((item) => (
                      <div
                        key={item.id}
                        className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition group"
                      >
                        <div className="relative aspect-[4/3] overflow-hidden bg-[#E9F7EF]">
                          {item.image ? (
                            <img src={toAssetUrl(item.image)} alt={item.name} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                          ) : (
                            <div className="w-full h-full bg-gradient-to-br from-[#E9F7EF] to-[#DDF4E6] flex items-center justify-center">
                              <UtensilsCrossed className="w-8 h-8 text-[#087F3F]/30" />
                            </div>
                          )}
                          {item.bestseller && (
                            <div className="absolute top-2 left-2 bg-[#F4B400] text-[#17201B] text-[10px] font-bold px-2 py-0.5 rounded-full">
                              BESTSELLER
                            </div>
                          )}
                        </div>
                        <div className="p-3">
                          <p className="text-sm font-semibold text-[#17201B] truncate">{item.name}</p>
                          <p className="text-sm font-extrabold text-[#087F3F] mt-1">{formatCurrency(item.price)}</p>
                          {getItemQty(item.id) === 0 ? (
                            <button
                              onClick={() => addToCart(item)}
                              className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 bg-[#087F3F] hover:bg-[#056B35] text-white text-xs font-semibold rounded-xl transition"
                            >
                              <Plus className="w-3.5 h-3.5" /> Add to Cart
                            </button>
                          ) : (
                            <div className="mt-2 flex items-center justify-between bg-white border border-[#E5E9E7] rounded-xl px-2 py-1">
                              <button onClick={() => addToCart(item, -1)} className="w-7 h-7 rounded-lg bg-[#E5E9E7] flex items-center justify-center hover:bg-[#d1d5db] transition">
                                <Minus className="w-3 h-3 text-[#17201B]" />
                              </button>
                              <span className="text-sm font-semibold text-[#17201B]">{getItemQty(item.id)}</span>
                              <button onClick={() => addToCart(item)} className="w-7 h-7 rounded-lg bg-[#087F3F] flex items-center justify-center hover:bg-[#056B35] transition">
                                <Plus className="w-3 h-3 text-white" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* About tab */}
            {activeTab === 'about' && (
              <div className="bg-white border border-[#E2E8E3] rounded-2xl px-5 py-5 mt-4">
                <h2 className="text-lg font-bold text-[#17201A] flex items-center gap-2 mb-2">
                  About <BadgeCheck className="w-5 h-5 text-[#087F3F]" />
                </h2>
                <p className="text-sm leading-relaxed text-[#37433D] whitespace-pre-line">
                  {about || (tagline ? tagline : `${name} is a food business in ${restaurant?.municipality?.name ?? 'Bansud, Oriental Mindoro'}.`)}
                </p>
              </div>
            )}

            {/* Gallery tab */}
            {activeTab === 'gallery' && (
              <div className="bg-white border border-[#E2E8E3] rounded-2xl px-5 py-5 mt-4">
                <h2 className="text-lg font-bold text-[#17201A] mb-4">Gallery</h2>
                {gallery.length === 0 ? (
                  <div className="py-10 text-center">
                    <Images className="w-10 h-10 text-[#9CA3AF] mx-auto mb-3" />
                    <p className="text-[#68736D] text-sm">No photos yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {gallery.map((g) => (
                      <div key={g.id} className="relative aspect-[4/3] rounded-xl overflow-hidden border border-[#E5E9E7] bg-[#E9F7EF] group">
                        <img src={toAssetUrl(g.file_path)} alt={g.caption || g.title || name} className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Contact tab */}
            {activeTab === 'contact' && (
              <div className="bg-white border border-[#E2E8E3] rounded-2xl px-5 py-5 mt-4">
                <h2 className="text-lg font-bold text-[#17201A] mb-4">Contact Info</h2>
                <div className="grid sm:grid-cols-2 gap-4">
                  {business.contact_number && (
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-[#E6F6EC] flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4 text-[#087F3F]" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-[#68736D]">Phone</p>
                        <p className="text-sm font-semibold text-[#17201A] break-words">{business.contact_number}</p>
                      </div>
                    </div>
                  )}
                  {business.email && (
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-[#E6F6EC] flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4 text-[#087F3F]" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-[#68736D]">Email</p>
                        <p className="text-sm font-semibold text-[#17201A] break-words">{business.email}</p>
                      </div>
                    </div>
                  )}
                  {business.website && (
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-[#E6F6EC] flex items-center justify-center shrink-0">
                        <Globe className="w-4 h-4 text-[#087F3F]" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-[#68736D]">Website</p>
                        <p className="text-sm font-semibold text-[#087F3F] break-words">{business.website}</p>
                      </div>
                    </div>
                  )}
                  {business.facebook && (
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-[#E6F6EC] flex items-center justify-center shrink-0">
                        <LinkIcon className="w-4 h-4 text-[#087F3F]" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-[#68736D]">Facebook</p>
                        <p className="text-sm font-semibold text-[#087F3F] break-words">{business.facebook}</p>
                      </div>
                    </div>
                  )}
                  {business.instagram && (
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-[#E6F6EC] flex items-center justify-center shrink-0">
                        <AtSign className="w-4 h-4 text-[#087F3F]" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-[#68736D]">Instagram</p>
                        <p className="text-sm font-semibold text-[#087F3F] break-words">{business.instagram}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-[#E6F6EC] flex items-center justify-center shrink-0">
                      <MapPin className="w-4 h-4 text-[#087F3F]" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-[#68736D]">Address</p>
                      <p className="text-sm font-semibold text-[#17201A] break-words">
                        {[business.address, business.barangay?.name, business.municipality?.name].filter(Boolean).join(', ') || 'Oriental Mindoro'}
                      </p>
                    </div>
                  </div>
                  {business.landmark && (
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-[#E6F6EC] flex items-center justify-center shrink-0">
                        <Navigation className="w-4 h-4 text-[#087F3F]" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-[#68736D]">Landmark</p>
                        <p className="text-sm font-semibold text-[#17201A] break-words">{business.landmark}</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-[#E6F6EC] flex items-center justify-center shrink-0">
                      <Clock className="w-4 h-4 text-[#087F3F]" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-[#68736D]">Hours</p>
                      <p className="text-sm font-semibold text-[#17201A] break-words">
                        {business.schedule_summary || (business.opening_time && business.closing_time
                          ? `${business.opening_time} – ${business.closing_time}`
                          : 'Open daily')}
                      </p>
                    </div>
                  </div>
                  {business.price_range && (
                    <div className="flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-[#E6F6EC] flex items-center justify-center shrink-0">
                        <UtensilsCrossed className="w-4 h-4 text-[#087F3F]" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-[#68736D]">Price Range</p>
                        <p className="text-sm font-semibold text-[#17201A] break-words">{business.price_range}</p>
                      </div>
                    </div>
                  )}
                  {business.navigation_instructions && (
                    <div className="sm:col-span-2 flex items-center gap-3">
                      <span className="w-10 h-10 rounded-xl bg-[#E6F6EC] flex items-center justify-center shrink-0">
                        <Navigation className="w-4 h-4 text-[#087F3F]" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-[#68736D]">How to Get There</p>
                        <p className="text-sm font-semibold text-[#17201A] break-words">{business.navigation_instructions}</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Floating cart bar */}
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
              onClick={() => navigate('/login')}
              className="bg-[#087F3F] hover:bg-[#056B35] text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition shrink-0"
            >
              Check Out
            </button>
          </div>
        </div>
      )}

      <footer className="border-t border-ink/5 py-8 text-center text-sm text-ink-soft mt-8">
        &copy; {new Date().getFullYear()} <span className="text-[#16803C] font-semibold">TrackTour</span> — Bansud Tourism Office. All rights reserved.
      </footer>
    </div>
  )
}