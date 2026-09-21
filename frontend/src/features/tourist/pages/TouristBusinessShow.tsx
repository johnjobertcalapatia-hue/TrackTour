import { useMemo, useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, categoryName, cn, toAssetUrl } from '@/shared/utils'
import { useRequireAuth } from '@/shared/hooks/use-require-auth'
import {
  ArrowLeft, Star, MapPin, Phone, Clock, Heart, Share2, Flag, ShoppingCart, X, Plus,
  BedDouble, UtensilsCrossed, Navigation, Calendar, Check, Image as ImageIcon, Mail, Minus,
} from 'lucide-react'

interface Offering {
  id: number
  name: string
  price: number | string
  description?: string
  image: string | null
  is_available: boolean
  is_featured?: boolean
  bestseller?: boolean
  badge?: string
  rating?: number | null
  category?: unknown
}

interface OfferingCategory {
  id: number
  name: string
  offerings?: Offering[]
}

interface GalleryItem {
  id: number
  url?: string
  file_path?: string
  path?: string
}
type GalleryData = GalleryItem

interface Review {
  id: number
  user_name?: string
  rating: number
  comment?: string
  created_at: string
}

interface BusinessDetail {
  business: {
    id: number
    name: string
    business_name?: string
    business_description?: string
    description?: string
    category: unknown
    municipality: { name: string } | string | null
    barangay?: { name: string } | string | null
    address: string
    phone?: string
    contact_number?: string
    email?: string
    website?: string
    facebook?: string
    instagram?: string
    logo: string | null
    cover_photo: string | null
    opening_time?: string | null
    closing_time?: string | null
    business_days?: string[] | null
    facilities?: string | null
    services?: string | null
  }
  reviews: Review[]
  avgRating: number
  reviewsCount: number
  offerings: Offering[]
  offeringCategories: OfferingCategory[]
  gallery: GalleryData[]
  isFavorited: boolean
  isOpen: boolean
}

const CAT_FOOD = /(restaurant|food|cafe|dining|grill|food hub|fast|eatery|f\xc8de)/
const CAT_HOTEL = /(hotel|resort|inn|homestay|camping|bed|hostel|lodge)/
const CAT_ATTRACTION = /(attraction|tourist|park|mountain|beach|cave|falls|waterfall|nature|landmark|farm)/
const CAT_TRANSPORT = /(transport|tricycle|van|boat|bus|ride|rental|travel agency|ferry)/

type Tab = 'menu' | 'reviews' | 'photos' | 'info'
const TABS: Tab[] = ['menu', 'reviews', 'photos', 'info']

