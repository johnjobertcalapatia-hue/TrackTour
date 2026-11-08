/**
 * Tourist food cart (localStorage `food_cart`).
 *
 * Same storage format the existing pages (TouristFood, TouristFoodShow,
 * TouristFoodCart, ...) read and write, so items added here appear in the cart
 * and the header badge immediately. One cart may hold items from several
 * restaurants; checkout turns it into one group checkout (AGENTS.md §4.1).
 */
export interface FoodCartItem {
  id: number
  name: string
  price: number
  image: string | null
  business_name: string
  business_id: number
  business_latitude?: number | string | null
  business_longitude?: number | string | null
  quantity: number
}

const CART_KEY = 'food_cart'

export function getFoodCart(): FoodCartItem[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CART_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveFoodCart(cart: FoodCartItem[]): void {
  localStorage.setItem(CART_KEY, JSON.stringify(cart))
  window.dispatchEvent(new Event('cart-updated'))
}

/** Adds `quantity` of an item (merging with an existing line) and returns the new cart. */
export function addToFoodCart(item: Omit<FoodCartItem, 'quantity'>, quantity = 1): FoodCartItem[] {
  const cart = getFoodCart()
  const existing = cart.find((c) => c.id === item.id)
  if (existing) {
    existing.quantity += quantity
  } else {
    cart.push({ ...item, price: Number(item.price), quantity })
  }
  saveFoodCart(cart)
  return cart
}
