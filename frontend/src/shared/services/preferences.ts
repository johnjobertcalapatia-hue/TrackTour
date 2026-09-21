import { post } from '@/shared/services/api'

const LANDING_CART_KEY = 'tracktour_landing_cart'
const LANDING_FAVORITES_KEY = 'tracktour_landing_favorites'
const TOURIST_CART_KEY = 'food_cart'

export interface GuestCartItem {
  id: number
  name: string
  price: number
  image?: string | null
  business_name?: string
  business_id: number
  quantity: number
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function removeKeys(keys: string[]) {
  for (const key of keys) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
}

/**
 * After a guest logs in as a tourist, carry over their locally-saved
 * preferences (cart + favorites) into the tourist web app.
 */
export async function applyGuestPreferences(): Promise<void> {
  await syncGuestCart()
  await syncGuestFavorites()
}

async function syncGuestCart(): Promise<void> {
  const guestCart = readJSON<GuestCartItem[]>(LANDING_CART_KEY, [])
  if (!Array.isArray(guestCart) || guestCart.length === 0) return

  try {
    const touristCart = readJSON<GuestCartItem[]>(TOURIST_CART_KEY, [])
    const merged = [...touristCart]

    for (const item of guestCart) {
      const existing = merged.find((c) => c.id === item.id)
      if (existing) {
        existing.quantity += item.quantity
      } else {
        merged.push({
          id: item.id,
          name: item.name ?? '',
          price: Number(item.price ?? 0),
          image: item.image ?? null,
          business_name: item.business_name ?? '',
          business_id: item.business_id ?? null,
          quantity: item.quantity ?? 1,
        })
      }
    }

    localStorage.setItem(TOURIST_CART_KEY, JSON.stringify(merged))
    window.dispatchEvent(new Event('cart-updated'))
  } catch {
    /* ignore storage errors */
  }

  removeKeys([LANDING_CART_KEY])
}

async function syncGuestFavorites(): Promise<void> {
  const favorites = readJSON<number[]>(LANDING_FAVORITES_KEY, [])
  if (!Array.isArray(favorites) || favorites.length === 0) return

  for (const businessId of favorites) {
    try {
      await post('/tourist/favorites/toggle', { business_id: businessId })
    } catch {
      /* skip un-favoriteable businesses; don't block login */
    }
  }

  removeKeys([LANDING_FAVORITES_KEY])
}