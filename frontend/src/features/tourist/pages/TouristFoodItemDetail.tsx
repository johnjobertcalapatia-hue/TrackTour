import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { forgetBrowsedPlace, recordBrowsedPlace } from '@/shared/services/browsing-history'
import { isNotFoundError } from '@/shared/components/PlaceUnavailable'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import FoodImageCarousel from '@/features/tourist/components/FoodImageCarousel'
import { cn, formatCurrency, toAssetUrl } from '@/shared/utils'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  MapPin,
  MessageCircle,
  Minus,
  Phone,
  Plus,
  ShoppingCart,
  Star,
  Store,
  Info,
  UtensilsCrossed,
  Zap,
} from 'lucide-react'

export interface FoodDetailVariation {
  id: number
  name: string
  price: number
  is_available: boolean
}

export interface FoodDetailReview {
  id: number
  rating: number
  review: string | null
  user_name: string | null
  created_at: string
}

export interface FoodRatingSummary {
  average: number
  count: number
  breakdown: Record<string, number>
}

/** Shape returned by GET /tourist/food/{offering}. */
export interface FoodItemDetail {
  id: number
  name: string
  description: string | null
  price: number
  compare_price: number | null
  category: string
  image: string | null
  images: string[]
  is_available: boolean
  is_featured: boolean
  has_variations: boolean
  variations: FoodDetailVariation[]
  preparation_time: number | null
  unit?: string | null
  business_id: number
  business_name: string
  business_logo: string | null
  business_address: string | null
  business_latitude: number | null
  business_longitude: number | null
  business_review_count: number
  business_reviews: FoodDetailReview[]
  business_category?: string | null
  business_municipality?: string | null
  business_contact_number?: string | null
  business_opening_time?: string | null
  business_closing_time?: string | null
  business_rating_summary?: FoodRatingSummary | null
  rating: number | null
  is_open: boolean
  is_accepting_orders: boolean
  availability: string
  open_status: { status: string; label: string } | null
  schedule_summary: string | null
}

interface CartRow {
  id: number
  name: string
  price: number
  image: string | null
  business_name: string
  business_id: number
  business_latitude?: number | null
  business_longitude?: number | null
  quantity: number
  variation?: string
}

const CART_KEY = 'food_cart'

function readCart(): CartRow[] {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]')
  } catch {
    return []
  }
}

function writeCart(cart: CartRow[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart))
  window.dispatchEvent(new Event('cart-updated'))
}

/**
 * Merge on (offering id + display name). The display name embeds the chosen
 * variation ("Adobo (Large)"), so a variation row never collides with the plain
 * row and rows written by other pages (which also embed the variation in the
 * name) merge into the same line instead of duplicating it.
 */
function addItemToCart(item: FoodItemDetail, quantity: number, variation: FoodDetailVariation | null): void {
  const cart = readCart()
  const name = variation ? `${item.name} (${variation.name})` : item.name
  const price = variation ? Number(variation.price) : Number(item.price)
  const isSameLine = (row: CartRow) => row.id === item.id && row.name === name

  const updated = cart.some(isSameLine)
    ? cart.map((row) => (isSameLine(row) ? { ...row, quantity: row.quantity + quantity } : row))
    : [
        ...cart,
        {
          id: item.id,
          name,
          price,
          image: item.image,
          business_name: item.business_name,
          business_id: item.business_id,
          business_latitude: item.business_latitude,
          business_longitude: item.business_longitude,
          quantity,
          ...(variation ? { variation: variation.name } : {}),
        },
      ]

  writeCart(updated)
}

/** "13:30:00" → "1:30 PM"; null when missing. */
function formatClock(value: string | null | undefined): string | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(value)
  if (!m) return null
  const h = Number(m[1])
  return `${((h + 11) % 12) + 1}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`
}

function formatReviewDate(value: string): string | null {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Stars({ value, className }: { value: number; className?: string }) {
  const rounded = Math.round(value)
  return (
    <span className={cn('flex items-center gap-0.5', className)} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn('w-full h-full', i <= rounded ? 'fill-[#F4B400] text-[#F4B400]' : 'text-[#D7DDD9]')} />
      ))}
    </span>
  )
}

function BackToMenuButton() {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate('/tourist/food')}
      className="inline-flex items-center gap-2 text-sm font-semibold text-[#087F3F] hover:text-[#056B35]"
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      Back to food menu
    </button>
  )
}