export default function TouristBusinessShow() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { requireAuth } = useRequireAuth()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('menu')
  const [activeCat, setActiveCat] = useState<number | 'all'>('all')
  const [detail, setDetail] = useState<Offering | null>(null)
  const [cartItems, setCartItems] = useState<number>(0)

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-business', id],
    queryFn: () => get<BusinessDetail>(`/tourist/explore/${id}`),
  })

  const favoriteMutation = useMutation({
    mutationFn: () => post('/tourist/favorites/toggle', { business_id: Number(id) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tourist-business', id] }),
  })

  const categories = data?.offeringCategories ?? []
  const catName = data?.business?.category ? categoryName(data.business.category) : ''
  const bizType = typeOf(catName)

  const filteredOfferings = useMemo(() => {
    const all = data?.offerings ?? []
    if (activeCat === 'all') return all
    const cat = (data?.offeringCategories ?? []).find((c) => c.id === activeCat)
    const ids = new Set((cat?.offerings ?? []).map((o) => o.id))
    return all.filter((o) => ids.has(o.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, activeCat])

  // Listen for cart changes from this page
  useEffect(() => {
    const sync = () => {
      const cart = JSON.parse(localStorage.getItem('food_cart') || '[]')
      setCartItems(cart.reduce((s: number, c: any) => s + c.quantity, 0))
    }
    sync()
    window.addEventListener('cart-updated', sync)
    return () => window.removeEventListener('cart-updated', sync)
  }, [])

  if (isLoading) return <DashboardSkeleton />
  if (!data) return <div className="text-center py-24 text-muted">Business not found.</div>

  const b = data.business
  const bizName = b.name || b.business_name || ''
  const bizCover = toAssetUrl(b.cover_photo)
  const bizLogo = toAssetUrl(b.logo)
  const description = b.business_description || b.description
  const phone = b.phone || b.contact_number
  const rating = data.avgRating || 0
  const galleryImages = (data.gallery ?? [])
    .map((g) => toAssetUrl(g.url || g.file_path || g.path))
    .filter(Boolean)

  const addToCart = (item: Offering, qty = 1) => {
    if (item.is_available === false) return
    const cart = JSON.parse(localStorage.getItem('food_cart') || '[]')
    const existing = cart.find((c: any) => c.id === item.id)
    if (existing) existing.quantity += qty
    else cart.push({ id: item.id, name: item.name, price: Number(item.price), image: item.image, business_name: bizName, business_id: b.id, quantity: qty })
    localStorage.setItem('food_cart', JSON.stringify(cart))
    setCartItems(cart.reduce((s: number, c: any) => s + c.quantity, 0))
    window.dispatchEvent(new Event('cart-updated'))
  }

  const share = async () => {
    const url = window.location.href
    if (navigator.share) {
      try { await navigator.share({ title: bizName, url }) } catch { /* cancelled */ }
    } else {
      navigator.clipboard?.writeText(url)
    }
  }

  return (
    <div className="animate-[fade-in-up_0.4s_ease-out]">
      <BackBar onBack={() => navigate(-1)} />

      {/* Hero */}
      <div className="relative rounded-[24px] overflow-hidden h-[260px] sm:h-[260px] -mt-2">
        {bizCover ? (
          <img src={bizCover} alt={bizName} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-brand via-brand-dark to-night" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-night via-night/30 to-transparent" />
        <div className="absolute bottom-0 inset-x-0 p-5 sm:p-6">
          <div className="flex items-end justify-between gap-4">
            <div className="flex items-end gap-3 sm:gap-4 min-w-0">
              <div className="relative shrink-0">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden border-2 border-white/20 shadow-xl bg-night-card">
                  {bizLogo ? <img src={bizLogo} alt="" className="w-full h-full object-cover" /> : <EmptyLogo />}
                </div>
                <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-brand border-2 border-night flex items-center justify-center"><Check className="w-3 h-3 text-white" /></span>
              </div>
              <div className="min-w-0">
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-white leading-tight truncate">{bizName}</h1>
                <p className="text-xs sm:text-sm text-brand-light font-medium mt-0.5">{catName}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
                  {rating > 0 && (
                    <span className="flex items-center gap-1 text-white text-sm font-semibold">
                      <Star className="w-4 h-4 text-gold fill-current" /> {rating.toFixed(1)}
                      <span className="text-xs text-muted">({data.reviewsCount ?? 0})</span>
                    </span>
                  )}
                  <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold', data.isOpen ? 'bg-brand text-white' : 'bg-white/15 text-gray-200')}>
                    {data.isOpen ? 'Open Now' : 'Closed'}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <IconBtn label="Favorite" onClick={() => favoriteMutation.mutate()}><Heart className={cn('w-5 h-5', data.isFavorited ? 'fill-gold text-gold' : 'text-white')} /></IconBtn>
              <IconBtn label="Share" onClick={share}><Share2 className="w-5 h-5 text-white" /></IconBtn>
              <IconBtn label="Report"><Flag className="w-5 h-5 text-white" /></IconBtn>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-16 z-30 bg-night-soft/90 backdrop-blur-xl border-b border-white/5 mt-3">
        <div className="flex">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn('px-5 py-3 text-sm font-semibold capitalize whitespace-nowrap transition border-b-2', tab === t ? 'text-brand-light border-brand' : 'text-muted border-transparent hover:text-white')}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="py-6 space-y-6">
        {tab === 'menu' && (
          <div className="space-y-6">
            {categories.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                <Chip active={activeCat === 'all'} onClick={() => setActiveCat('all')}>All</Chip>
                {categories.map((c) => (
                  <Chip key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>{c.name}</Chip>
                ))}
              </div>
            )}

            {description && (
              <div className="bg-night-card rounded-[20px] border border-white/5 p-5">
                <h2 className="text-lg font-bold text-white mb-2">About</h2>
                <p className="text-sm text-muted leading-relaxed">{description}</p>
              </div>
            )}

            {filteredOfferings.length === 0 ? (
              <div className="text-center py-16 text-muted">
                {isFood(bizType) ? 'No menu items available yet.' : 'No products or services available yet.'}
              </div>
            ) : (
              <div className="grid grid-cols-2 min-[480px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {filteredOfferings.map((o) => (
                  <FoodCard key={o.id} item={o} onOpen={() => setDetail(o)} onAdd={() => addToCart(o)} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'reviews' && (
          <ReviewsTab rating={rating} count={data.reviewsCount ?? 0} reviews={data.reviews ?? []} />
        )}

        {tab === 'photos' && (
          <PhotosTab images={galleryImages} />
        )}

        {tab === 'info' && (
          <InfoTab business={b} isOpen={data.isOpen} />
        )}
      </div>

      {/* Action bar + floating cart */}
      <ActionBar
        type={bizType}
        phone={phone}
        address={b.address}
        cartActive={isFood(bizType) && cartItems > 0}
        onCall={() => phone && (window.location.href = `tel:${phone}`)}
        onDirections={() => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(b.address || bizName)}`, '_blank')}
        onCart={() => navigate('/tourist/food/cart')}
        onBook={() => {
          if (requireAuth({
            type: bizType === 'transport' ? 'business_service' : 'resort_booking',
            restaurantId: b.id,
            returnPath: `/tourist/explore/${id}`,
          })) {
            navigate('/tourist/food/cart')
          }
        }}
      />

      {/* Floating cart (restaurants) — replaces fixed bar when items exist */}
      {isFood(bizType) && cartItems > 0 && (
        <FloatingCart items={cartItems} onView={() => navigate('/tourist/food/cart')} />
      )}

      {/* Product details modal */}
      {detail && (
        <ProductModal item={detail} onAdd={(qty) => addToCart(detail, qty)} onClose={() => setDetail(null)} />
      )}
    </div>
  )
}

function isFood(t: string) { return t === 'restaurant' }

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="inline-flex items-center gap-2 text-sm text-muted hover:text-white mb-4 transition">
      <ArrowLeft className="w-4 h-4" /> Back
    </button>
  )
}

function IconBtn({ children, onClick, label }: { children: React.ReactNode; onClick?: () => void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label} className="w-10 h-10 rounded-full bg-black/40 border border-white/15 flex items-center justify-center hover:scale-110 active:scale-95 transition">
      {children}
    </button>
  )
}

function EmptyLogo() {
  return <div className="w-full h-full flex items-center justify-center text-gold"><BedDouble className="w-8 h-8" /></div>
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'shrink-0 px-4 py-2 rounded-full text-sm font-semibold transition border',
        active ? 'bg-brand text-white border-brand shadow-lg shadow-brand/30' : 'bg-night-card text-muted border-white/10 hover:text-white'
      )}
    >
      {children}
    </button>
  )
}

function badgeFor(item: Offering): { label: string; cls: string } | null {
  if (item.bestseller) return { label: 'Best Seller', cls: 'bg-gold text-night' }
  const tag = (item.badge || '').toLowerCase()
  if (tag.includes('new')) return { label: 'New', cls: 'bg-brand text-white' }
  if (tag.includes('limited')) return { label: 'Limited', cls: 'bg-red-500 text-white' }
  if (tag.includes('popular')) return { label: 'Popular', cls: 'bg-emerald-600 text-white' }
  if (tag.includes('recommend')) return { label: 'Recommended', cls: 'bg-blue-600 text-white' }
  return null
}

function FoodCard({ item, onOpen, onAdd }: { item: Offering; onOpen: () => void; onAdd: () => void }) {
  const unavailable = item.is_available === false
  const badge = badgeFor(item)
  const rating = item.rating ?? 0
  return (
    <div
      onClick={unavailable ? undefined : onOpen}
      className={cn(
        'group bg-night-card rounded-2xl border border-white/5 overflow-hidden cursor-pointer hover:border-brand/40 hover:scale-[1.02] hover:shadow-lg hover:shadow-black/40 transition-all duration-200',
        unavailable && 'opacity-60 cursor-default'
      )}
    >
      <div className="relative h-[104px] sm:h-[116px] overflow-hidden bg-night-soft">
        {item.image ? (
          <img src={toAssetUrl(item.image)} alt={item.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted"><ImageIcon className="w-6 h-6" /></div>
        )}
        {badge && (
          <span className={cn('absolute top-2 left-2 text-[9px] px-1.5 py-0.5 rounded-full font-bold', badge.cls)}>{badge.label}</span>
        )}
      </div>
      <div className="p-2.5">
        <h3 className="text-[15px] font-semibold text-white leading-tight line-clamp-1">{item.name}</h3>
        <div className="flex items-center justify-between mt-1.5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-brand-light">{formatCurrency(Number(item.price))}</p>
            {rating > 0 && (
              <p className="flex items-center gap-0.5 text-[11px] text-muted">
                <Star className="w-2.5 h-2.5 text-gold fill-current" /> {rating.toFixed(1)}
              </p>
            )}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); if (!unavailable) onAdd() }}
            disabled={unavailable}
            aria-label={unavailable ? 'Unavailable' : `Add ${item.name} to cart`}
            className={cn(
              'w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition active:scale-90',
              unavailable ? 'bg-white/10 text-muted cursor-not-allowed' : 'bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/30'
            )}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function FloatingCart({ items, onView }: { items: number; onView: () => void }) {
  const cart = JSON.parse(localStorage.getItem('food_cart') || '[]')
  const total = cart.reduce((s: number, c: any) => s + Number(c.price || 0) * c.quantity, 0)
  return (
    <div className="fixed bottom-16 md:bottom-6 inset-x-0 z-50 px-4">
      <button
        onClick={onView}
        className="w-full max-w-md mx-auto flex items-center justify-between bg-brand hover:bg-brand-dark text-white rounded-2xl px-5 py-4 shadow-2xl shadow-brand/40 animate-[slide-up_0.3s_ease-out]"
      >
        <span className="flex items-center gap-3">
          <span className="relative">
            <ShoppingCart className="w-6 h-6" />
            <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-gold text-night text-[10px] font-bold flex items-center justify-center">{items}</span>
          </span>
          <span className="font-semibold">{items} {items === 1 ? 'item' : 'items'}</span>
        </span>
        <span className="flex items-center gap-2 font-bold">
          {formatCurrency(total)} <ChevronIcon />
        </span>
      </button>
    </div>
  )
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
      <path d="m9 18 6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ProductModal({ item, onAdd, onClose }: { item: Offering; onAdd: (qty: number) => void; onClose: () => void }) {
  const [qty, setQty] = useState(1)
  const unavailable = item.is_available === false
  const rating = item.rating ?? 0
  const badge = badgeFor(item)
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-night-card rounded-t-3xl sm:rounded-3xl border border-white/10 shadow-2xl animate-[slideUp_0.3s_ease-out] max-h-[90vh] overflow-y-auto">
        <div className="relative h-52 overflow-hidden rounded-t-3xl sm:rounded-t-3xl bg-night-soft">
          {item.image ? <img src={toAssetUrl(item.image)} alt={item.name} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted"><ImageIcon className="w-12 h-12" /></div>}
          {badge && <span className={cn('absolute top-3 left-3 text-[11px] px-2 py-1 rounded-full font-bold', badge.cls)}>{badge.label}</span>}
          <button onClick={onClose} aria-label="Close" className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/50 border border-white/15 flex items-center justify-center text-white hover:bg-black/70 transition">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white flex-1">{item.name}</h2>
            <p className="text-lg font-bold text-brand-light">{formatCurrency(Number(item.price))}</p>
          </div>
          {rating > 0 && (
            <div className="flex items-center gap-1.5 mt-2 text-gold">
              <Star className="w-4 h-4 fill-current" /> <span className="text-sm font-semibold text-white">{rating.toFixed(1)}</span>
            </div>
          )}
          <div className="mt-4">
            <h3 className="text-sm font-semibold text-white mb-1.5">Description</h3>
            <p className="text-sm text-muted leading-relaxed">{item.description || 'No description available.'}</p>
          </div>
          <div className="mt-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 bg-white/5 rounded-2xl p-1">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease" className="w-9 h-9 rounded-xl bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition"><Minus className="w-4 h-4" /></button>
              <span className="w-8 text-center font-semibold text-white">{qty}</span>
              <button onClick={() => setQty((q) => q + 1)} aria-label="Increase" className="w-9 h-9 rounded-xl bg-brand text-white flex items-center justify-center hover:bg-brand-dark transition"><Plus className="w-4 h-4" /></button>
            </div>
            <button
              onClick={() => { onAdd(qty); onClose() }}
              disabled={unavailable}
              className={cn('flex-1 py-3 rounded-2xl font-bold text-sm transition', unavailable ? 'bg-white/10 text-muted cursor-not-allowed' : 'bg-brand hover:bg-brand-dark text-white shadow-lg shadow-brand/30')}
            >
              {unavailable ? 'Unavailable' : `Add ${qty} · ${formatCurrency(Number(item.price) * qty)}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReviewsTab({ rating, count, reviews }: { rating: number; count: number; reviews: Review[] }) {
  return (
    <div className="space-y-5">
      <div className="bg-night-card rounded-[20px] border border-white/5 p-6 text-center">
        <div className="flex items-center justify-center gap-1.5 text-gold">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} className={cn('w-6 h-6', i < Math.round(rating) ? 'fill-current' : 'text-white/20')} />
          ))}
        </div>
        <p className="text-3xl font-extrabold text-white mt-2">{rating.toFixed(1)}</p>
        <p className="text-sm text-muted mt-1">Based on {count} reviews</p>
      </div>
      {reviews.length === 0 ? (
        <div className="text-center py-12 text-muted">No reviews yet.</div>
      ) : (
        reviews.map((r) => (
          <div key={r.id} className="bg-night-card rounded-[20px] border border-white/5 p-5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white text-sm">{r.user_name || 'Anonymous'}</span>
              <span className="flex items-center gap-1 text-gold text-sm"><Star className="w-4 h-4 fill-current" /> {r.rating}</span>
            </div>
            <p className="text-sm text-muted mt-2 leading-relaxed">{r.comment || 'No comment.'}</p>
            <p className="text-xs text-gray-500 mt-3">{new Date(r.created_at).toLocaleDateString()}</p>
          </div>
        ))
      )}
    </div>
  )
}

function PhotosTab({ images }: { images: string[] }) {
  if (images.length === 0) return <div className="text-center py-16 text-muted">No photos yet.</div>
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {images.map((src, i) => (
        <div key={i} className="aspect-square rounded-2xl overflow-hidden bg-night-card group cursor-pointer">
          <img src={src} alt={`Photo ${i + 1}`} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
        </div>
      ))}
    </div>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-3">
      <span className="mt-0.5 text-brand-light w-5 h-5 shrink-0">{icon}</span>
      <div>
        <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
        <p className="text-sm text-white mt-0.5">{value}</p>
      </div>
    </div>
  )
}

function InfoTab({ business, isOpen }: { business: BusinessDetail['business']; isOpen: boolean }) {
  const phone = business.phone || business.contact_number
  const addr = [business.address, business.barangay && (typeof business.barangay === 'string' ? business.barangay : business.barangay.name), business.municipality && (typeof business.municipality === 'string' ? business.municipality : business.municipality.name)].filter(Boolean).join(', ')

  return (
    <div className="bg-night-card rounded-[20px] border border-white/5 p-5 sm:p-6">
      <h2 className="text-lg font-bold text-white mb-2">Information</h2>
      <div className="divide-y divide-white/5">
        <InfoRow icon={<Clock className="w-4 h-4 text-gold" />} label="Status" value={isOpen ? 'Open Now' : 'Closed'} />
        {business.opening_time && business.closing_time && (
          <InfoRow icon={<Clock className="w-4 h-4 text-gold" />} label="Opening Hours" value={`${business.opening_time} – ${business.closing_time}`} />
        )}
        <InfoRow icon={<MapPin className="w-4 h-4 text-gold" />} label="Address" value={addr} />
        {phone && <InfoRow icon={<Phone className="w-4 h-4 text-gold" />} label="Phone" value={phone} />}
        {business.email && <InfoRow icon={<Mail />} label="Email" value={business.email} />}
        {business.services && <InfoRow icon={<UtensilsCrossed className="w-4 h-4 text-gold" />} label="Services" value={business.services} />}
      </div>
    </div>
  )
}

function typeOf(cat: string): string {
  if (CAT_FOOD.test(cat)) return 'restaurant'
  if (CAT_HOTEL.test(cat)) return 'hotel'
  if (CAT_ATTRACTION.test(cat)) return 'attraction'
  if (CAT_TRANSPORT.test(cat)) return 'transport'
  return 'other'
}

function ActionBar({ type, phone, address, cartActive, onCall, onDirections, onCart, onBook }: {
  type: string
  phone?: string
  address?: string
  cartActive?: boolean
  onCall: () => void
  onDirections: () => void
  onCart: () => void
  onBook: () => void
}) {
  if (cartActive) return null
  return (
    <div className="fixed bottom-0 inset-x-0 z-40 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
      <div className="bg-night-soft/95 backdrop-blur-xl border-t border-white/10 px-4 py-3 max-w-md mx-auto md:max-w-full md:px-6 lg:px-10">
        <div className="flex items-center gap-2.5 max-w-[1280px] mx-auto">
          {phone && (
            <ActionButton onClick={onCall}><Phone className="w-4 h-4" /> Call</ActionButton>
          )}
          {address && (
            <ActionButton onClick={onDirections}><Navigation className="w-4 h-4" /> Directions</ActionButton>
          )}
          {type === 'restaurant' && (
            <button onClick={onCart} className="flex-1 flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white rounded-2xl px-4 py-3 text-sm font-bold transition shadow-lg shadow-brand/30">
              <ShoppingCart className="w-4 h-4" /> View Cart
            </button>
          )}
          {(type === 'hotel' || type === 'attraction') && (
            <button onClick={onBook} className="flex-1 flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white rounded-2xl px-4 py-3 text-sm font-bold transition shadow-lg shadow-brand/30">
              <Calendar className="w-4 h-4" /> Book
            </button>
          )}
          {type === 'transport' && (
            <button onClick={onBook} className="flex-1 flex items-center justify-center gap-2 bg-brand hover:bg-brand-dark text-white rounded-2xl px-4 py-3 text-sm font-bold transition shadow-lg shadow-brand/30">
              <BedDouble className="w-4 h-4" /> Book Ride
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ActionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-2xl px-4 py-3 text-sm font-semibold transition">
      {children}
    </button>
  )
}