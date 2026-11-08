import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { formatCurrency, cn, toAssetUrl, categoryName } from '@/shared/utils'
import RestaurantRouteMap from '@/features/tourist/components/RestaurantRouteMap'
import { recordBrowsedPlace } from '@/shared/services/browsing-history'
import {
  ArrowLeft, Star, StarHalf, MapPin, Heart, Clock, ShoppingCart, Plus, Minus, UtensilsCrossed,
  Info, Image as ImageIcon, Phone, Bike, Search, Flame,
} from 'lucide-react'

interface FoodItem {
  id: number
  name: string
  price: number
  image: string | null
  is_available: boolean
  category: string | null
  description?: string | null
  bestseller?: boolean
}

interface ReviewItem {
  id: number
  rating: number
  created_at: string
  /** Older payloads */
  user_name?: string
  comment?: string
  /** Review model payload from /tourist/explore/{id} */
  review?: string | null
  user?: { name?: string | null } | null
}

interface MediaItem {
  id: number
  type?: string
  file_path: string
  title?: string | null
  caption?: string | null
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
  contact_number?: string | null
  latitude?: number | string | null
  longitude?: number | string | null
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
  reviews: ReviewItem[]
}

interface BusinessDetailResponse {
  business: BusinessDetail
  avgRating?: number
  reviewsCount?: number
  ratingBreakdown?: Record<string, number>
  reviews?: ReviewItem[]
  gallery?: MediaItem[]
  isFavorited?: boolean
  menu_items?: FoodItem[]
}

type CartLine = {
  id: number; name: string; price: number; image: string | null; business_name: string; business_id: number
  business_latitude?: number | null; business_longitude?: number | null; quantity: number
}

type DetailTab = 'menu' | 'about' | 'photos' | 'reviews' | 'location'

const DETAIL_TABS: { key: DetailTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'menu', label: 'Menu', icon: UtensilsCrossed },
  { key: 'about', label: 'About', icon: Info },
  { key: 'photos', label: 'Photos', icon: ImageIcon },
  { key: 'reviews', label: 'Reviews', icon: Star },
  { key: 'location', label: 'Location', icon: MapPin },
]