/**
 * Individual food menu item details.
 *
 * Every section is driven by real menu/restaurant data from
 * GET /tourist/food/{offering}: optional sections (description, gallery,
 * variations, reviews, rating, hours, contact) are hidden when the data is
 * absent so nothing is ever invented. Reviews and ratings are restaurant-level
 * (reviews carry no offering id) and are labelled as such.
 */
export default function TouristFoodItemDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  // "Back" returns to wherever the tourist came from (food list, restaurant,
  // My Orders, search…). Opened directly (no in-app history): the restaurant.
  const location = useLocation()
  const hasHistory = location.key !== 'default'
  const addedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [variationId, setVariationId] = useState<number | null>(null)
  const [added, setAdded] = useState(false)
  const itemId = Number(id)

  const { data: item, isLoading, isError, error } = useQuery<FoodItemDetail>({
    queryKey: ['tourist-food-detail', itemId],
    queryFn: () => get<FoodItemDetail>(`/tourist/food/${itemId}`),
    staleTime: 60_000,
    retry: false,
    enabled: Number.isInteger(itemId) && itemId > 0,
  })
  // The dish no longer exists (404): stop listing it in Recently Viewed.
  const dishGone = isNotFoundError(error)
  useEffect(() => {
    if (dishGone) forgetBrowsedPlace(itemId, 'food')
  }, [dishGone, itemId])

  // My Activities → Explored: remember dishes the tourist looked at.
  useEffect(() => {
    if (!item) return
    recordBrowsedPlace({
      id: item.id,
      name: item.name,
      category: item.category || 'Food',
      discoveryGroup: 'dining',
      kind: 'food',
      cover_photo: item.image ?? null,
      logo: null,
      municipality: item.business_name,
      rating: null,
      url: `/tourist/food/item/${item.id}`,
    })
  }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (addedTimer.current) clearTimeout(addedTimer.current)
    }
  }, [])

  const availableVariations = item?.variations?.filter((variation) => variation.is_available) ?? []
  // Falls back to the first available variation until the tourist picks one.
  const selectedVariation =
    availableVariations.find((variation) => variation.id === variationId) ?? availableVariations[0] ?? null

  const gallery = item
    ? (item.images?.length ? item.images : [item.image]).filter((image): image is string => Boolean(image))
    : []

  const unitPrice = selectedVariation ? Number(selectedVariation.price) : Number(item?.price ?? 0)
  const total = unitPrice * quantity
  const accepting = Boolean(item?.is_accepting_orders)
  const orderable = accepting && Boolean(item?.is_available)
  const closedLabel = item?.open_status?.label ?? 'Closed'

  const summary = item?.business_rating_summary && item.business_rating_summary.count > 0 ? item.business_rating_summary : null
  const ratingValue = summary
    ? Number(summary.average)
    : item?.rating != null && Number(item.rating) > 0 ? Number(item.rating) : null
  const reviewCount = summary?.count ?? item?.business_review_count ?? 0
  const hasReviews = (item?.business_reviews?.length ?? 0) > 0

  const opening = formatClock(item?.business_opening_time)
  const closing = formatClock(item?.business_closing_time)
  const hoursLabel = opening && closing
    ? `${opening} – ${closing}`
    : item?.schedule_summary && item.schedule_summary !== 'Hours not set' ? item.schedule_summary : null
  const restaurantSubtitle = [item?.business_category, item?.business_municipality].filter(Boolean).join(' • ')

  const handleAddToCart = () => {
    if (!item || !orderable) return
    addItemToCart(item, quantity, selectedVariation)
    setAdded(true)
    if (addedTimer.current) clearTimeout(addedTimer.current)
    addedTimer.current = setTimeout(() => setAdded(false), 2000)
  }

  const handleBuyNow = () => {
    if (!item || !orderable) return
    addItemToCart(item, quantity, selectedVariation)
    navigate('/tourist/food/cart')
  }

  if (isLoading) {
    return (
      <main className="max-w-[1500px] mx-auto" aria-label="Food item details">
        <div className="mb-5"><BackToMenuButton /></div>
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] animate-pulse">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="aspect-[4/3] rounded-3xl bg-[#E5E9E7]" />
            <div className="space-y-4">
              <div className="h-6 w-1/3 rounded-full bg-[#E5E9E7]" />
              <div className="h-9 w-3/4 rounded-xl bg-[#E5E9E7]" />
              <div className="h-10 w-1/3 rounded-xl bg-[#E5E9E7]" />
              <div className="h-24 rounded-xl bg-[#E5E9E7]" />
            </div>
          </div>
          <div className="h-80 rounded-2xl bg-[#E5E9E7]" />
        </div>
      </main>
    )
  }

  if (isError || !item) {
    return (
      <main className="max-w-3xl mx-auto" aria-label="Food item details">
        <div className="mb-5"><BackToMenuButton /></div>
        <section className="bg-white border border-[#E5E9E7] rounded-2xl p-6 sm:p-10 text-center" aria-labelledby="food-detail-error-title">
          <UtensilsCrossed className="w-10 h-10 text-[#C2DEC9] mx-auto mb-3" aria-hidden="true" />
          <h2 id="food-detail-error-title" className="text-lg font-bold text-[#17201B]">
            Menu item unavailable
          </h2>
          <p className="text-sm text-[#56615B] mt-1.5">
            This item may have been removed or is no longer offered.
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="max-w-[1500px] mx-auto pb-24 lg:pb-6" aria-label="Food item details">
      <div className="mb-5">
        <button
          type="button"
          onClick={() => (hasHistory ? navigate(-1) : navigate(`/tourist/food/${item.business_id}`))}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#087F3F] hover:text-[#056B35]"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        {/* ───────── Dish: photos + summary ───────── */}
        <div className="min-w-0 xl:col-start-1 xl:row-start-1 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] items-start">
          {/* Gallery: swipeable carousel of every photo of this dish */}
          <FoodImageCarousel images={gallery} name={item.name} popular={item.is_featured} />

          {/* Summary */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {item.category && (
                <span className="text-xs font-bold uppercase tracking-wide text-[#047332]">{item.category}</span>
              )}
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 text-xs font-semibold',
                  orderable ? 'text-[#047332]' : 'text-[#B91C1C]',
                )}
              >
                <span className={cn('w-2 h-2 rounded-full', orderable ? 'bg-[#087F3F]' : 'bg-[#B91C1C]')} aria-hidden="true" />
                {orderable ? item.open_status?.label ?? 'Open' : closedLabel}
              </span>
              {!item.is_available && (
                <span className="inline-flex items-center h-6 px-2 rounded-full text-[11px] font-bold bg-[#F3F4F6] text-[#56615B]">Unavailable</span>
              )}
            </div>

            <h1 id="food-detail-title" className="mt-2 text-[clamp(1.6rem,3vw,2.25rem)] font-extrabold leading-tight text-[#17201B]">
              {item.name}
            </h1>

            {(ratingValue !== null || (item.preparation_time != null && item.preparation_time > 0)) && (
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#56615B]">
                {ratingValue !== null && (
                  <span className="inline-flex items-center gap-1.5">
                    <Star className="w-4 h-4 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" />
                    <span className="font-bold text-[#17201B]">{ratingValue.toFixed(1)}</span>
                    {reviewCount > 0 && <span>{`${reviewCount} review${reviewCount === 1 ? '' : 's'}`}</span>}
                    <span className="text-xs">· restaurant rating</span>
                  </span>
                )}
                {item.preparation_time != null && item.preparation_time > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-[#087F3F]" aria-hidden="true" />
                    Approximately {item.preparation_time} min preparation
                  </span>
                )}
              </div>
            )}

            <div className="mt-4 flex items-baseline gap-2">
              <span className="text-[clamp(1.6rem,3vw,2.25rem)] font-extrabold leading-none text-[#087F3F]">{formatCurrency(unitPrice)}</span>
              {item.compare_price != null && Number(item.compare_price) > Number(item.price) && (
                <span className="text-base text-[#56615B] line-through">{formatCurrency(Number(item.compare_price))}</span>
              )}
              {item.unit && <span className="text-sm text-[#56615B]">per {item.unit}</span>}
            </div>

            {item.description && (
              <p className="mt-4 text-[15px] leading-relaxed text-[#3B4540]">{item.description}</p>
            )}

            <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#F3F8F4] px-3 py-2.5 text-[13px] text-[#3B4540]">
              <Info className="w-4 h-4 text-[#087F3F] mt-0.5 shrink-0" aria-hidden="true" />
              <span>Prepared by {item.business_name}. The restaurant starts cooking once a rider accepts your order, so it reaches you fresh.</span>
            </p>
          </div>
        </div>

        {/* ───────── Order card ───────── */}
        <aside className="min-w-0 xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:sticky xl:top-[calc(var(--tourist-header-h)+16px)]" aria-labelledby="add-to-cart-title">
          <div className="rounded-2xl border border-[#E5E9E7] bg-white p-5 sm:p-6 shadow-[0_8px_24px_rgba(23,32,27,0.06)] space-y-5">
            <h2 id="add-to-cart-title" className="text-lg font-extrabold text-[#17201B]">Your order</h2>

            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#17201B] mb-1.5">Quantity</p>
                <div className="inline-flex items-center rounded-xl border border-[#D3E2D6]" role="group" aria-label="Quantity selector">
                  <button
                    type="button"
                    onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                    disabled={quantity <= 1}
                    aria-label="Decrease quantity"
                    className="food-qty-btn w-10 h-10 flex items-center justify-center text-[#17201B] hover:bg-[#F3F8F4] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Minus className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <span className="w-10 text-center text-base font-bold text-[#17201B]" aria-live="polite">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity((current) => current + 1)}
                    aria-label="Increase quantity"
                    className="food-qty-btn w-10 h-10 flex items-center justify-center text-[#087F3F] hover:bg-[#F3F8F4]"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
                {item.unit && <span className="ml-2 text-xs text-[#56615B]">{item.unit}</span>}
              </div>
              <div className="text-right">
                <p className="text-xs text-[#56615B]">Each</p>
                <p className="text-xl font-extrabold text-[#087F3F]">{formatCurrency(unitPrice)}</p>
              </div>
            </div>

            {availableVariations.length > 0 && (
              <div role="radiogroup" aria-label="Choose a variation">
                <p className="text-sm font-semibold text-[#17201B] mb-2">Choose a variation</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {availableVariations.map((variation) => {
                    const isSelected = selectedVariation?.id === variation.id
                    return (
                      <button
                        key={variation.id}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setVariationId(variation.id)}
                        className={cn(
                          'food-variant relative text-left p-3 rounded-xl border-2 transition',
                          isSelected ? 'border-[#087F3F] bg-[#E9F7EF]' : 'border-[#E5E9E7] bg-white hover:border-[#087F3F]/40',
                        )}
                      >
                        {isSelected && (
                          <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[#087F3F] text-white flex items-center justify-center" aria-hidden="true">
                            <Check className="w-3.5 h-3.5" />
                          </span>
                        )}
                        <span className="block text-sm font-bold text-[#17201B] pr-6">{variation.name}</span>
                        <span className="block text-xs font-semibold text-[#047332] mt-0.5">{formatCurrency(Number(variation.price))}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {!orderable && (
              <p className="text-xs font-semibold text-[#B91C1C] text-center" role="status">
                {item.is_available ? `${closedLabel} — unavailable for order` : 'This item is currently unavailable'}
              </p>
            )}

            <div className="flex items-center justify-between border-t border-[#E5E9E7] pt-4">
              <span className="text-sm font-medium text-[#56615B]">Total</span>
              <span className="text-xl font-extrabold text-[#17201B]">{formatCurrency(total)}</span>
            </div>

            {/*
              Order actions — one set of controls.
              Below lg (bottom navigation visible) the bar is pinned just above
              it: left half = Restaurant | Chat | Add to Cart icon buttons,
              right half = Buy Now. From lg it sits in the order card as
              [Add to Cart][Buy Now]; Restaurant/Chat live elsewhere there.
            */}
            <div
              className="food-order-actions fixed inset-x-0 bottom-[var(--tourist-bottom-nav-space)] z-[1900] bg-white border-t border-[#E5E9E7] px-2 py-2 shadow-[0_-6px_18px_rgba(23,32,27,0.08)] lg:static lg:inset-auto lg:z-auto lg:bg-transparent lg:border-0 lg:p-0 lg:shadow-none"
              role="group"
              aria-label="Order actions"
            >
              <div className="max-w-3xl mx-auto grid grid-cols-2 gap-2 lg:max-w-none lg:gap-3">
                {/* Left half: three icon buttons (Add to Cart only on lg) */}
                <div className="food-order-icons grid grid-cols-3 lg:grid-cols-1">
                  <Link
                    to={`/tourist/food/${item.business_id}`}
                    aria-label={`Restaurant: ${item.business_name}`}
                    className="food-icon-action lg:hidden flex flex-col items-center justify-center gap-1 h-12 rounded-xl text-[#17201B] hover:bg-[#F3F8F4]"
                  >
                    <Store className="w-5 h-5 text-[#087F3F]" aria-hidden="true" />
                    <span className="text-[10px] font-semibold leading-none">Restaurant</span>
                  </Link>
                  {item.business_contact_number ? (
                    <a
                      href={`sms:${item.business_contact_number.replace(/\s+/g, '')}`}
                      aria-label={`Chat with ${item.business_name}`}
                      className="food-icon-action lg:hidden flex flex-col items-center justify-center gap-1 h-12 rounded-xl text-[#17201B] hover:bg-[#F3F8F4]"
                    >
                      <MessageCircle className="w-5 h-5 text-[#087F3F]" aria-hidden="true" />
                      <span className="text-[10px] font-semibold leading-none">Chat</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      aria-label="Chat unavailable: this restaurant has no contact number"
                      title="This restaurant has not added a contact number yet"
                      className="food-icon-action lg:hidden flex flex-col items-center justify-center gap-1 h-12 rounded-xl text-[#9AA39E] cursor-not-allowed"
                    >
                      <MessageCircle className="w-5 h-5" aria-hidden="true" />
                      <span className="text-[10px] font-semibold leading-none">Chat</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleAddToCart}
                    disabled={!orderable}
                    className={cn(
                      'food-icon-action min-w-0 flex flex-col lg:flex-row items-center justify-center gap-1 lg:gap-1.5 h-12 rounded-xl font-semibold lg:font-bold whitespace-nowrap transition',
                      'text-[#17201B] hover:bg-[#F3F8F4] disabled:text-[#9AA39E] disabled:cursor-not-allowed',
                      'lg:bg-[#087F3F] lg:text-white lg:hover:bg-[#056B35] lg:disabled:bg-[#E5E9E7] lg:disabled:text-[#68736D]',
                    )}
                  >
                    {added ? (
                      <><Check className="w-5 h-5 shrink-0 text-[#087F3F] lg:text-white" aria-hidden="true" /><span className="text-[10px] lg:text-sm leading-none">Added</span></>
                    ) : (
                      <><ShoppingCart className="w-5 h-5 shrink-0 text-[#087F3F] lg:text-current" aria-hidden="true" /><span className="text-[10px] lg:text-sm leading-none">Add to Cart</span></>
                    )}
                  </button>
                </div>

                {/* Right half: Buy Now. NB: "lg:bg-[#fff]", not "lg:bg-white": the
                    shared card rule in index.css matches class SUBSTRINGS
                    (bg-white + rounded-xl + border) and painted this button
                    near-white on every screen, hiding its white text. */}
                <button
                  type="button"
                  onClick={handleBuyNow}
                  disabled={!orderable}
                  className="min-w-0 h-12 px-2 flex items-center justify-center gap-1.5 rounded-xl bg-[#087F3F] lg:bg-[#fff] lg:border-2 lg:border-[#087F3F] text-white lg:text-[#087F3F] text-base lg:text-sm font-bold whitespace-nowrap hover:bg-[#056B35] lg:hover:bg-[#E9F7EF] transition disabled:bg-[#E5E9E7] disabled:text-[#68736D] lg:disabled:border-[#E5E9E7] disabled:cursor-not-allowed"
                >
                  <Zap className="w-5 h-5 shrink-0" aria-hidden="true" /> Buy Now
                </button>
              </div>
            </div>
            <p className="sr-only" aria-live="polite">
              {added ? 'Added to cart' : ''}
            </p>
          </div>
        </aside>

        {/* ───────── Reviews + restaurant ───────── */}
        <div className="min-w-0 xl:col-start-1 xl:row-start-2 space-y-8">
          {/* Restaurant reviews (reviews are business-level only) */}
          {hasReviews && (
            <section id="food-reviews" className="scroll-mt-28">
              <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                <h2 className="text-2xl font-extrabold text-[#17201B]">Restaurant reviews</h2>
                <Link to={`/tourist/food/${item.business_id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-[#087F3F] hover:underline">
                  See all on the restaurant page <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </div>
              <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
                {summary && (
                  <div className="rounded-2xl border border-[#E5E9E7] bg-white p-5">
                    <div className="flex items-center gap-3">
                      <span className="text-5xl font-extrabold text-[#17201B]">{Number(summary.average).toFixed(1)}</span>
                      <div>
                        <Stars value={Number(summary.average)} className="w-[110px] h-5" />
                        <p className="mt-1 text-xs text-[#56615B]">{`(${summary.count} rating${summary.count === 1 ? '' : 's'})`}</p>
                      </div>
                    </div>
                    <ul className="mt-4 space-y-1.5" aria-label="Rating breakdown">
                      {[5, 4, 3, 2, 1].map((star) => {
                        const count = summary.breakdown[String(star)] ?? 0
                        const pct = summary.count > 0 ? Math.round((count / summary.count) * 100) : 0
                        return (
                          <li key={star} className="flex items-center gap-2 text-xs">
                            <span className="w-7 flex items-center gap-0.5 font-semibold text-[#17201B]">{star}<Star className="w-3 h-3 fill-[#3B4540] text-[#3B4540]" aria-hidden="true" /></span>
                            <span className="flex-1 h-2 rounded-full bg-[#E5E9E7] overflow-hidden">
                              <span className={cn('block h-full rounded-full', star >= 4 ? 'bg-[#087F3F]' : 'bg-[#F4B400]')} style={{ width: `${pct}%` }} />
                            </span>
                            <span className="w-9 text-right text-[#56615B]">{pct}%</span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                )}
                <ul className="food-review-grid">
                  {item.business_reviews.map((review) => {
                    const date = formatReviewDate(review.created_at)
                    const name = review.user_name || 'Guest'
                    return (
                      <li key={review.id} className="rounded-2xl border border-[#E5E9E7] bg-white p-4">
                        <div className="flex items-center gap-3">
                          <span className="w-10 h-10 rounded-full bg-[#E9F7EF] text-[#047332] font-bold flex items-center justify-center shrink-0" aria-hidden="true">
                            {name.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-[#17201B] truncate">{name}</p>
                            {date && <p className="text-xs text-[#56615B]">{date}</p>}
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Stars value={Number(review.rating)} className="w-[84px] h-4" />
                          <span className="sr-only">{review.rating} out of 5</span>
                        </div>
                        {review.review && <p className="mt-2 text-sm leading-relaxed text-[#3B4540]">{review.review}</p>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            </section>
          )}

          {/* Restaurant strip */}
          <section id="food-restaurant" className="scroll-mt-28 rounded-2xl border border-[#D3E6D8] bg-[#F3F8F4] p-5" aria-label="Restaurant">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-5">
              <div className="flex items-center gap-3 min-w-[220px] flex-1">
                {item.business_logo ? (
                  <img src={toAssetUrl(item.business_logo)} alt="" className="w-14 h-14 rounded-xl object-cover border border-[#E5E9E7] shrink-0" />
                ) : (
                  <span className="w-14 h-14 rounded-xl bg-[#087F3F] flex items-center justify-center shrink-0">
                    <UtensilsCrossed className="w-6 h-6 text-white" aria-hidden="true" />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="font-bold text-[#17201B]">{item.business_name}</p>
                  {restaurantSubtitle && <p className="text-xs text-[#56615B]">{restaurantSubtitle}</p>}
                </div>
              </div>
              {hoursLabel && (
                <div className="flex items-start gap-2.5 min-w-[160px]">
                  <Clock className="w-5 h-5 text-[#17201B] mt-0.5 shrink-0" aria-hidden="true" />
                  <div><p className="text-xs font-bold text-[#17201B]">Operating Hours</p><p className="text-sm text-[#3B4540]">{hoursLabel}</p></div>
                </div>
              )}
              {item.business_contact_number && (
                <div className="flex items-start gap-2.5 min-w-[150px]">
                  <Phone className="w-5 h-5 text-[#17201B] mt-0.5 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-xs font-bold text-[#17201B]">Contact</p>
                    <a href={`tel:${item.business_contact_number}`} className="text-sm text-[#3B4540] hover:underline">{item.business_contact_number}</a>
                  </div>
                </div>
              )}
              {item.business_address && (
                <div className="flex items-start gap-2.5 min-w-[160px]">
                  <MapPin className="w-5 h-5 text-[#17201B] mt-0.5 shrink-0" aria-hidden="true" />
                  <div><p className="text-xs font-bold text-[#17201B]">Location</p><p className="text-sm text-[#3B4540]">{item.business_address}</p></div>
                </div>
              )}
              <Link
                to={`/tourist/food/${item.business_id}`}
                className="inline-flex items-center gap-1.5 h-11 px-5 rounded-full border-2 border-[#087F3F] bg-white text-sm font-bold text-[#087F3F] hover:bg-[#087F3F] hover:text-white transition"
              >
                View restaurant
                <ChevronRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
