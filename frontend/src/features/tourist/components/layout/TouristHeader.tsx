import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { Bell, Heart, ShoppingCart } from 'lucide-react'

/**
 * Tourist top bar: logo (mobile only; desktop shows it in the sidebar), a
 * greeting, and the Cart / Saved / Notifications actions on the right. There is no search
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

  const user = useAuthStore((s) => s.user)
  const firstName = user?.name?.trim().split(/\s+/)[0]
  const action = 'tourist-header-action relative flex h-11 w-11 items-center justify-center rounded-full text-[#0F4D2B] transition hover:bg-[#EAE6DA]'

  // Same look as the business owner header: warm canvas, greeting on the
  // left, plain round actions on the right. Phones / tablets: solid header
  // (no backdrop blur), which can make mobile Chrome drop the fixed bottom bar.
  return (
    <header className="tourist-topbar sticky top-0 z-[2000] bg-[#F6F4EE] lg:bg-[#F6F4EE]/90 lg:backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:h-[76px] sm:px-6">
        {/* Logo (phones / tablets; desktop shows it in the sidebar) */}
        <Link to="/tourist/dashboard" className="flex shrink-0 items-center lg:hidden" aria-label="TrackTour home">
          <img src="/assets/logo/tracktour.png" alt="TrackTour logo" className="h-9 w-9 rounded-xl bg-[#fff] object-contain p-0.5 sm:h-10 sm:w-10" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-[#17201B] sm:text-lg">{firstName ? `Hi, ${firstName}!` : 'Welcome to TrackTour'}</p>
          <p className="hidden truncate text-xs text-[#5E6B63] sm:block">Explore, order and travel around Oriental Mindoro</p>
        </div>

        {/* Cart, saved and notifications */}
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => navigate('/tourist/food/cart')}
            className={action}
            aria-label={cartCount > 0 ? `Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}` : 'Cart'}
            title="Cart"
          >
            <ShoppingCart className="h-6 w-6" aria-hidden="true" />
            {cartCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#DC2626] px-1 text-[10px] font-bold text-white">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate('/tourist/favorites')}
            className={`${action} max-[400px]:hidden`}
            aria-label="Saved"
            title="Saved"
          >
            <Heart className="h-6 w-6" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => navigate('/tourist/notifications')}
            className={action}
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="h-6 w-6" aria-hidden="true" />
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
    <span className="absolute right-0.5 top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#DC2626] px-1 text-[10px] font-bold text-white" aria-label={`${unread} unread`}>
      {unread > 99 ? '99+' : unread}
    </span>
  )
}
