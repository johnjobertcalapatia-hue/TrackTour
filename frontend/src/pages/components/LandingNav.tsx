import { useCallback, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BedDouble, Briefcase, Car, ChevronDown, Compass, Home, Info, Mail, MapPin, Menu, Sparkles, User,
  UtensilsCrossed, X, type LucideIcon,
} from 'lucide-react'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { cn, getRoleDashboardPath } from '@/shared/utils'
import { useClickOutside } from '@/shared/hooks/use-click-outside'

export const EXPLORE_LINKS = [
  { label: 'Tourist Spots', to: '/explore?tab=places' },
  { label: 'Food & Restaurants', to: '/explore?tab=food' },
  { label: 'Stays & Resorts', to: '/explore?tab=stays' },
  { label: 'All Categories', to: '/explore/categories' },
]

export interface LandingService {
  title: string
  text: string
  icon: LucideIcon
  to?: string
  map?: boolean
}

export const LANDING_SERVICES: LandingService[] = [
  { title: 'Tourism & Travel', text: 'Discover top destinations in Bansud.', icon: Briefcase, to: '/explore?tab=places' },
  { title: 'Food Delivery', text: 'Satisfy your cravings from local restaurants.', icon: UtensilsCrossed, to: '/explore?tab=food' },
  { title: 'Stays & Deals', text: 'Book resorts and get the best rates.', icon: BedDouble, to: '/explore?tab=stays' },
  { title: 'Ride-Hailing', text: 'Ride safely and conveniently.', icon: Car, to: '/tourist/transport' },
  { title: 'Live Map', text: 'Track deliveries and explore places.', icon: MapPin, map: true },
]

interface LandingNavProps {
  badge?: string
  /** Which top-level item is current. */
  active?: 'home' | 'explore'
  /** Home page: open the landing map in place. Elsewhere it opens `/?view=map`. */
  onShowMap?: () => void
}

/**
 * Public site navigation shared by the landing hero (over the video) and the
 * inner landing pages (on their green title band).
 */
