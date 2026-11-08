import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { getInitials, toAssetUrl } from '@/shared/utils'
import { cn } from '@/shared/utils'
import { User, LogOut, LogIn, ChevronDown } from 'lucide-react'
import { TOURIST_NAV_ITEMS, useActiveTouristNav } from './tourist-nav'
import PhotoPlaceholder from '@/shared/components/PhotoPlaceholder'
import { useCurrentMunicipality, useMunicipalityPhotos, DEFAULT_MUNICIPALITY_NAME } from '@/shared/hooks/use-current-municipality'

export default function TouristSidebar() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const profilePhoto = toAssetUrl(user?.profile_photo)
  const activeTo = useActiveTouristNav()
  const municipality = useCurrentMunicipality()
  const placeName = municipality?.name ?? DEFAULT_MUNICIPALITY_NAME
  const photos = useMunicipalityPhotos(municipality?.id)
  // Located with no photos yet: empty container (the tourism office uploads one).
  const promoPhoto = municipality ? (photos[0] ? toAssetUrl(photos[0].src) : null) : '/assets/tourism/discover-bansud.png'
  const promoTo = municipality
    ? (user ? `/tourist/municipality/${municipality.id}` : `/explore/municipality/${municipality.id}`)
    : '/tourist/explore'

  return (
    <aside className="tourist-sidebar flex flex-col w-[248px] shrink-0 h-full bg-white border-r border-[#E5E9E7]">
      {/* Brand */}
      <Link to="/tourist/dashboard" className="flex items-center gap-2.5 px-6 pt-6 pb-5">
        <img src="/assets/logo/tracktour.png" alt="TrackTour logo" className="w-12 h-12 object-contain shrink-0" />
        <span className="leading-tight">
          <span className="block text-[22px] font-extrabold tracking-tight text-[#087F3F]">TrackTour</span>
          <span className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-[#56615B]">Bansud Tourism</span>
        </span>
      </Link>

      {/* User card */}
      <div className="mx-0 px-5 py-4 bg-[#F3F8F4] border-y border-[#E5E9E7]">
        <Link to={user ? '/tourist/profile' : '/login'} className="flex items-center gap-3">
          {profilePhoto ? (
            <img src={profilePhoto} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-white shadow-sm" />
          ) : (
            <span className="w-12 h-12 rounded-full bg-gradient-to-br from-[#087F3F] to-[#056B35] text-white flex items-center justify-center text-sm font-bold shrink-0 ring-2 ring-white">
              {user ? getInitials(user.name) : <User className="w-5 h-5" />}
            </span>
          )}
          <span className="min-w-0">
            <span className="block text-[15px] font-bold text-[#17201B] truncate">{user?.name || 'Guest'}</span>
            <span className="flex items-center gap-1 text-[13px] text-[#56615B]">
              {user ? 'Tourist' : 'Sign in for orders'} {user && <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav aria-label="Tourist navigation" className="px-4 pt-4 space-y-1">
        {TOURIST_NAV_ITEMS.map((item) => {
          const active = item.to === activeTo
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'tourist-nav-link flex items-center gap-4 px-4 py-3 rounded-2xl text-[15px] font-semibold transition-colors',
                active
                  ? 'tourist-nav-active bg-gradient-to-r from-[#087F3F] to-[#3E9D5F] text-white shadow-md shadow-[#087F3F]/20'
                  : 'text-[#17201B] hover:bg-[#F3F8F4] hover:text-[#087F3F]'
              )}
            >
              <item.icon className={cn('w-[22px] h-[22px] shrink-0', active ? 'text-white' : 'text-[#3B4540]')} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {/* Promo card */}
      <Link
        to={promoTo}
        className="tourist-promo-card relative block mx-5 mt-6 h-[clamp(150px,26vh,230px)] rounded-2xl overflow-hidden group [@media(max-height:720px)]:hidden"
        aria-label={`Discover ${placeName}: explore, order, travel`}
      >
        {promoPhoto ? (
          <img
            src={promoPhoto}
            alt=""
            data-testid="promo-photo"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition duration-500"
          />
        ) : (
          <PhotoPlaceholder testId="promo-photo-empty" />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-[#0B2A17]/90 via-[#0B2A17]/35 to-transparent" />
        <span className="absolute left-5 right-4 bottom-5 text-white -rotate-6 origin-bottom-left">
          <span className={cn('block leading-[1.05] font-extrabold italic drop-shadow', placeName.length > 10 ? 'text-[23px]' : 'text-[28px]')}>Discover<br /><span data-testid="promo-place" className="break-words">{placeName}</span></span>
          <span className="block mt-2 text-sm font-semibold">Explore. Order. Travel.</span>
          <span className="block mt-1 h-1 w-24 rounded-full bg-[#F4B400]" />
        </span>
      </Link>

      {/* Account */}
      <div className="mt-auto px-4 py-4 border-t border-[#E5E9E7]">
        {user ? (
          <button
            type="button"
            onClick={() => { logout(); navigate('/login') }}
            className="flex items-center gap-4 w-full px-4 py-3 rounded-2xl text-[15px] font-semibold text-[#17201B] hover:bg-red-50 hover:text-red-600 transition-colors"
          >
            <LogOut className="w-[22px] h-[22px]" /> Log Out
          </button>
        ) : (
          <Link
            to="/login"
            className="flex items-center gap-4 w-full px-4 py-3 rounded-2xl text-[15px] font-semibold text-[#087F3F] hover:bg-[#F3F8F4] transition-colors"
          >
            <LogIn className="w-[22px] h-[22px]" /> Sign In
          </Link>
        )}
      </div>
    </aside>
  )
}
