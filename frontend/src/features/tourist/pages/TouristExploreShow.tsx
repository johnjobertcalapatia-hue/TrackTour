import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatCurrency, formatDateTime, isNewItem, categoryName, toAssetUrl } from '@/shared/utils'
import { getDiscoveryGroup, type DiscoveryGroup } from '@/shared/utils/category'
import { recordBrowsedPlace } from '@/shared/services/browsing-history'
import {
  ArrowLeft, Star, MapPin, Phone, Clock, Heart, UtensilsCrossed, Plus, Minus,
  ShoppingCart, X, Share2, Navigation, Ticket, Camera, Video, Compass,
  Building2, CheckCircle2, Mail, ExternalLink
} from 'lucide-react'

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

interface MediaItem {
  id: number
  type: string
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
  tagline?: string | null
  category: unknown
  business_category_id?: number
  municipality: { name: string } | null
  barangay: { name: string } | null
  address: string
  latitude: number | null
  longitude: number | null
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
  price_range?: string | null
  facilities?: string[] | null
  services?: string[] | null
  category_details?: Record<string, any>
  details?: { field_name: string; field_value: string }[] | Record<string, any>
  media?: MediaItem[]
  menu_items?: MenuItem[]
  reviews?: { id: number; user_name: string; rating: number; comment: string; created_at: string }[]
}

