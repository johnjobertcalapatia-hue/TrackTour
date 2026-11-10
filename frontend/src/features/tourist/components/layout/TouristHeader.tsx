import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { Bell, Heart, ShoppingCart } from 'lucide-react'

/**
 * Tourist top bar: logo (mobile only; desktop shows it in the sidebar) and the
 * round Cart / Saved / Notifications actions on the right. There is no search
 * bar here; tourists search from the Home hero (→ /tourist/search).
 */
export default function TouristHeader() {
  const navigate = useNavigate()
  const [cartCount, setCartCount] = useState(() => {
    try { return (JSON.parse(localStorage.getItem('food_cart') || '[]') as { quantity: number }[]).reduce((sum, i) => sum + (i.quantity || 1), 0) } catch { return 0 }
  })

  useEffect(() => {
    const update = () => {
      try { setCartCount((JSON.parse(localStorage.getItem('food_cart') || '[]') as { quantity: number }[]).reduce((sum, i) => sum + (i.quantity || 1), 0)) } catch { setCartCount(0) }
    }
    window.addEventListener('cart-updated', update)
    return () => window.removeEventListener('cart-updated', update)
  }, [])

  // Phones / tablets: solid header (no backdrop blur), which can make mobile
  // Chrome drop the fixed bottom navigation bar from the screen.
  return (
    <header className="tourist-topbar sticky top-0 z-[2000] bg-[#F4F8F3] lg:bg-[#F4F8F3]/85 lg:backdrop-blur-xl">
      <div className="flex items-center gap-2 sm:gap-4 px-4 sm:px-6 h-16 sm:h-[84px]">
        {/* Logo (mobile only; desktop shows it in the sidebar) */}
        <Link to="/tourist/dashboard" className="lg:hidden flex items-center shrink-0" aria-label="TrackTour home">
          <img src="/assets/logo/tracktour.png" alt="TrackTour logo" className="w-9 h-9 sm:w-10 sm:h-10 object-contain" />
        </Link>

        {/* Cart + saved + notifications, on the right */}
        <div className="ml-auto flex items-center gap-1.5 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => navigate("/tourist/food/cart")}
            className="tourist-round-action relative w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white border border-[#E5E9E7] text-[#17201B] flex items-center justify-center hover:text-[#087F3F] transition"
            aria-label={cartCount > 0 ? `Cart, ${cartCount} item${cartCount === 1 ? "" : "s"}` : "Cart"}
            title="Cart"
          >
            <ShoppingCart className="w-[22px] h-[22px]" />
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-[#DC2626] text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white">
                {cartCount > 99 ? "99+" : cartCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate("/tourist/favorites")}
            className="tourist-round-action max-[400px]:hidden relative w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white border border-[#E5E9E7] text-[#17201B] flex items-center justify-center hover:text-[#087F3F] transition"
            aria-label="Saved"
            title="Saved"
          >
            <Heart className="w-[22px] h-[22px]" />
          </button>
          <button
            type="button"
            onClick={() => navigate("/tourist/notifications")}
            className="tourist-round-action relative w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white border border-[#E5E9E7] text-[#17201B] flex items-center justify-center hover:text-[#087F3F] transition"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="w-[22px] h-[22px]" />
            <NotificationBadge />
          </button>
        </div>
      </div>
    </header>
  )
}

function NotificationBadge() {
  const user = useAuthStore((s) => s.user)
  const { data } = useQuery({
    queryKey: ['tourist-unread-notif-count'],
    queryFn: () => get<{ unread_count: number }>('/tourist/notifications/unread-count'),
    enabled: !!user,
    staleTime: 120_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const unread = data?.unread_count ?? 0
  if (unread === 0) return null
  return (
    <span className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full bg-[#DC2626] text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-white" aria-label={`${unread} unread`}>
      {unread > 99 ? '99+' : unread}
    </span>
  )
}
