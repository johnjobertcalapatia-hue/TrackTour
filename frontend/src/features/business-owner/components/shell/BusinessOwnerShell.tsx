import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { Skeleton } from '@/shared/components/Skeleton'
import SystemNoticeBanner from '@/shared/components/SystemNoticeBanner'
import { cn, getInitials, toAssetUrl } from '@/shared/utils'
import { useBusinessOwnerStore } from '../../services/business-owner-store'
import { ArrowRight, Bell, Check, ChevronDown, LogOut, Menu, Settings, User, X } from 'lucide-react'

export interface ShellNavItem {
  to: string
  label: string
  icon?: ReactNode
}

export interface ShellNavSection {
  label?: string
  items: ShellNavItem[]
}

/** Food businesses get the restaurant wording and icon. */
const FOOD_CATEGORIES = ['Restaurant', 'Café', 'Food Hub', 'Hotel & Restaurant Combination']

/**
 * Pages reached through a redirect that live under another item's path: the
 * Business Gallery entry opens /business-owner/businesses/:id/gallery, which
 * would otherwise light up "My Businesses".
 */
const ACTIVE_ALIASES: Record<string, RegExp> = {
  '/business-owner/gallery': /^\/business-owner\/businesses\/\d+\/(gallery|tourist-attraction-gallery)\/?$/,
}

/**
 * Another portal in the same shell (2026-11-24: the staff portal). Without it
 * the shell is the business owner's (business switcher, owner notifications,
 * Grow-your-business card, Business Profile / Account Settings menu).
 */
export interface ShellPortal {
  /** Dashboard path: the logo's link, never "active" for sub-pages. */
  homeTo: string
  /** Replaces the owner's business card + switcher. */
  businessCard: ReactNode
  /** Replaces the "Grow your business" card (null: none). */
  sideCard?: ReactNode
  header: { title: string; subtitle: string }
  person: { name: string; roleLabel: string; photo?: string | null }
  /** Bell link; omitted: no bell. */
  notificationsTo?: string
  /** Account menu entries before Log Out. */
  menu: { to: string; label: string; icon: ReactNode }[]
  /** Accessible name of the sidebar navigation. */
  navLabel?: string
}

/** Routes that show a "New" badge in the sidebar. */
const NEW_ROUTES = ['/business-owner/staff']

/**
 * Business owner portal shell (redesign, matches the TrackTour owner mockup):
 * dark green sidebar (logo, business card + switcher, navigation, insights
 * card, sign out) and a light header (business, notifications, profile menu)
 * over a warm cream page. Navigation and module filtering come unchanged from
 * BusinessOwnerLayout; only the look changed.
 */