/** "13:30:00" → "1:30 PM". Returns the input unchanged if it is not HH:MM. */
function formatClock(value: string | null | undefined): string | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!m) return value
  const h = Number(m[1])
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${((h + 11) % 12) + 1}:${m[2]} ${suffix}`
}

function toCoord(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function RatingStars({ value, className }: { value: number; className?: string }) {
  const full = Math.floor(value)
  const half = value - full >= 0.25 && value - full < 0.75
  const rounded = value - full >= 0.75 ? full + 1 : full
  return (
    <span className={cn('flex items-center gap-0.5 text-[#F4B400]', className)} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => {
        if (i <= rounded) return <Star key={i} className="w-full h-full fill-current" />
        if (half && i === full + 1) return <StarHalf key={i} className="w-full h-full fill-current" />
        return <Star key={i} className="w-full h-full text-[#D7DDD9]" />
      })}
    </span>
  )
}

export default function TouristFoodShow() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const tabsRef = useRef<HTMLDivElement>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('menu')
  const [menuFilter, setMenuFilter] = useState('All')
  const [menuSearch, setMenuSearch] = useState('')
  const [selectedItem, setSelectedItem] = useState<FoodItem | null>(null)
  const [itemQty, setItemQty] = useState(1)
  const [, setCartVersion] = useState(0)

  function getCart(): CartLine[] {
    try { return JSON.parse(localStorage.getItem('food_cart') || '[]') } catch { return [] }
  }

  function saveCart(cart: CartLine[]) {
    localStorage.setItem('food_cart', JSON.stringify(cart))
    window.dispatchEvent(new Event('cart-updated'))
    setCartVersion((v) => v + 1)
  }

  const { data, isLoading } = useQuery<BusinessDetailResponse>({
    queryKey: ['tourist-food-business-v2', id],
    queryFn: () => get(`/tourist/explore/${id}`),
  })
  const business = data?.business
  const bizReviews = data?.reviews ?? business?.reviews ?? []
  const breakdown = data?.ratingBreakdown
  const reviewsCount = data?.reviewsCount ?? bizReviews.length
  const rawRating = data?.avgRating ?? business?.rating ?? business?.average_rating ?? null
  const bizRating = rawRating != null && Number(rawRating) > 0 ? Number(rawRating) : null
  const bizCategory = business?.category ? categoryName(business.category) : ''
  const bizMunicipality: string = business?.municipality && typeof business.municipality === 'object' ? business.municipality.name : (typeof business?.municipality === 'string' ? business.municipality : '')
  const isFavorited = data?.isFavorited ?? business?.is_favorited ?? false

  const favoriteMutation = useMutation({
    mutationFn: () => post('/tourist/favorites/toggle', { business_id: Number(id) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tourist-food-business-v2', id] }),
  })

  // Home → Recently Viewed links back to this canonical restaurant page.
  useEffect(() => {
    if (!business) return
    recordBrowsedPlace({
      id: business.id,
      name: business.name || business.business_name || '',
      category: bizCategory || 'Restaurant',
      discoveryGroup: 'dining',
      cover_photo: business.cover_photo,
      logo: business.logo,
      municipality: bizMunicipality || business.address || 'Bansud, Oriental Mindoro',
      rating: bizRating,
      url: `/tourist/food/${business.id}`,
    })
  }, [business, bizCategory, bizMunicipality, bizRating])

  const menuItems = useMemo(() => data?.menu_items ?? business?.menu_items ?? [], [data?.menu_items, business?.menu_items])
  const categories = useMemo(
    () => ['All', ...new Set(menuItems.map((m) => m.category).filter(Boolean) as string[])],
    [menuItems],
  )
  const filteredMenu = useMemo(() => {
    const q = menuSearch.trim().toLowerCase()
    return menuItems.filter((m) =>
      (menuFilter === 'All' || m.category === menuFilter) &&
      (!q || m.name.toLowerCase().includes(q) || (m.description ?? '').toLowerCase().includes(q)),
    )
  }, [menuItems, menuFilter, menuSearch])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!business) return <div className="text-center py-20 text-[#56615B]">Restaurant not found.</div>

  const accepting = business.is_accepting_orders
  const openStatusLabel = business.open_status?.label ?? (business.is_open ? 'Open now' : 'Closed')
  const isOpenNow = business.open_status ? business.open_status.status === 'open' : business.is_open
  const openingLabel = formatClock(business.opening_time)
  const closingLabel = formatClock(business.closing_time)
  const openChipLabel = isOpenNow && closingLabel ? `Open until ${closingLabel}` : openStatusLabel
  const hoursLabel = openingLabel && closingLabel ? `${openingLabel} – ${closingLabel}` : (business.schedule_summary || 'Not provided')
  const description = business.description || business.business_description || ''
  const lat = toCoord(business.latitude)
  const lng = toCoord(business.longitude)
  const locationLabel = [business.address, bizMunicipality].filter(Boolean).join(', ') || 'Bansud, Oriental Mindoro'
  const photos = [
    ...(business.cover_photo ? [{ id: -1, file_path: business.cover_photo, title: business.name }] : []),
    ...(data?.gallery ?? []).filter((m) => !m.type || m.type === 'image' || m.type === 'photo'),
  ]
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
        business_name: business.name,
        business_id: business.id,
        business_latitude: lat,
        business_longitude: lng,
        quantity: qty,
      })
    }
    saveCart(existingCart)
    setSelectedItem(null)
    setItemQty(1)
  }

  const buyNow = (item: FoodItem, qty = 1) => {
    addToCart(item, qty)
    navigate('/tourist/food/cart')
  }

  const showTab = (tab: DetailTab) => {
    setDetailTab(tab)
    tabsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* ---------- Hero ---------- */}
      <section className="relative min-h-[320px] sm:min-h-[340px] rounded-3xl overflow-hidden bg-[#0B2A17] flex items-end">
        {toAssetUrl(business.cover_photo) ? (
          <img src={toAssetUrl(business.cover_photo)} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[#087F3F] to-[#0B2A17]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-black/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />

        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="absolute z-[2] top-4 left-4 sm:top-5 sm:left-5 w-11 h-11 rounded-full bg-black/35 backdrop-blur-md text-white flex items-center justify-center hover:bg-black/50 transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={() => favoriteMutation.mutate()}
          disabled={favoriteMutation.isPending}
          aria-pressed={isFavorited}
          aria-label={isFavorited ? "Saved" : "Save"}
          className="absolute z-[2] top-4 right-4 sm:top-5 sm:right-5 inline-flex items-center gap-2 h-11 sm:h-12 px-3.5 sm:px-5 rounded-full border-2 border-white/85 bg-black/25 backdrop-blur-md text-white text-base font-bold hover:bg-black/40 transition"
        >
          <Heart className={cn('w-5 h-5', isFavorited && 'fill-[#F87171] text-[#F87171]')} />
          <span className="hidden sm:inline">{isFavorited ? 'Saved' : 'Save'}</span>
        </button>

        <div className="relative w-full px-5 sm:px-8 pt-20 pb-14 flex flex-col sm:flex-row items-start sm:items-end gap-3 sm:gap-7">
          {/* Logo: also on phones (smaller, above the name). */}
          <div data-testid="restaurant-logo" className="flex w-16 h-16 sm:w-28 sm:h-28 md:w-36 md:h-36 xl:w-40 xl:h-40 shrink-0 rounded-2xl sm:rounded-3xl border-[3px] sm:border-4 border-white bg-[#0B3D20] overflow-hidden shadow-xl items-center justify-center">
            {business.logo ? (
              <img src={toAssetUrl(business.logo)} alt={`${business.name} logo`} className="w-full h-full object-cover" />
            ) : (
              <UtensilsCrossed className="w-8 h-8 sm:w-14 sm:h-14 text-white/80" />
            )}
          </div>
          <div className="min-w-0 pb-1 text-white">
            <h1 className="text-[clamp(1.5rem,3.4vw,2.25rem)] font-extrabold leading-tight text-white drop-shadow break-words">{business.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] font-semibold">
              {bizRating != null ? (
                <span className="flex items-center gap-1.5">
                  <Star className="w-5 h-5 fill-[#F4B400] text-[#F4B400]" />
                  <span className="text-[#FFD45C]">{bizRating.toFixed(1)}</span>
                  <span className="text-white/90">({reviewsCount.toLocaleString()} review{reviewsCount === 1 ? '' : 's'})</span>
                </span>
              ) : (
                <span className="text-white/90">No ratings yet</span>
              )}
              <span className="w-px h-4 bg-white/50" aria-hidden="true" />
              <span className="flex items-center gap-1.5"><MapPin className="w-4 h-4" /> {bizMunicipality || 'Bansud'}, Oriental Mindoro</span>
            </div>
            {description && <p className="mt-2 text-[15px] italic text-white/90 line-clamp-1 max-w-2xl">{description}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
              {bizCategory && (
                <span className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-white/20 backdrop-blur-md text-sm font-semibold text-white">
                  <UtensilsCrossed className="w-4 h-4" /> {bizCategory}
                </span>
              )}
              {accepting && (
                <span className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-white/20 backdrop-blur-md text-sm font-semibold text-white">
                  <Bike className="w-4 h-4" /> Delivery
                </span>
              )}
              <span className={cn(
                'inline-flex items-center gap-1.5 h-9 px-4 rounded-full border text-sm font-semibold text-white',
                isOpenNow ? 'bg-[#087F3F]/85 border-[#4ADE80]/60' : 'bg-[#B91C1C]/85 border-[#FCA5A5]/60',
              )}>
                <Clock className="w-4 h-4" /> {openChipLabel}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Tabs ---------- */}
      <div ref={tabsRef} className="relative z-10 -mt-9 mx-3 sm:mx-6 scroll-mt-28">
        <div role="tablist" aria-label="Restaurant sections" className="inline-flex max-w-full overflow-x-auto bg-white rounded-2xl border border-[#E5E9E7] shadow-[0_8px_24px_rgba(23,32,27,0.08)] px-2">
          {DETAIL_TABS.map((t) => {
            const active = detailTab === t.key
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setDetailTab(t.key)}
                className={cn(
                  'food-show-tab relative flex items-center gap-2 px-5 sm:px-7 h-14 text-[15px] font-semibold whitespace-nowrap transition-colors',
                  active ? 'text-[#087F3F]' : 'text-[#17201B] hover:text-[#087F3F]',
                )}
              >
                <t.icon className={cn('w-5 h-5', active && t.key === 'reviews' ? 'fill-current' : '')} />
                {t.label}
                {active && <span className="absolute left-3 right-3 bottom-0 h-[3px] rounded-full bg-[#087F3F]" />}
              </button>
            )
          })}
        </div>
      </div>

      {!accepting && (
        <div className="mt-5 rounded-2xl border border-[#B91C1C]/20 bg-[#FEF2F2] px-5 py-3.5 flex items-center gap-3" role="status">
          <span className="flex items-center gap-1.5 text-sm font-bold text-[#B91C1C]">
            <span className="w-2 h-2 rounded-full bg-[#B91C1C]" /> Closed
          </span>
          <p className="text-sm text-[#991B1B]">{openStatusLabel}. Ordering is currently disabled for this restaurant.</p>
        </div>
      )}

      {/* ---------- Body ---------- */}
      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_340px] items-start pb-24 lg:pb-6">
        <div className="min-w-0">
          {detailTab === 'menu' && (
            <section aria-labelledby="menu-heading">
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
                <div>
                  <h2 id="menu-heading" className="text-[clamp(1.5rem,2.6vw,1.75rem)] font-extrabold text-[#17201B]">Our Menu</h2>
                  <p className="text-[15px] text-[#56615B] mt-0.5">
                    {menuItems.length > 0 ? `${menuItems.length} dish${menuItems.length === 1 ? '' : 'es'} from ${business.name}` : 'Freshly prepared dishes'}
                  </p>
                </div>
                {menuItems.length > 0 && (
                  <label className="relative w-full sm:w-80">
                    <span className="sr-only">Search menu items</span>
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#56615B]" aria-hidden="true" />
                    <input
                      type="search"
                      value={menuSearch}
                      onChange={(e) => setMenuSearch(e.target.value)}
                      placeholder="Search menu items..."
                      className="w-full h-12 pl-12 pr-4 bg-white border border-[#E5E9E7] rounded-2xl text-sm text-[#17201B] placeholder-[#68736D] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F]"
                    />
                  </label>
                )}
              </div>

              {categories.length > 2 && (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setMenuFilter(c)}
                      aria-pressed={menuFilter === c}
                      className={cn(
                        'px-4 py-2 rounded-full text-sm font-semibold transition whitespace-nowrap border',
                        menuFilter === c ? 'bg-[#087F3F] text-white border-[#087F3F]' : 'bg-white text-[#56615B] border-[#E5E9E7] hover:border-[#087F3F]/40 hover:text-[#087F3F]',
                      )}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}

              {filteredMenu.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-dashed border-[#C2DEC9] bg-white py-12 text-center">
                  <UtensilsCrossed className="w-8 h-8 mx-auto text-[#087F3F]/40" />
                  <p className="mt-2 text-sm text-[#56615B]">{menuItems.length === 0 ? 'No menu items available yet.' : 'No dishes match your search.'}</p>
                </div>
              ) : (
                <div className="mt-5 food-menu-grid">
                  {filteredMenu.map((item) => (
                    <article
                      key={item.id}
                      className="food-menu-card grid grid-rows-[252px_112px] bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden group hover:shadow-lg hover:shadow-[#087F3F]/10 transition"
                    >
                      {/* Photo, 252 px (25% shorter than before; opens the dish details) */}
                      <button
                        type="button"
                        aria-label={`View food item details for ${item.name}`}
                        disabled={!item.is_available}
                        onClick={() => navigate(`/tourist/food/item/${item.id}`)}
                        className="food-menu-card-body relative block w-full h-full min-h-0 overflow-hidden bg-[#E9F7EF] text-left disabled:cursor-not-allowed"
                      >
                        {item.image ? (
                          <img src={toAssetUrl(item.image)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                        ) : (
                          <span className="w-full h-full flex items-center justify-center">
                            <UtensilsCrossed className="w-12 h-12 text-[#087F3F]/35" />
                          </span>
                        )}
                        {item.bestseller && (
                          <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#087F3F] text-white text-xs font-bold shadow">
                            <Flame className="w-3.5 h-3.5" /> Popular
                          </span>
                        )}
                        {!item.is_available && (
                          <span className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <span className="bg-[#B91C1C] text-white text-xs font-bold px-3 py-1 rounded-full">Unavailable</span>
                          </span>
                        )}
                      </button>
                      {/* 112 px: name, price, then Add to cart + Buy Now */}
                      <div className="min-h-0 px-3 py-2 flex flex-col justify-between">
                        <div className="min-w-0">
                          <h3 className="text-[15px] font-bold leading-tight text-[#17201B] truncate" title={item.name}>{item.name}</h3>
                          <p className="text-base font-extrabold leading-tight text-[#087F3F]">{formatCurrency(item.price)}</p>
                        </div>
                        {item.is_available && accepting && (
                          <div className="flex items-center gap-3">
                            {/* Plain icon + small caption: no border or pill. */}
                            <button
                              type="button"
                              onClick={() => setSelectedItem(item)}
                              aria-label={`Add ${item.name} to cart`}
                              className="food-add-button shrink-0 flex flex-col items-center justify-center gap-0.5 min-w-[56px] min-h-9 px-1 text-[#087F3F] hover:text-[#056B35] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087F3F] rounded-md transition"
                            >
                              <ShoppingCart className="w-5 h-5" aria-hidden="true" />
                              <span className="text-[10px] font-semibold leading-none whitespace-nowrap">Add to cart</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => buyNow(item)}
                              aria-label={`Buy ${item.name} now`}
                              className="food-buy-button flex-1 inline-flex items-center justify-center h-9 px-3 rounded-full bg-[#087F3F] text-white text-[13px] font-bold whitespace-nowrap hover:bg-[#056B35] transition"
                            >
                              Buy Now
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {detailTab === 'about' && (
            <section className="bg-white border border-[#E5E9E7] rounded-2xl p-6 space-y-5">
              <h2 className="text-2xl font-extrabold text-[#17201B]">About {business.name}</h2>
              <p className="text-[15px] leading-relaxed text-[#3B4540]">{description || 'No description available yet.'}</p>
              <dl className="grid sm:grid-cols-2 gap-4">
                {bizCategory && (<div><dt className="text-xs font-semibold uppercase tracking-wide text-[#56615B]">Category</dt><dd className="mt-1 text-[15px] font-semibold text-[#17201B]">{bizCategory}</dd></div>)}
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-[#56615B]">Operating hours</dt><dd className="mt-1 text-[15px] font-semibold text-[#17201B]">{hoursLabel}</dd></div>
                <div><dt className="text-xs font-semibold uppercase tracking-wide text-[#56615B]">Address</dt><dd className="mt-1 text-[15px] font-semibold text-[#17201B]">{locationLabel}</dd></div>
                {business.contact_number && (<div><dt className="text-xs font-semibold uppercase tracking-wide text-[#56615B]">Contact</dt><dd className="mt-1 text-[15px] font-semibold text-[#17201B]">{business.contact_number}</dd></div>)}
              </dl>
            </section>
          )}

          {detailTab === 'photos' && (
            <section>
              <h2 className="text-2xl font-extrabold text-[#17201B] mb-4">Photos</h2>
              {photos.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#C2DEC9] bg-white py-12 text-center text-sm text-[#56615B]">No photos yet.</p>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {photos.map((p) => (
                    <a key={p.id} href={toAssetUrl(p.file_path)} target="_blank" rel="noreferrer" className="block aspect-[4/3] rounded-2xl overflow-hidden border border-[#E5E9E7] bg-[#E9F7EF]">
                      <img src={toAssetUrl(p.file_path)} alt={p.title || `${business.name} photo`} className="w-full h-full object-cover hover:scale-105 transition duration-300" />
                    </a>
                  ))}
                </div>
              )}
            </section>
          )}

          {detailTab === 'reviews' && (
            <section>
              <h2 className="text-2xl font-extrabold text-[#17201B] mb-4">Reviews</h2>
              {bizReviews.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-[#C2DEC9] bg-white py-12 text-center text-sm text-[#56615B]">No reviews yet.</p>
              ) : (
                <ul className="space-y-3">
                  {bizReviews.map((r) => (
                    <li key={r.id} className="bg-white border border-[#E5E9E7] rounded-2xl p-5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[15px] font-bold text-[#17201B]">{r.user_name || r.user?.name || 'Tourist'}</span>
                        <span className="flex items-center gap-2">
                          <RatingStars value={Number(r.rating)} className="w-[88px] h-4" />
                          <span className="sr-only">{r.rating} out of 5</span>
                        </span>
                      </div>
                      <p className="mt-2 text-[15px] text-[#3B4540]">{r.comment || r.review || 'No written review.'}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {detailTab === 'location' && (
            lat != null && lng != null ? (
              <RestaurantRouteMap restaurantName={business.name} destination={[lat, lng]} locationLabel={locationLabel} />
            ) : (
              <section className="bg-white border border-[#E5E9E7] rounded-2xl p-6">
                <p className="text-center text-sm text-[#56615B]">Map location not provided for this restaurant.</p>
                <p className="mt-2 flex items-center justify-center gap-2 text-[15px] font-semibold text-[#17201B]"><MapPin className="w-5 h-5 text-[#087F3F]" /> {locationLabel}</p>
              </section>
            )
          )}
        </div>

        {/* ---------- Side column ---------- */}
        <aside className="grid gap-5 md:grid-cols-2 xl:grid-cols-1 items-start xl:sticky xl:top-[calc(var(--tourist-header-h)+16px)]">
          <section className="rounded-2xl border border-[#D3E6D8] bg-gradient-to-b from-[#EEF7F0] to-[#F6FAF6] p-6" aria-labelledby="info-heading">
            <h2 id="info-heading" className="text-xl font-extrabold text-[#17201B]">Restaurant Info</h2>
            <dl className="mt-4 space-y-4">
              <div className="flex gap-3">
                <Clock className="w-5 h-5 text-[#17201B] mt-0.5 shrink-0" aria-hidden="true" />
                <div><dt className="text-sm font-semibold text-[#047332]">Operating Hours</dt><dd className="text-[15px] font-semibold text-[#17201B]">{hoursLabel}</dd></div>
              </div>
              <div className="flex gap-3">
                <Phone className="w-5 h-5 text-[#17201B] mt-0.5 shrink-0" aria-hidden="true" />
                <div>
                  <dt className="text-sm font-semibold text-[#047332]">Contact</dt>
                  <dd className="text-[15px] font-semibold text-[#17201B]">
                    {business.contact_number ? <a href={`tel:${business.contact_number}`} className="hover:underline">{business.contact_number}</a> : 'Not provided'}
                  </dd>
                </div>
              </div>
              <div className="flex gap-3">
                <MapPin className="w-5 h-5 text-[#17201B] mt-0.5 shrink-0" aria-hidden="true" />
                <div><dt className="text-sm font-semibold text-[#047332]">Location</dt><dd className="text-[15px] font-semibold text-[#17201B]">{locationLabel}</dd></div>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => showTab('location')}
              className="mt-5 w-full h-12 rounded-xl bg-[#056B35] text-white text-[15px] font-bold inline-flex items-center justify-center gap-2 hover:bg-[#04552A] transition"
            >
              <MapPin className="w-5 h-5" /> View on Map
            </button>
          </section>

          <section className="rounded-2xl border border-[#E5E9E7] bg-white p-6" aria-labelledby="rating-heading">
            <h2 id="rating-heading" className="text-xl font-extrabold text-[#17201B]">Restaurant Rating</h2>
            {bizRating == null || reviewsCount === 0 ? (
              <p className="mt-3 text-sm text-[#56615B]">No ratings yet. Be the first to order and review.</p>
            ) : (
              <>
                <div className="mt-3 flex items-center gap-4">
                  <span className="text-5xl font-extrabold text-[#17201B]">{bizRating.toFixed(1)}</span>
                  <div>
                    <RatingStars value={bizRating} className="w-[130px] h-6" />
                    <p className="mt-1 text-sm text-[#56615B]">({reviewsCount.toLocaleString()} review{reviewsCount === 1 ? '' : 's'})</p>
                  </div>
                </div>
                {breakdown && (
                  <ul className="mt-4 space-y-1.5" aria-label="Rating breakdown">
                    {[5, 4, 3, 2, 1].map((star) => {
                      const count = breakdown[String(star)] ?? 0
                      const pct = reviewsCount > 0 ? Math.round((count / reviewsCount) * 100) : 0
                      return (
                        <li key={star} className="flex items-center gap-2 text-sm">
                          <span className="w-8 flex items-center gap-0.5 font-semibold text-[#17201B]">{star}<Star className="w-3.5 h-3.5 fill-[#3B4540] text-[#3B4540]" aria-hidden="true" /></span>
                          <span className="flex-1 h-2 rounded-full bg-[#E5E9E7] overflow-hidden">
                            <span className={cn('block h-full rounded-full', star >= 4 ? 'bg-[#087F3F]' : 'bg-[#F4B400]')} style={{ width: `${pct}%` }} />
                          </span>
                          <span className="w-10 text-right text-[#56615B]">{pct}%</span>
                          <span className="sr-only">{count} review{count === 1 ? '' : 's'}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </>
            )}
          </section>
        </aside>
      </div>

      {/* Cart bar */}
      {cartCount > 0 && (
        <div className="fixed inset-x-0 z-[2100] px-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] lg:bottom-6 lg:left-[248px]">
          <button
            type="button"
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
        <div className="fixed inset-0 z-[2100] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={`Add ${selectedItem.name} to cart`}>
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
              {selectedItem.description && <p className="text-sm text-[#56615B] mt-2">{selectedItem.description}</p>}

              <div className="flex items-center justify-between mt-6">
                <span className="text-sm text-[#56615B]">Quantity</span>
                <div className="flex items-center gap-3">
                  <button type="button" aria-label="Decrease quantity" onClick={() => setItemQty((q) => Math.max(1, q - 1))} className="w-8 h-8 rounded-lg bg-[#E9F7EF] text-[#087F3F] flex items-center justify-center hover:bg-[#DDF4E6] transition">
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-medium text-[#17201B] w-8 text-center">{itemQty}</span>
                  <button type="button" aria-label="Increase quantity" onClick={() => setItemQty((q) => q + 1)} className="w-8 h-8 rounded-lg bg-[#E9F7EF] text-[#087F3F] flex items-center justify-center hover:bg-[#DDF4E6] transition">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <p className="mt-6 flex items-center justify-between text-sm">
                <span className="text-[#56615B]">Total</span>
                <span className="text-lg font-extrabold text-[#087F3F]">{formatCurrency(selectedItem.price * itemQty)}</span>
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => addToCart(selectedItem, itemQty)}
                  className="py-3.5 bg-white border-2 border-[#087F3F] text-[#087F3F] font-semibold text-sm rounded-xl hover:bg-[#E9F7EF] transition flex items-center justify-center gap-2"
                >
                  <ShoppingCart className="w-4 h-4" aria-hidden="true" /> Add to Cart
                </button>
                <button
                  type="button"
                  onClick={() => buyNow(selectedItem, itemQty)}
                  className="py-3.5 bg-[#087F3F] text-white font-semibold text-sm rounded-xl hover:bg-[#056B35] transition flex items-center justify-center gap-2"
                >
                  Buy Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
