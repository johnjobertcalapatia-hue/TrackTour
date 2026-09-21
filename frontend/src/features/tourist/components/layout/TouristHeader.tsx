import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { useClickOutside } from '@/shared/hooks/use-click-outside'
import { getInitials, toAssetUrl } from '@/shared/utils'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { Search, Bell, Heart, User, ChevronDown, LogOut, ShoppingCart, Store, UtensilsCrossed, MapPin, CornerDownLeft, CalendarRange, Landmark, Luggage, Star } from 'lucide-react'

interface SearchItem {
  id: number
  name: string
  type: string
  subtitle?: string | null
  url: string
  price?: number | null
}
interface SearchResults {
  businesses: SearchItem[]
  foods: SearchItem[]
  municipalities: SearchItem[]
  events: SearchItem[]
}
const EMPTY_SEARCH: SearchResults = { businesses: [], foods: [], municipalities: [], events: [] }

export default function TouristHeader() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  const [searchFocused, setSearchFocused] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestions, setSuggestions] = useState<SearchResults>(EMPTY_SEARCH)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchWrapRef = useClickOutside<HTMLDivElement>(() => setShowSuggestions(false))
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const profileRef = useClickOutside<HTMLDivElement>(() => setProfileOpen(false))
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

  const profilePhoto = toAssetUrl(user?.profile_photo)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim()) {
      navigate(`/tourist/search?q=${encodeURIComponent(searchQuery.trim())}`)
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = searchQuery.trim()
    if (q.length < 2) {
      setSuggestions(EMPTY_SEARCH)
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await get<SearchResults>('/tourist/explore/search', { params: { q } })
        setSuggestions(data)
        setShowSuggestions(true)
      } catch {
        setSuggestions(EMPTY_SEARCH)
      }
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [searchQuery])

  const hasSuggestions =
    suggestions.businesses.length > 0 ||
    suggestions.foods.length > 0 ||
    suggestions.municipalities.length > 0 ||
    suggestions.events.length > 0

  const handleSubmitSearch = () => {
    setShowSuggestions(false)
    if (searchQuery.trim()) {
      navigate(`/tourist/search?q=${encodeURIComponent(searchQuery.trim())}`)
    }
  }

  const suggestionTypeIcon = (type: string) => {
    switch (type) {
      case 'Food': return <UtensilsCrossed className="w-4 h-4 text-[#087F3F]" />
      case 'Municipality': return <Landmark className="w-4 h-4 text-[#B45309]" />
      case 'Event': return <CalendarRange className="w-4 h-4 text-[#7C3AED]" />
      default: return <Store className="w-4 h-4 text-[#0E7490]" />
    }
  }

  return (
    <header className="sticky top-0 z-[2000] bg-white/90 backdrop-blur-xl border-b border-[#E5E9E7]">
      <div className="flex items-center gap-4 px-6 h-[72px]">
        {/* Logo */}
        <Link to="/tourist/dashboard" className="flex items-center gap-2.5 shrink-0 group">
          <img
            src="/assets/logo/tracktour.png"
            alt="TrackTour Logo"
            className="w-10 h-10 object-contain shrink-0"
          />
          <div className="hidden sm:block leading-tight">
            <span className="text-base font-bold text-[#087F3F] tracking-tight">TrackTour</span>
            <span className="text-[10px] text-[#68736D] font-semibold tracking-[0.08em] block uppercase">Bansud Tourism</span>
          </div>
        </Link>

        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-2xl mx-auto">
          <div ref={searchWrapRef} className={`relative transition-all duration-200 ${searchFocused ? 'scale-[1.01]' : ''}`}>
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9CA3AF]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for food, restaurants, places, activities..."
              onFocus={() => { setSearchFocused(true); if (searchQuery.trim().length >= 2) setShowSuggestions(true) }}
              onBlur={() => setSearchFocused(false)}
              className="w-full pl-12 pr-5 py-3 bg-[#F7FAF7] border border-[#E5E9E7] rounded-2xl text-sm text-[#17201B] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F] transition shadow-sm"
            />

            {showSuggestions && hasSuggestions && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-[#E5E9E7] rounded-2xl shadow-2xl shadow-black/10 overflow-hidden z-50">
                <div className="p-2 max-h-[380px] overflow-y-auto">
                  {suggestions.foods.length > 0 && (
                    <>
                      <p className="px-3 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">Food</p>
                      {suggestions.foods.map((f) => (
                        <button
                          key={`food-${f.id}`}
                          type="button"
                          onClick={() => { setShowSuggestions(false); setSearchQuery(''); navigate(f.url) }}
                          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-[#F2F7F3] transition text-left"
                        >
                          <span className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center shrink-0">{suggestionTypeIcon(f.type)}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-[#17201B] truncate">{f.name}</span>
                            <span className="block text-xs text-[#68736D] truncate">{f.subtitle}</span>
                          </span>
                          <span className="text-xs font-bold text-[#087F3F] shrink-0">{f.price != null ? `₱${f.price.toLocaleString()}` : ''}</span>
                        </button>
                      ))}
                    </>
                  )}
                  {suggestions.businesses.length > 0 && (
                    <>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">Businesses & Places</p>
                      {suggestions.businesses.map((b) => (
                        <button
                          key={`biz-${b.id}`}
                          type="button"
                          onClick={() => { setShowSuggestions(false); setSearchQuery(''); navigate(b.url) }}
                          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-[#F2F7F3] transition text-left"
                        >
                          <span className="w-9 h-9 rounded-xl bg-[#E7F3F7] flex items-center justify-center shrink-0">{suggestionTypeIcon(b.type)}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-[#17201B] truncate">{b.name}</span>
                            <span className="block text-xs text-[#68736D] truncate flex items-center gap-1"><MapPin className="w-3 h-3 shrink-0" /> {b.subtitle}</span>
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                  {(suggestions.municipalities.length > 0 || suggestions.events.length > 0) && (
                    <>
                      <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">More</p>
                      {suggestions.municipalities.map((m) => (
                        <button
                          key={`mun-${m.id}`}
                          type="button"
                          onClick={() => { setShowSuggestions(false); setSearchQuery(''); navigate(m.url) }}
                          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-[#F2F7F3] transition text-left"
                        >
                          <span className="w-9 h-9 rounded-xl bg-[#FDF3E7] flex items-center justify-center shrink-0">{suggestionTypeIcon(m.type)}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-[#17201B] truncate">{m.name}</span>
                            <span className="block text-xs text-[#68736D] truncate">{m.subtitle}</span>
                          </span>
                        </button>
                      ))}
                      {suggestions.events.map((e) => (
                        <button
                          key={`evt-${e.id}`}
                          type="button"
                          onClick={() => { setShowSuggestions(false); setSearchQuery(''); navigate(e.url) }}
                          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-[#F2F7F3] transition text-left"
                        >
                          <span className="w-9 h-9 rounded-xl bg-[#F3E8FF] flex items-center justify-center shrink-0">{suggestionTypeIcon(e.type)}</span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-[#17201B] truncate">{e.name}</span>
                            <span className="block text-xs text-[#68736D] truncate">{e.subtitle}</span>
                          </span>
                        </button>
                      ))}
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => { setShowSuggestions(false); handleSubmitSearch() }}
                    className="flex items-center gap-3 w-full px-3 py-2.5 mt-1 rounded-xl border-t border-[#E5E9E7] hover:bg-[#F2F7F3] transition text-left"
                  >
                    <span className="w-9 h-9 rounded-xl bg-[#087F3F]/10 flex items-center justify-center shrink-0"><CornerDownLeft className="w-4 h-4 text-[#087F3F]" /></span>
                    <span className="flex-1 text-sm font-semibold text-[#17201B]">See all results for &quot;{searchQuery}&quot;</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>

        {/* Cart */}
        <button
          onClick={() => navigate('/tourist/food/cart')}
          className="relative p-2.5 rounded-xl text-[#68736D] hover:text-[#087F3F] hover:bg-[#E9F7EF] transition"
          title="Cart"
        >
          <ShoppingCart className="w-5 h-5" />
          {cartCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-[#087F3F] text-white text-[9px] font-bold flex items-center justify-center">
              {cartCount > 99 ? '99+' : cartCount}
            </span>
          )}
        </button>

        {/* Right actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigate('/tourist/favorites')}
            className="p-2.5 rounded-xl text-[#68736D] hover:text-[#087F3F] hover:bg-[#E9F7EF] transition"
            title="Favorites"
          >
            <Heart className="w-5 h-5" />
          </button>
          <button
            onClick={() => navigate('/tourist/notifications')}
            className="relative p-2.5 rounded-xl text-[#68736D] hover:text-[#087F3F] hover:bg-[#E9F7EF] transition"
            title="Notifications"
          >
            <Bell className="w-5 h-5" />
            <NotificationBadge />
          </button>

          {/* Divider */}
          <div className="w-px h-8 bg-[#E5E9E7] mx-1.5" />

          {/* Profile */}
          <div ref={profileRef} className="relative">
            <button
              onClick={() => setProfileOpen((p) => !p)}
              className="flex items-center gap-2.5 pl-1.5 pr-2.5 py-1.5 rounded-xl hover:bg-[#E9F7EF] transition"
            >
              {profilePhoto ? (
                <img src={profilePhoto} alt={user?.name} className="w-9 h-9 rounded-full object-cover ring-2 ring-[#087F3F]/20" />
              ) : (
                <span className="w-9 h-9 rounded-full bg-gradient-to-br from-[#087F3F] to-[#056B35] text-white flex items-center justify-center text-xs font-bold">
                  {getInitials(user?.name)}
                </span>
              )}
              <div className="hidden lg:block text-left">
                <p className="text-sm font-bold text-[#17201B] leading-tight truncate max-w-[140px]">{user?.name || 'Tourist'}</p>
                <p className="text-[10px] text-[#68736D] font-medium">Tourist</p>
              </div>
              <ChevronDown className="w-4 h-4 text-[#68736D] hidden lg:block" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-[#E5E9E7] rounded-2xl shadow-xl shadow-black/5 overflow-hidden z-50">
                <div className="flex items-center gap-3 px-5 pt-5 pb-4">
                  {profilePhoto ? (
                    <img src={profilePhoto} alt={user?.name} className="w-12 h-12 rounded-full object-cover ring-2 ring-[#087F3F]/30" />
                  ) : (
                    <span className="w-12 h-12 rounded-full bg-gradient-to-br from-[#087F3F] to-[#056B35] text-white flex items-center justify-center text-lg font-bold shrink-0">
                      {getInitials(user?.name)}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#17201B] truncate">{user?.name || 'Tourist'}</p>
                    <p className="text-xs text-[#68736D] truncate">{user?.email}</p>
                    <span className="inline-block mt-1 px-2 py-0.5 bg-[#E9F7EF] text-[#087F3F] text-[10px] font-semibold rounded-full">Tourist</span>
                  </div>
                </div>
                <div className="border-t border-[#E5E9E7] py-1.5">
                  <Link to="/tourist/profile" onClick={() => setProfileOpen(false)} className="flex items-center gap-2.5 px-5 py-2.5 text-sm text-[#68736D] hover:text-[#087F3F] hover:bg-[#E9F7EF] transition">
                    <User className="w-4 h-4" /> My Profile
                  </Link>
                  <Link to="/tourist/trips" onClick={() => setProfileOpen(false)} className="flex items-center gap-2.5 px-5 py-2.5 text-sm text-[#68736D] hover:text-[#087F3F] hover:bg-[#E9F7EF] transition">
                    <Luggage className="w-4 h-4" /> My Trips
                  </Link>
                  <Link to="/tourist/favorites" onClick={() => setProfileOpen(false)} className="flex items-center gap-2.5 px-5 py-2.5 text-sm text-[#68736D] hover:text-[#087F3F] hover:bg-[#E9F7EF] transition">
                    <Heart className="w-4 h-4" /> Saved
                  </Link>
                  <Link to="/tourist/reviews" onClick={() => setProfileOpen(false)} className="flex items-center gap-2.5 px-5 py-2.5 text-sm text-[#68736D] hover:text-[#087F3F] hover:bg-[#E9F7EF] transition">
                    <Star className="w-4 h-4" /> Reviews
                  </Link>
                  <Link to="/tourist/notifications" onClick={() => setProfileOpen(false)} className="flex items-center gap-2.5 px-5 py-2.5 text-sm text-[#68736D] hover:text-[#087F3F] hover:bg-[#E9F7EF] transition">
                    <Bell className="w-4 h-4" /> Notifications
                  </Link>
                </div>
                <div className="border-t border-[#E5E9E7] py-1.5">
                  {user ? (
                    <button onClick={() => { setProfileOpen(false); logout(); navigate('/login') }} className="w-full flex items-center gap-2.5 px-5 py-2.5 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 transition">
                      <LogOut className="w-4 h-4" /> Log Out
                    </button>
                  ) : (
                    <Link to="/login" onClick={() => setProfileOpen(false)} className="w-full flex items-center gap-2.5 px-5 py-2.5 text-sm text-[#087F3F] hover:text-[#056B35] hover:bg-[#E9F7EF] transition">
                      <LogOut className="w-4 h-4" /> Sign In
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
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
    <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#F4B400] text-[#17201B] text-[9px] font-bold flex items-center justify-center">
      {unread > 99 ? '99+' : unread}
    </span>
  )
}
