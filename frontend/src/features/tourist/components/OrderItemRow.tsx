import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, PenLine, RotateCcw, ShoppingCart, Star, UtensilsCrossed } from 'lucide-react'
import { addToFoodCart } from '@/shared/services/food-cart'
import { cn, formatCurrency, toAssetUrl } from '@/shared/utils'
import { lineToCartItem, type OrderLine } from '@/features/tourist/services/my-orders'

interface Props {
  item: OrderLine
  /** Where the photo / name / details lead (e.g. order details, or the food item page). */
  to?: string
  /** Show Buy again · Add to cart · Write review (delivered orders). */
  showActions?: boolean
  /** Write review page for this dish. */
  reviewTo?: string
}

/**
 * One ordered dish: photo, name, restaurant, note, quantity and price, and
 * (for delivered orders) Buy again / Add to cart / Write review.
 */
export default function OrderItemRow({ item, to, showActions = false, reviewTo }: Props) {
  const navigate = useNavigate()
  const [added, setAdded] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const cartItem = lineToCartItem(item)

  const info = (
    <>
      <div className="w-16 h-16 sm:w-20 sm:h-20 shrink-0 rounded-xl overflow-hidden bg-[#E9F7EF] flex items-center justify-center">
        {item.image ? (
          <img src={toAssetUrl(item.image)} alt="" className="w-full h-full object-cover" />
        ) : (
          <UtensilsCrossed className="w-7 h-7 text-[#087F3F]/40" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-[#17201B] truncate">{item.name}</p>
        {item.restaurant && <p className="text-xs text-[#56615B] truncate">{item.restaurant}</p>}
        {item.notes && <p className="text-xs text-[#56615B] truncate">Note: {item.notes}</p>}
        <p className="text-xs text-[#56615B] mt-0.5">x{item.quantity}</p>
      </div>
      <p className="text-sm font-bold text-[#17201B] shrink-0">{formatCurrency(item.line_total)}</p>
    </>
  )

  const addOne = () => {
    if (!cartItem) return
    addToFoodCart(cartItem, 1)
    setAdded(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAdded(false), 2000)
  }

  const buyAgain = () => {
    if (!cartItem) return
    addToFoodCart(cartItem, item.quantity)
    navigate('/tourist/food/cart')
  }

  const btn = 'inline-flex items-center justify-center gap-1.5 h-9 px-3.5 rounded-full text-[13px] font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <li className="px-4 sm:px-5 py-3">
      {to ? (
        <Link to={to} aria-label={`${item.name}, view details`} className="flex items-center gap-3 rounded-xl hover:bg-[#F7FAF8] -m-1 p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#087F3F]">
          {info}
        </Link>
      ) : (
        <div className="flex items-center gap-3">{info}</div>
      )}

      {showActions && (
        <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2" role="group" aria-label={`Actions for ${item.name}`}>
          {!cartItem && <span className="mr-auto text-xs text-[#56615B]">No longer on the menu</span>}
          <button type="button" onClick={buyAgain} disabled={!cartItem} className={cn(btn, 'bg-[#087F3F] text-white hover:bg-[#056B35]')}>
            <RotateCcw className="w-4 h-4" aria-hidden="true" /> Buy again
          </button>
          <button type="button" onClick={addOne} disabled={!cartItem} aria-live="polite" className={cn(btn, 'border border-[#087F3F] text-[#087F3F] hover:bg-[#E9F7EF]')}>
            {added ? <><Check className="w-4 h-4" aria-hidden="true" /> Added</> : <><ShoppingCart className="w-4 h-4" aria-hidden="true" /> Add to cart</>}
          </button>
          {reviewTo && (item.reviewed ? (
            <Link to={reviewTo} className={cn(btn, 'border border-[#E5E9E7] text-[#3B4540] hover:bg-[#F3F8F4]')}>
              <Star className="w-4 h-4 fill-[#F4B400] text-[#F4B400]" aria-hidden="true" /> {item.my_rating ?? ''} · Edit review
            </Link>
          ) : (
            <Link to={reviewTo} className={cn(btn, 'bg-[#F4B400] text-[#17201B] hover:bg-[#E0A500]')}>
              <PenLine className="w-4 h-4" aria-hidden="true" /> Write review
            </Link>
          ))}
        </div>
      )}
    </li>
  )
}