export default function LandingNav({ badge = 'Bansud, Oriental Mindoro', active = 'home', onShowMap }: LandingNavProps) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const [openMenu, setOpenMenu] = useState<'explore' | 'services' | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const closeMenus = useCallback(() => setOpenMenu(null), [])
  const navRef = useClickOutside<HTMLDivElement>(closeMenus)

  const goToSection = (id: string) => {
    setMobileOpen(false)
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else navigate(`/#${id}`)
  }

  const openService = (s: LandingService) => {
    setOpenMenu(null)
    setMobileOpen(false)
    if (s.map) {
      if (onShowMap) onShowMap()
      else navigate('/?view=map')
    } else if (s.to) {
      navigate(s.to)
    }
  }

  const accountLink = user ? getRoleDashboardPath(user.role) : '/login'
  const accountLabel = user ? 'My Dashboard' : 'Login / Sign Up'
  const navItem = 'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold text-white/95 transition hover:bg-white/10'
  const activePill = 'flex items-center gap-2 rounded-full border border-[#FFD000]/70 bg-[#0B5D2E] px-4 py-2 text-sm font-semibold text-white shadow-lg'

  return (
    <div ref={navRef} className="relative z-30 mx-auto flex max-w-[1400px] items-center gap-4 px-5 pt-5 lg:px-8">
      <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="TrackTour home">
        <img src="/assets/logo/tracktour.png" alt="TrackTour Logo" className="h-14 w-14 rounded-2xl bg-white object-contain p-1 shadow-lg" />
        <span className="leading-tight">
          <span className="block text-2xl font-extrabold tracking-tight text-white">
            Track<span className="text-[#FFD000]">Tour</span>
          </span>
          <span className="block text-[11px] font-medium text-white/90 sm:text-xs">{badge}</span>
        </span>
      </Link>

      <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex" aria-label="Main">
        <Link to="/" className={active === 'home' ? activePill : navItem}>
          <Home className="h-4 w-4" /> Home
        </Link>
        <div className="relative">
          <button
            type="button"
            className={active === 'explore' ? activePill : navItem}
            aria-expanded={openMenu === 'explore'}
            onClick={() => setOpenMenu((m) => (m === 'explore' ? null : 'explore'))}
          >
            <Compass className="h-4 w-4" /> Explore <ChevronDown className="h-4 w-4" />
          </button>
          {openMenu === 'explore' && (
            <div className="absolute left-0 mt-2 w-56 rounded-2xl bg-white p-2 shadow-xl">
              {EXPLORE_LINKS.map((l) => (
                <Link key={l.to} to={l.to} onClick={closeMenus} className="block rounded-xl px-3 py-2 text-sm font-medium text-[#14351F] hover:bg-[#EAF6ED]">
                  {l.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button type="button" className={navItem} aria-expanded={openMenu === 'services'} onClick={() => setOpenMenu((m) => (m === 'services' ? null : 'services'))}>
            <Sparkles className="h-4 w-4" /> Services <ChevronDown className="h-4 w-4" />
          </button>
          {openMenu === 'services' && (
            <div className="absolute left-0 mt-2 w-56 rounded-2xl bg-white p-2 shadow-xl">
              {LANDING_SERVICES.map((s) => (
                <button
                  key={s.title}
                  type="button"
                  onClick={() => openService(s)}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-medium text-[#14351F] hover:bg-[#EAF6ED]"
                >
                  <s.icon className="h-4 w-4 text-[#0B5D2E]" /> {s.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className={navItem} onClick={() => goToSection('about')}>
          <Info className="h-4 w-4" /> About
        </button>
        <button type="button" className={navItem} onClick={() => goToSection('contact')}>
          <Mail className="h-4 w-4" /> Contact
        </button>
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <Link to={accountLink} className="hidden items-center gap-2 rounded-full bg-[#FFD000] px-5 py-3 text-sm font-bold text-[#14351F] shadow-lg hover:bg-[#FFDD33] sm:flex">
          <User className="h-4 w-4" /> {accountLabel}
        </Link>
        <button
          type="button"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-black/25 text-white lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-[1300] lg:hidden">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-72 overflow-y-auto bg-[#0B3D20] p-5 text-white shadow-2xl">
            <button type="button" aria-label="Close menu" onClick={() => setMobileOpen(false)} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10">
              <X className="h-5 w-5" />
            </button>
            <Link to={accountLink} onClick={() => setMobileOpen(false)} className="mt-4 flex items-center justify-center gap-2 rounded-full bg-[#FFD000] px-5 py-3 text-sm font-bold text-[#14351F]">
              <User className="h-4 w-4" /> {accountLabel}
            </Link>
            <nav className="mt-4 space-y-1" aria-label="Mobile">
              <Link to="/" onClick={() => setMobileOpen(false)} className={cn('block rounded-xl px-3 py-2.5', active === 'home' ? 'bg-white/10 font-semibold' : 'text-white/85 hover:bg-white/10')}>Home</Link>
              {EXPLORE_LINKS.map((l) => (
                <Link key={l.to} to={l.to} onClick={() => setMobileOpen(false)} className="block rounded-xl px-3 py-2.5 text-white/85 hover:bg-white/10">{l.label}</Link>
              ))}
              {LANDING_SERVICES.map((s) => (
                <button key={s.title} type="button" onClick={() => openService(s)} className="block w-full rounded-xl px-3 py-2.5 text-left text-white/85 hover:bg-white/10">
                  {s.title}
                </button>
              ))}
              <button type="button" onClick={() => goToSection('about')} className="block w-full rounded-xl px-3 py-2.5 text-left text-white/85 hover:bg-white/10">About</button>
              <button type="button" onClick={() => goToSection('contact')} className="block w-full rounded-xl px-3 py-2.5 text-left text-white/85 hover:bg-white/10">Contact</button>
            </nav>
          </div>
        </div>
      )}
    </div>
  )
}