interface BusinessDetailResponse {
  business: BusinessDetail
  reviews?: BusinessDetail['reviews']
  avgRating?: number
  reviewsCount?: number
  promotions?: { id: number; name: string; description?: string; type?: string; value?: string }[]
  menu_items?: MenuItem[]
  gallery?: MediaItem[]
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
          {item.description && (
            <p className="text-sm text-[#6B7280] leading-relaxed">{item.description}</p>
          )}

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
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null)
  const [shareSuccess, setShareSuccess] = useState(false)

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

  // Record browsing history when place data loads
  useEffect(() => {
    if (data?.business) {
      const b = data.business
      const rawCat = categoryName(b.category)
      const group: DiscoveryGroup = getDiscoveryGroup(rawCat, b.business_category_id)
      recordBrowsedPlace({
        id: b.id,
        name: b.name || b.business_name || '',
        category: rawCat,
        discoveryGroup: group,
        cover_photo: b.cover_photo,
        logo: b.logo,
        municipality: b.municipality?.name || b.address || 'Bansud, Oriental Mindoro',
        rating: data.avgRating ?? b.rating ?? null,
        url: `/tourist/explore/${b.id}`,
      })
    }
  }, [data?.business, data?.avgRating])

  const handleShare = () => {
    const url = window.location.href
    const title = data?.business?.name || 'TrackTour Destination'
    if (navigator.share) {
      navigator.share({ title, url }).catch(() => {})
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
      setShareSuccess(true)
      setTimeout(() => setShareSuccess(false), 2500)
    }
  }

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

  const business = data?.business
  const detailsMap = useMemo(() => {
    if (!business) return {} as Record<string, any>
    if (business.category_details) return business.category_details
    if (Array.isArray(business.details)) {
      return business.details.reduce((acc, curr) => {
        acc[curr.field_name] = curr.field_value
        return acc
      }, {} as Record<string, any>)
    }
    return (business.details as Record<string, any>) || {}
  }, [business])

  const allMedia = useMemo(() => {
    const list: MediaItem[] = []
    if (!business) return list
    if (Array.isArray(data?.gallery)) list.push(...data.gallery)
    if (Array.isArray(business.media)) {
      business.media.forEach((m) => {
        if (!list.some((existing) => existing.file_path === m.file_path)) {
          list.push(m)
        }
      })
    }
    return list
  }, [data?.gallery, business])

  if (isLoading) return <DashboardSkeleton />
  if (!business) return <div className="text-center py-20 text-[#6B7280]">Business not found.</div>

  const catLabel = categoryName(business.category)
  const discoveryGroup: DiscoveryGroup = getDiscoveryGroup(catLabel, business.business_category_id)
  const isSpot = discoveryGroup === 'spot'
  const isAccommodation = discoveryGroup === 'accommodation'

  const accepting = business.is_accepting_orders ?? business.is_open
  const bizName = business.name || business.business_name || ''
  const bizCover = business.cover_photo ? toAssetUrl(business.cover_photo) : ''
  const bizLogo = business.logo ? toAssetUrl(business.logo) : ''
  const description = business.description || business.business_description || ''
  const phone = business.phone || business.contact_number || ''
  const reviews = data?.reviews ?? business.reviews ?? []
  const avgRating = data?.avgRating ?? business.rating ?? 0
  const promotions = data?.promotions ?? []
  const menuItems = business.menu_items?.length ? business.menu_items : (data?.menu_items ?? [])

  const photos = allMedia.filter((m) => !m.file_path.endsWith('.mp4') && !m.file_path.endsWith('.mov') && m.type !== 'Promotional Video')
  const videos = allMedia.filter((m) => m.file_path.endsWith('.mp4') || m.file_path.endsWith('.mov') || m.type === 'Promotional Video')

  const entranceFee = detailsMap.entrance_fee
  const attractionType = detailsMap.attraction_type
  const activities = detailsMap.activities
  const visitDuration = detailsMap.estimated_visit_duration
  const guidedTour = detailsMap.guided_tour_available

  const hasCoords = Boolean(business.latitude && business.longitude)
  const directionsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${business.latitude},${business.longitude}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bizName + ' Bansud')}`

  return (
    <div className="pb-24 max-w-6xl mx-auto px-4 sm:px-6">
      {/* Navigation header */}
      <div className="flex items-center justify-between mb-6 pt-2">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm font-medium text-[#6B7280] hover:text-[#17201B] transition">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        {shareSuccess && (
          <span className="text-xs bg-[#E9F7EF] text-[#087F3F] px-3 py-1 rounded-full font-semibold animate-fade-in">
            Link copied to clipboard!
          </span>
        )}
      </div>

      {/* Hero Banner */}
      <div className="relative rounded-3xl overflow-hidden mb-6 h-56 sm:h-72 lg:h-80 shadow-md">
        {bizCover ? (
          <img src={bizCover} alt={bizName} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-[#087F3F] via-[#056B35] to-[#17201B] flex items-center justify-center">
            <Compass className="w-16 h-16 text-white/30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />

        {bizLogo && (
          <div className="absolute bottom-5 left-5 w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden ring-4 ring-white/90 shadow-lg bg-white">
            <img src={bizLogo} alt={bizName} className="w-full h-full object-cover" />
          </div>
        )}

        <div className={`absolute bottom-5 left-5 right-5 flex items-end justify-between ${bizLogo ? 'pl-20 sm:pl-24' : ''}`}>
          <div className="text-white">
            <span className="inline-block px-2.5 py-0.5 rounded-full bg-white/20 backdrop-blur-md text-[11px] font-semibold text-emerald-200 border border-white/20 mb-1.5">
              {isSpot ? 'Tourist Spot' : isAccommodation ? 'Accommodation' : catLabel || 'Business'}
            </span>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white drop-shadow-sm leading-tight">
              {bizName}
            </h1>
            <p className="text-xs sm:text-sm text-gray-200 mt-1 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
              {[business.barangay?.name, business.municipality?.name].filter(Boolean).join(', ') || 'Bansud, Oriental Mindoro'}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleShare}
              title="Share destination"
              className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center text-white hover:bg-white/30 transition shadow-sm"
            >
              <Share2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => favoriteMutation.mutate()}
              title="Save to favorites"
              className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-full flex items-center justify-center transition hover:bg-white/30 shadow-sm"
            >
              <Heart className={`w-5 h-5 ${business.is_favorited ? 'fill-red-500 text-red-500' : 'text-white'}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2 cols) */}
        <div className="lg:col-span-2 space-y-6">
          {/* About / Description */}
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 shadow-sm">
            <h2 className="text-lg font-bold text-[#17201B] mb-3">
              {isSpot ? 'About & History' : 'About'}
            </h2>
            <p className="text-sm text-[#4B5563] leading-relaxed whitespace-pre-line">
              {description || 'Discover and explore this wonderful place in Bansud, Oriental Mindoro.'}
            </p>

            {isSpot && attractionType && (
              <div className="mt-4 pt-4 border-t border-[#EFF3F0] flex items-center gap-2">
                <span className="text-xs font-semibold text-[#68736D]">Type of Attraction:</span>
                <span className="px-2.5 py-1 rounded-full bg-[#E9F7EF] text-[#087F3F] text-xs font-medium">
                  {attractionType}
                </span>
              </div>
            )}
          </div>

          {/* Activities & Natural Features (For Tourist Spots) */}
          {isSpot && (activities || visitDuration || guidedTour) && (
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-bold text-[#17201B] mb-3">Activities &amp; Highlights</h2>
              {activities && (
                <p className="text-sm text-[#4B5563] leading-relaxed">{activities}</p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                {visitDuration && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F8FAF9] border border-[#E5E9E7] text-xs text-[#17201B]">
                    <Clock className="w-4 h-4 text-[#087F3F]" />
                    <span>Est. Visit: <strong>{visitDuration}</strong></span>
                  </div>
                )}
                {guidedTour && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E9F7EF] text-[#087F3F] text-xs font-semibold">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Guided Tours Available</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Photos Gallery */}
          {photos.length > 0 && (
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-[#17201B] flex items-center gap-2">
                  <Camera className="w-5 h-5 text-[#087F3F]" /> Photo Gallery
                </h2>
                <span className="text-xs text-[#68736D]">{photos.length} photo{photos.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {photos.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => setSelectedPhoto(item.file_path)}
                    className="relative aspect-[4/3] rounded-xl overflow-hidden cursor-pointer group bg-gray-100 border border-[#E5E9E7]"
                  >
                    <img
                      src={toAssetUrl(item.file_path)}
                      alt={item.title || 'Attraction gallery'}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                    />
                    {item.caption && (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-white text-[11px] truncate">
                        {item.caption}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Promotional Videos */}
          {videos.length > 0 && (
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-bold text-[#17201B] flex items-center gap-2 mb-4">
                <Video className="w-5 h-5 text-[#087F3F]" /> Promotional Videos
              </h2>
              <div className="space-y-4">
                {videos.map((vid) => (
                  <div key={vid.id} className="rounded-xl overflow-hidden border border-[#E5E9E7] bg-black">
                    <video
                      src={toAssetUrl(vid.file_path)}
                      controls
                      preload="metadata"
                      className="w-full max-h-80"
                    />
                    {vid.title && (
                      <div className="p-3 bg-white border-t border-[#E5E9E7]">
                        <p className="text-sm font-semibold text-[#17201B]">{vid.title}</p>
                        {vid.caption && <p className="text-xs text-[#68736D] mt-0.5">{vid.caption}</p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Promotions (if any) */}
          {promotions.length > 0 && (
            <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 shadow-sm">
              <h2 className="text-lg font-bold text-[#17201B] mb-4">Special Offers &amp; Announcements</h2>
              <div className="space-y-3">
                {promotions.map((p) => (
                  <div key={p.id} className="p-4 rounded-xl bg-[#FFF7D6] border border-[#F4B400]/40">
                    <p className="text-sm font-semibold text-[#17201B]">{p.name}</p>
                    {p.description && <p className="text-xs text-[#6B7280] mt-1">{p.description}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Visitor Reviews */}
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[#17201B]">Visitor Reviews</h2>
              {avgRating > 0 && (
                <div className="flex items-center gap-1.5 text-sm font-semibold text-[#17201B]">
                  <Star className="w-4 h-4 text-amber-400 fill-current" />
                  <span>{Number(avgRating).toFixed(1)}</span>
                  <span className="text-xs text-[#9CA3AF]">({reviews.length})</span>
                </div>
              )}
            </div>

            {reviews.length > 0 ? (
              <div className="space-y-3">
                {reviews.map((r) => (
                  <div key={r.id} className="p-4 rounded-xl bg-[#F8FAF9] border border-[#E5E9E7]">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-[#17201B]">{r.user_name}</span>
                      <div className="flex items-center gap-1 text-amber-400 text-xs">
                        <Star className="w-3.5 h-3.5 fill-current" /> {r.rating}
                      </div>
                    </div>
                    <p className="text-sm text-[#4B5563] leading-relaxed">{r.comment}</p>
                    <p className="text-[11px] text-[#9CA3AF] mt-2">{formatDateTime(r.created_at)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[#68736D] text-center py-6">
                No visitor reviews yet. Be the first to share your experience!
              </p>
            )}
          </div>
        </div>

        {/* Right Sidebar Column */}
        <div className="space-y-5">
          {/* Main Info Card */}
          <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 space-y-4 shadow-sm">
            <h3 className="font-bold text-[#17201B] text-base border-b border-[#EFF3F0] pb-3">
              {isSpot ? 'Visitor Information' : isAccommodation ? 'Property Details' : 'Business Information'}
            </h3>

            {/* Operating status ONLY for dining */}
            {!isSpot && (
              <div className="flex items-center gap-2">
                <StatusBadge status={business.status} size="md" />
                <span className={`text-sm font-medium ${accepting ? 'text-[#087F3F]' : 'text-[#B91C1C]'}`}>
                  {accepting ? 'Open Now' : 'Closed'}
                </span>
              </div>
            )}

            {!isSpot && !accepting && (
              <div className="rounded-xl border border-[#B91C1C]/20 bg-[#FEE2E2]/80 px-3 py-2.5">
                <p className="text-xs font-semibold text-[#B91C1C]">This business is currently closed and not accepting orders.</p>
              </div>
            )}

            {/* Verified Entrance Fee (Attractions) */}
            {isSpot && entranceFee && (
              <div className="flex items-center gap-3 text-sm text-[#17201B] bg-[#E9F7EF] p-3 rounded-xl">
                <Ticket className="w-5 h-5 text-[#087F3F] shrink-0" />
                <div>
                  <p className="text-xs text-[#087F3F] font-semibold">Entrance Fee</p>
                  <p className="font-bold">{entranceFee}</p>
                </div>
              </div>
            )}

            {/* Price Range */}
            {business.price_range && !isSpot && (
              <div className="text-sm text-[#4B5563]">
                <span className="font-semibold text-[#17201B]">Price Range:</span> {business.price_range}
              </div>
            )}

            {/* Verified Visiting / Operating Hours */}
            {business.opening_time && business.closing_time && (
              <div className="flex items-start gap-2.5 text-sm text-[#4B5563]">
                <Clock className="w-4 h-4 text-[#087F3F] mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-[#17201B]">{isSpot ? 'Visiting Hours' : 'Hours'}</p>
                  <p className="text-xs text-[#68736D] mt-0.5">{business.opening_time} – {business.closing_time}</p>
                </div>
              </div>
            )}

            {/* Address */}
            <div className="flex items-start gap-2.5 text-sm text-[#4B5563]">
              <MapPin className="w-4 h-4 text-[#087F3F] mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-[#17201B]">Location</p>
                <p className="text-xs text-[#68736D] mt-0.5">{business.address || 'Bansud, Oriental Mindoro'}</p>
                <p className="text-[11px] text-[#9CA3AF]">
                  {[business.barangay?.name, business.municipality?.name].filter(Boolean).join(', ') || 'Bansud, Oriental Mindoro'}
                </p>
              </div>
            </div>

            {/* Phone */}
            {phone && (
              <div className="flex items-center gap-2.5 text-sm text-[#4B5563]">
                <Phone className="w-4 h-4 text-[#087F3F] shrink-0" />
                <span className="text-xs font-medium">{phone}</span>
              </div>
            )}

            {/* Email */}
            {business.email && (
              <div className="flex items-center gap-2.5 text-sm text-[#4B5563]">
                <Mail className="w-4 h-4 text-[#087F3F] shrink-0" />
                <span className="text-xs font-medium truncate">{business.email}</span>
              </div>
            )}

            {/* Action Button: Get Directions */}
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-3 bg-[#087F3F] hover:bg-[#056B35] text-white rounded-xl text-sm font-semibold transition shadow-sm mt-3"
            >
              <Navigation className="w-4 h-4" /> Get Directions
            </a>

            {/* View on interactive tourist map */}
            <button
              onClick={() => navigate('/tourist/explore/map')}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-[#D7E8DB] hover:bg-[#F3F8F4] text-[#087F3F] rounded-xl text-xs font-semibold transition"
            >
              <Compass className="w-4 h-4" /> View on Map
            </button>
          </div>
        </div>
      </div>

      {/* Restaurant Menu section: ONLY RENDERED FOR DINING CATEGORY */}
      {!isSpot && !isAccommodation && menuItems.length > 0 && (
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-6 mt-8 shadow-sm">
          <h2 className="text-lg font-bold text-[#17201B] mb-4">Menu</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {menuItems.map((item: MenuItem) => {
              const qty = getItemQty(item.id)
              return (
                <div
                  key={item.id}
                  className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden hover:shadow-lg hover:shadow-[#087F3F]/8 transition group cursor-pointer"
                  onClick={() => item.is_available && accepting && setDetailItem(item)}
                >
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
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Floating Cart Bar (ONLY FOR DINING) */}
      {!isSpot && !isAccommodation && cartCount > 0 && (
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

      {/* Food Detail Modal (ONLY FOR DINING) */}
      {!isSpot && !isAccommodation && detailItem && business && (
        <FoodDetailModal
          item={detailItem}
          business={business}
          accepting={accepting}
          onClose={() => setDetailItem(null)}
          onAdd={addToCart}
        />
      )}

      {/* Photo Lightbox Modal */}
      {selectedPhoto && (
        <div className="fixed inset-0 z-[3500] bg-black/90 flex items-center justify-center p-4" onClick={() => setSelectedPhoto(null)}>
          <button
            onClick={() => setSelectedPhoto(null)}
            className="absolute top-4 right-4 p-2 bg-white/20 hover:bg-white/40 text-white rounded-full transition"
          >
            <X className="w-6 h-6" />
          </button>
          <img
            src={toAssetUrl(selectedPhoto)}
            alt="Enlarged view"
            className="max-w-full max-h-[85vh] object-contain rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
