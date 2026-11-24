import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { cn, getInitials, toAssetUrl } from '@/shared/utils'
import { ChevronRight, LogIn, LogOut, User } from 'lucide-react'
import { TOURIST_NAV_ITEMS, useActiveTouristNav } from './tourist-nav'
import PhotoPlaceholder from '@/shared/components/PhotoPlaceholder'
import { useCurrentMunicipality, useMunicipalityPhotos, DEFAULT_MUNICIPALITY_NAME } from '@/shared/hooks/use-current-municipality'

/**
 * Tourist sidebar (2026-11-24 redesign, matches the business owner portal):
 * deep green panel with the TrackTour logo, the tourist's card, the navigation
 * (gold marker on the active item), the "Discover <town>" card for the
 * municipality the tourist is in, and Log Out / Sign In.
 */
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
    <aside className="tourist-sidebar flex h-full w-[264px] shrink-0 flex-col overflow-y-auto bg-gradient-to-b from-[#0F4D2B] via-[#0C4325] to-[#0A3920] text-white">
      {/* Brand */}
      <Link to="/tourist/dashboard" className="flex items-center gap-2 px-5 pb-3 pt-5" aria-label="TrackTour home">
        <img src="/assets/logo/tracktour.png" alt="TrackTour logo" className="h-11 w-11 shrink-0 rounded-xl bg-[#ffffff] object-contain p-1" />
        <span className="leading-tight">
          <span className="block text-2xl font-extrabold tracking-tight text-white">Track<span className="text-[#F4C430]">Tour</span></span>
          <span className="block text-[10px] font-bold uppercase tracking-[0.12em] text-[#8FCBA5]">Bansud Tourism</span>
        </span>
      </Link>

      {/* The tourist (or guest) */}
      <Link
        to={user ? '/tourist/profile' : '/login'}
        className="tourist-user-card mx-3 flex items-center gap-3 rounded-[18px] border border-[#ffffff26] bg-[#ffffff0f] p-3 transition hover:bg-[#ffffff17]"
      >
        {profilePhoto ? (
          <img src={profilePhoto} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-[#ffffff33]" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1F7A45] text-sm font-bold text-white">
            {user ? getInitials(user.name) : <User className="h-5 w-5" aria-hidden="true" />}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-white">{user?.name || 'Guest'}</span>
          <span className="mt-1 inline-block rounded-full bg-[#2E9A57] px-2 py-0.5 text-[11px] font-semibold text-white">
            {user ? 'Tourist' : 'Sign in for orders'}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-[#A9D6B7]" aria-hidden="true" />
      </Link>

      {/* Navigation */}
      <nav aria-label="Tourist navigation" className="mt-4 px-3">
        <ul className="space-y-0.5">
          {TOURIST_NAV_ITEMS.map((item) => {
            const active = item.to === activeTo
            return (
              <li key={item.to}>
                <Link
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'tourist-nav-link relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                    active
                      ? 'tourist-nav-active bg-[#1F7A45] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
                      : 'text-[#D7EBDD] hover:bg-[#ffffff14] hover:text-white',
                  )}
                >
                  {active && <span aria-hidden="true" className="absolute -left-3 bottom-1.5 top-1.5 w-1 rounded-r-full bg-[#F4C430]" />}
                  <item.icon className={cn('h-5 w-5 shrink-0', active ? 'text-white' : 'text-[#A9D6B7]')} />
                  <span>{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Discover the town the tourist is in */}
      <Link
        to={promoTo}
        className="tourist-promo-card group relative mx-3 mt-5 block h-[clamp(140px,24vh,210px)] overflow-hidden rounded-[18px] border border-[#ffffff26] [@media(max-height:720px)]:hidden"
        aria-label={`Discover ${placeName}: explore, order, travel`}
      >
        {promoPhoto ? (
          <img
            src={promoPhoto}
            alt=""
            data-testid="promo-photo"
            className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <PhotoPlaceholder testId="promo-photo-empty" />
        )}
        <span className="absolute inset-0 bg-gradient-to-t from-[#0A3920]/95 via-[#0A3920]/45 to-transparent" />
        <span className="absolute bottom-4 left-4 right-4 text-white">
          <span className={cn('block font-extrabold leading-[1.05] drop-shadow', placeName.length > 10 ? 'text-xl' : 'text-2xl')}>
            Discover <span data-testid="promo-place" className="break-words text-[#F4C430]">{placeName}</span>
          </span>
          <span className="mt-1.5 block text-xs font-semibold text-[#D7EBDD]">Explore. Order. Travel.</span>
        </span>
      </Link>

      {/* Account */}
      <div className="mt-auto px-3 pb-3 pt-4">
        {user ? (
          <button
            type="button"
            onClick={() => { logout(); navigate('/login') }}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#D7EBDD] transition-colors hover:bg-[#ffffff14] hover:text-white"
          >
            <LogOut className="h-5 w-5 text-[#A9D6B7]" aria-hidden="true" /> Log Out
          </button>
        ) : (
          <Link
            to="/login"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#F4C430] transition-colors hover:bg-[#ffffff14]"
          >
            <LogIn className="h-5 w-5" aria-hidden="true" /> Sign In
          </Link>
        )}
        <p className="pt-1 text-center text-[11px] text-[#8FCBA5]">TrackTour · Bansud Tourism</p>
      </div>
    </aside>
  )
}
