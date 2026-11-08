import { useEffect, useState } from 'react'
import { categoryName, formatCurrency, toAssetUrl } from '@/shared/utils'
import { addToFoodCart, getFoodCart, saveFoodCart } from '@/shared/services/food-cart'
import { UtensilsCrossed, Star, ShoppingCart, Plus, Minus } from 'lucide-react'

/** A dish as returned by GET /tourist/food. */
export interface FoodItem {
  id: number
  name: string
  description: string | null
  category: unknown
  image: string | null
  price: number
  business_name: string
  business_id: number
  business_latitude: number | null
  business_longitude: number | null
  rating: number | null
  is_open: boolean
  is_accepting_orders: boolean
  availability: string
  open_status: { status: string; label: string } | null
  /** Units sold in delivered/completed orders. */
  sold_count?: number
  /** Average food stars from approved reviews of orders with this dish (null = none yet). */
  food_rating?: number | null
  food_rating_count?: number
}

function cartQuantity(foodId: number): number {
  return getFoodCart().find((c) => c.id === foodId)?.quantity ?? 0
}

function addFood(food: FoodItem) {
  addToFoodCart({
    id: food.id,
    name: food.name,
    price: Number(food.price),
    image: food.image,
    business_name: food.business_name,
    business_id: food.business_id,
    business_latitude: food.business_latitude,
    business_longitude: food.business_longitude,
  })
}

function removeOne(foodId: number) {
  const cart = getFoodCart()
  const line = cart.find((c) => c.id === foodId)
  if (!line) return
  line.quantity -= 1
  saveFoodCart(line.quantity > 0 ? cart : cart.filter((c) => c !== line))
}

/**
 * Menu item card (photo, category, name, restaurant, price, Add to Cart / in-cart
 * stepper). Shared by the Food & Dining page and the My Orders empty state.
 */
export default function FoodMenuCard({ food, onOpen }: { food: FoodItem; onOpen: () => void }) {
  const [qty, setQty] = useState(() => cartQuantity(food.id))
  const imageUrl = food.image ? toAssetUrl(food.image) : ''
  const accepting = food.is_accepting_orders
  const closedLabel = food.open_status?.label ?? 'Closed'
  const rating = food.rating != null && Number(food.rating) > 0 ? Number(food.rating) : null

  useEffect(() => {
    const sync = () => setQty(cartQuantity(food.id))
    window.addEventListener('cart-updated', sync)
    return () => window.removeEventListener('cart-updated', sync)
  }, [food.id])

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View details for ${food.name}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        // Only activate for keys pressed on the card itself, never for keys
        // bubbling up from the card's own Add/quantity buttons.
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className="food-list-card group flex flex-col bg-white rounded-2xl border border-[#E5E9E7] overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#087F3F] focus-visible:ring-offset-2"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[#E9F7EF]">
        {imageUrl ? (
          <img src={imageUrl} alt={food.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <UtensilsCrossed className="w-10 h-10 text-[#087F3F]/30" aria-hidden="true" />
          </div>
        )}
        {rating !== null && (
          <span
            className="absolute top-2 right-2 inline-flex items-center gap-1 h-6 px-2 rounded-full bg-black/60 text-white text-[11px] font-bold"
            aria-label={`Restaurant rating ${rating.toFixed(1)} out of 5`}
          >
            <Star className="w-3 h-3 text-[#F4B400] fill-[#F4B400]" aria-hidden="true" />
            <span>{rating.toFixed(1)}</span>
          </span>
        )}
        {!accepting && (
          <span className="absolute inset-x-0 bottom-0 bg-black/60 text-white text-[11px] font-semibold text-center py-1">
            {closedLabel}
          </span>
        )}
      </div>

      <div className="p-3 flex-1 flex flex-col">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#047332] truncate">{categoryName(food.category)}</p>
        <h3 className="mt-0.5 text-[15px] font-bold text-[#17201B] leading-snug line-clamp-1">{food.name}</h3>
        <p className="text-xs text-[#56615B] truncate">{food.business_name}</p>
        <p className="mt-1.5 text-base font-extrabold text-[#087F3F]">{formatCurrency(Number(food.price))}</p>

        <div className="mt-auto pt-2.5" onClick={stop} onKeyDown={stop}>
          {!accepting ? (
            <p className="h-9 flex items-center justify-center rounded-xl bg-[#F3F4F6] text-xs font-semibold text-[#56615B]">Unavailable for order</p>
          ) : qty === 0 ? (
            <button
              type="button"
              onClick={() => addFood(food)}
              className="w-full h-9 flex items-center justify-center gap-1.5 bg-[#087F3F] text-white text-xs sm:text-sm font-semibold rounded-xl hover:bg-[#056B35] transition-colors"
            >
              <ShoppingCart className="w-4 h-4 shrink-0" aria-hidden="true" />
              Add to Cart
            </button>
          ) : (
            <div className="h-9 flex items-center justify-between rounded-xl bg-[#E9F7EF]" role="group" aria-label={`${food.name} quantity in cart`}>
              <button
                type="button"
                onClick={() => removeOne(food.id)}
                aria-label={`Remove one ${food.name}`}
                className="food-qty w-9 h-9 flex items-center justify-center text-[#087F3F] hover:bg-[#087F3F] hover:text-white rounded-xl transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <span className="text-sm font-bold text-[#17201B]" aria-live="polite">{qty} in cart</span>
              <button
                type="button"
                onClick={() => addFood(food)}
                aria-label={`Add one more ${food.name}`}
                className="food-qty w-9 h-9 flex items-center justify-center text-[#087F3F] hover:bg-[#087F3F] hover:text-white rounded-xl transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