export default function BusinessOwnerShell({ sections, portal }: { sections: ShellNavSection[]; portal?: ShellPortal }) {
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Close the mobile drawer on navigation.
  useEffect(() => setDrawerOpen(false), [location.pathname, location.search])

  return (
    // `relative` on the shell and on <main>: absolutely positioned content (screen-reader-only
    // labels, menus) must belong to the scroll area. Without it they were placed against the
    // page itself, escaped the scroll clipping and stretched the page below the portal
    // (a blank area and a second scrollbar, e.g. on a long Notifications list).
    <div className="owner-portal relative flex h-[100dvh] w-full min-w-0 overflow-hidden bg-[#F6F4EE] text-[#17201B]">
      {/* Desktop sidebar */}
      <aside className="hidden w-[264px] shrink-0 lg:flex" aria-label={portal ? 'Portal navigation' : 'Business owner navigation'}>
        <SidebarContent sections={sections} portal={portal} />
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Close navigation" className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw]">
            <SidebarContent sections={sections} portal={portal} onClose={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <ShellHeader portal={portal} onOpenMenu={() => setDrawerOpen(true)} />
        <main className="relative min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] px-4 pb-8 pt-2 sm:px-6">
            {/* System maintenance notices from the admin, until the window ends. */}
            <div className="mb-4 empty:hidden"><SystemNoticeBanner /></div>
            <Suspense fallback={<div className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>}>
              <Outlet key={location.pathname + location.search} />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}

function SidebarContent({ sections, onClose, portal }: { sections: ShellNavSection[]; onClose?: () => void; portal?: ShellPortal }) {
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const location = useLocation()
  const business = useSelectedBusiness()
  const isFood = business ? FOOD_CATEGORIES.includes(business.category) : true

  const navTargets = sections.flatMap((section) => section.items.map((item) => item.to))
  const aliasTarget = Object.entries(ACTIVE_ALIASES).find(([to, pattern]) => navTargets.includes(to) && pattern.test(location.pathname))?.[0]

  const isActive = (to: string) => {
    if (aliasTarget) return to === aliasTarget
    const [path, query] = to.split('?')
    if (query) return location.pathname === path && location.search.includes(query)
    return location.pathname === path || (path !== (portal?.homeTo ?? '/business-owner/dashboard') && location.pathname.startsWith(path + '/'))
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-gradient-to-b from-[#0F4D2B] via-[#0C4325] to-[#0A3920] text-white">
      <div className="flex items-center justify-between px-5 pb-3 pt-5">
        <Link to={portal?.homeTo ?? '/business-owner/dashboard'} className="flex items-center gap-2" aria-label="TrackTour home">
          <img src="/assets/logo/tracktour.png" alt="" className="h-11 w-11 rounded-xl bg-[#ffffff] object-contain p-1" />
          <span className="text-2xl font-extrabold tracking-tight text-white">Track<span className="text-[#F4C430]">Tour</span></span>
        </Link>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close navigation" className="rounded-lg p-2 text-white/80 hover:bg-[#ffffff1a]">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {portal ? portal.businessCard : <BusinessCard />}

      <nav className="mt-3 flex-1 space-y-4 px-3 pb-4" aria-label={portal?.navLabel ?? 'Sections'}>
        {sections.map((section, si) => (
          <div key={`${section.label ?? 'main'}-${si}`}>
            {section.label && (
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#8FCBA5]">{section.label}</p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.to)
                return (
                  <li key={item.to + item.label}>
                    <Link
                      to={item.to}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                        active ? 'bg-[#1F7A45] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]' : 'text-[#D7EBDD] hover:bg-[#ffffff14] hover:text-white',
                      )}
                    >
                      {active && <span aria-hidden="true" className="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r-full bg-[#F4C430]" />}
                      <span className={cn('shrink-0 [&>svg]:h-5 [&>svg]:w-5', active ? 'text-white' : 'text-[#A9D6B7]')}>{item.icon}</span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {NEW_ROUTES.includes(item.to) && (
                        <span className="rounded-full bg-[#F4C430] px-1.5 py-0.5 text-[10px] font-bold text-[#3A2A00]">New</span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-3 pb-3">
        {portal ? (portal.sideCard ?? null) : (
        <div className="rounded-[18px] border border-[#ffffff26] bg-gradient-to-br from-[#14653A] to-[#0D4A2A] p-4">
          <p className="text-sm font-bold leading-snug text-white">Grow your {isFood ? 'restaurant' : 'business'} with TrackTour</p>
          <p className="mt-1 text-xs text-[#C8E6D2]">See your sales, orders and expenses in one place.</p>
          <button
            type="button"
            onClick={() => navigate('/business-owner/reports')}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#F4C430] px-3 py-1.5 text-xs font-bold text-[#3A2A00] hover:bg-[#FFD24D]"
          >
            View Insights <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
        )}
        <button
          type="button"
          onClick={() => { void logout() }}
          className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-[#D7EBDD] hover:bg-[#ffffff14] hover:text-white"
        >
          <LogOut className="h-5 w-5 text-[#A9D6B7]" /> Log Out
        </button>
        <p className="pt-1 text-center text-[11px] text-[#8FCBA5]">TrackTour · Bansud Tourism</p>
      </div>
    </div>
  )
}

/** The selected business card with the business switcher (same store as before). */
function BusinessCard() {
  const businesses = useBusinessOwnerStore((s) => s.businesses)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  const setSelectedBusinessId = useBusinessOwnerStore((s) => s.setSelectedBusinessId)
  const business = useSelectedBusiness()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  if (businesses.length === 0) return null
  const name = business?.name ?? 'All Businesses'
  const logo = business?.logo ? toAssetUrl(business.logo) : ''

  return (
    <div ref={ref} className="relative mx-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Business: ${name}. Switch business`}
        className="flex w-full items-center gap-3 rounded-[18px] border border-[#ffffff26] bg-[#ffffff0f] p-3 text-left hover:bg-[#ffffff17]"
      >
        {logo ? (
          <img src={logo} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover ring-2 ring-[#ffffff33]" />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#1F7A45] text-sm font-bold">{getInitials(name)}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 block text-sm font-bold leading-snug text-white">{name}</span>
          {business?.category && (
            <span className="mt-1 inline-block rounded-full bg-[#2E9A57] px-2 py-0.5 text-[11px] font-semibold text-white">{business.category}</span>
          )}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-[#A9D6B7] transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul role="listbox" aria-label="Your businesses" className="absolute left-0 right-0 z-30 mt-2 max-h-72 overflow-y-auto rounded-xl bg-[#fff] p-1 text-sm text-[#17201B] shadow-xl">
          {businesses.length > 1 && (
            <li>
              <button type="button" role="option" aria-selected={selectedBusinessId === null} onClick={() => { setSelectedBusinessId(null); setOpen(false) }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 hover:bg-[#F3F8F4]">
                All Businesses {selectedBusinessId === null && <Check className="h-4 w-4 text-[#16803C]" />}
              </button>
            </li>
          )}
          {businesses.map((b) => (
            <li key={b.id}>
              <button type="button" role="option" aria-selected={b.id === selectedBusinessId} onClick={() => { setSelectedBusinessId(b.id); setOpen(false) }} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-[#F3F8F4]">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{b.name}</span>
                  <span className="block text-xs text-[#647067]">{b.category}</span>
                </span>
                {b.id === selectedBusinessId && <Check className="h-4 w-4 shrink-0 text-[#16803C]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ShellHeader({ onOpenMenu, portal }: { onOpenMenu: () => void; portal?: ShellPortal }) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const business = useSelectedBusiness()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Same query key as the notifications page, so read state stays in sync.
  const { data: notifications } = useQuery({
    queryKey: ['bo-notifications'],
    queryFn: () => get<{ data: { read_at: string | null }[]; meta?: { unread_counts?: { all: number } } } | { read_at: string | null }[]>('/business-owner/notifications?perPage=1'),
    staleTime: 60_000,
    // Owner notifications only; another portal brings its own bell (or none).
    enabled: !portal,
  })
  // The server counts every unread notification (not just the first page).
  const unread = Array.isArray(notifications)
    ? notifications.filter((n) => !n.read_at).length
    : notifications?.meta?.unread_counts?.all ?? (notifications?.data ?? []).filter((n) => !n.read_at).length

  useEffect(() => setMenuOpen(false), [location.pathname])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const photoPath = portal ? portal.person.photo : user?.profile_photo
  const photo = photoPath ? toAssetUrl(photoPath) : ''
  const personName = portal?.person.name ?? user?.name ?? ''
  const notificationsTo = portal ? portal.notificationsTo : '/business-owner/notifications'

  return (
    <header className="flex h-[76px] shrink-0 items-center gap-3 px-4 sm:px-6">
      <button type="button" onClick={onOpenMenu} aria-label="Open navigation" className="rounded-xl p-2 text-[#0F4D2B] hover:bg-[#EAE6DA] lg:hidden">
        <Menu className="h-6 w-6" />
      </button>

      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold text-[#17201B] sm:text-lg">{portal?.header.title ?? business?.name ?? 'All Businesses'}</p>
          <p className="truncate text-xs text-[#5E6B63]">{portal?.header.subtitle ?? 'Business Owner Dashboard'}</p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-4">
        {notificationsTo && (
        <Link
          to={notificationsTo}
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative rounded-full p-2.5 text-[#0F4D2B] hover:bg-[#EAE6DA]"
        >
          <Bell className="h-6 w-6" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#DC2626] px-1 text-[10px] font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Link>
        )}

        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex items-center gap-3 rounded-full py-1 pl-1 pr-2 hover:bg-[#EAE6DA]"
          >
            {photo ? (
              <img src={photo} alt="" className="h-11 w-11 rounded-full object-cover" />
            ) : (
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#0F4D2B] text-sm font-bold text-white">{getInitials(personName)}</span>
            )}
            <span className="hidden text-left sm:block">
              <span className="block max-w-[180px] truncate text-sm font-bold text-[#17201B]">{personName}</span>
              <span className="block text-xs text-[#5E6B63]">{portal?.person.roleLabel ?? 'Business Owner'}</span>
            </span>
            <ChevronDown className="hidden h-4 w-4 text-[#5E6B63] sm:block" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-xl bg-[#fff] py-1 text-sm shadow-xl ring-1 ring-black/5">
              {portal ? portal.menu.map((m) => (
                <Link key={m.to} role="menuitem" to={m.to} className="flex items-center gap-2 px-4 py-2.5 hover:bg-[#F3F8F4] [&>svg]:h-4 [&>svg]:w-4 [&>svg]:text-[#16803C]">{m.icon} {m.label}</Link>
              )) : (
                <>
                  <Link role="menuitem" to="/business-owner/profile" className="flex items-center gap-2 px-4 py-2.5 hover:bg-[#F3F8F4]"><User className="h-4 w-4 text-[#16803C]" /> Business Profile</Link>
                  <Link role="menuitem" to="/business-owner/account-settings" className="flex items-center gap-2 px-4 py-2.5 hover:bg-[#F3F8F4]"><Settings className="h-4 w-4 text-[#16803C]" /> Account Settings</Link>
                </>
              )}
              <button role="menuitem" type="button" onClick={() => { void logout() }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-[#B91C1C] hover:bg-[#FEF2F2]"><LogOut className="h-4 w-4" /> Log Out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function useSelectedBusiness() {
  const businesses = useBusinessOwnerStore((s) => s.businesses)
  const selectedBusinessId = useBusinessOwnerStore((s) => s.selectedBusinessId)
  if (selectedBusinessId) return businesses.find((b) => b.id === selectedBusinessId)

  return businesses.length === 1 ? businesses[0] : undefined
}
