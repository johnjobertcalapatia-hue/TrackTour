import { Suspense, useState, useEffect, useCallback, cloneElement, isValidElement, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { post } from '@/shared/services/api'
import type { User as AppUser } from '@/shared/types'
import { cn, getInitials } from '@/shared/utils'
import { ChevronLeft, ChevronRight, ChevronDown, LogOut, Power, User, Settings, Navigation, Star } from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon?: ReactNode
}

export interface NavSection {
  label?: string
  items: NavItem[]
  collapsible?: boolean
}

interface DashboardLayoutProps {
  sections?: NavSection[]
  navItems?: NavItem[]
  roleLabel: string
  children?: ReactNode
  sidebarTopSlot?: ReactNode
  theme?: 'default' | 'tourism' | 'admin'
  profilePath?: string
  preferExpanded?: boolean
  bottomNavigation?: boolean
}

export default function DashboardLayout({ navItems, roleLabel, sections, sidebarTopSlot, theme = 'default', profilePath, preferExpanded = false, bottomNavigation = false }: DashboardLayoutProps) {
  const tourism = theme === 'tourism'
  const admin = theme === 'admin'
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const logout = useAuthStore((s) => s.logout)
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(() => {
    if (preferExpanded && window.innerWidth >= 1024) return false
    const saved = localStorage.getItem('sidebar_collapsed')
    if (saved !== null) return saved === 'true'
    return window.innerWidth < 1024
  })

  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({})
  const [riderOnline, setRiderOnline] = useState(() => user?.rider_status === 'online' || user?.rider_status === 'available')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  useEffect(() => {
    if (roleLabel === 'Rider' && user?.rider_status) {
      setRiderOnline(user.rider_status === 'online' || user.rider_status === 'available')
    }
  }, [roleLabel, user?.rider_status])

  useEffect(() => {
    setProfileMenuOpen(false)
  }, [location.pathname])

  const toggleSection = useCallback((index: number) => {
    setExpandedSections((prev) => ({ ...prev, [index]: !prev[index] }))
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      localStorage.setItem('sidebar_collapsed', String(!prev))
      return !prev
    })
  }

  const isActive = (path: string) => {
    const fullPath = location.pathname + location.search
    const p = location.pathname
    // For items with query params (e.g. settings tabs), compare full path+search
    if (path.includes('?')) {
      return fullPath === path || fullPath === path + '/'
    }
    if (p === path || p === path + '/') return true
    // For deliveries section, match any sub-route
    if (path === '/rider/deliveries/pending' && p.startsWith('/rider/deliveries')) return true
    if (!p.startsWith(path + '/')) {
      // Special case: gallery nav should match /businesses/:id/gallery
      if (path.endsWith('/gallery') && p.includes('/gallery')) return true
      return false
    }
    const segments = p.slice(path.length + 1).split('/')
    // Sub-routes like /businesses/123/gallery should not activate parent nav
    if (segments.length >= 2 && segments[segments.length - 1] === 'gallery') {
      return path.endsWith('/gallery')
    }
    return true
  }

  const renderNavItems = () => {
    if (sections) {
      return sections.map((section, si) => {
        const isCollapsible = !!section.collapsible
        const isExpanded = isCollapsible ? (expandedSections[si] ?? false) : true

        return (
          <div key={si}>
            {section.label && !collapsed && (
              <div className="pt-6 pb-1.5">
                {isCollapsible ? (
                  <button
                    onClick={() => toggleSection(si)}
                    className={cn(
                      'w-full flex items-center justify-between px-3 text-[11px] font-bold uppercase tracking-[0.08em] transition-colors',
                      admin ? 'text-[#087F3F] hover:text-[#056B35]' : tourism ? 'text-[#6B756E] hover:text-[#087F3F]' : 'text-ink-soft hover:text-ink'
                    )}
                  >
                    <span>{section.label}</span>
                    <ChevronDown
                      className={cn(
                        'w-3.5 h-3.5 transition-transform duration-200',
                        !isExpanded && '-rotate-90'
                      )}
                    />
                  </button>
                ) : (
                  <p className={cn('px-3 text-[11px] font-bold uppercase tracking-[0.08em]', admin ? 'text-[#087F3F]' : tourism ? 'text-[#6B756E]' : 'text-ink-soft')}>
                    {section.label}
                  </p>
                )}
              </div>
            )}
            {collapsed && si > 0 && <div className={cn('pt-3 mx-3 border-t', admin ? 'border-[#DDF4E6]' : tourism ? 'border-[#E5E9E7]' : 'border-ink/5')} />}
            {(!isCollapsible || isExpanded) && section.items.map((item) => (
              <div key={item.to} className="relative group">
                <Link
                  to={item.to}
                  onClick={(e) => {
                    e.preventDefault()
                    if (item.to.includes('?')) {
                      const [path, query] = item.to.split('?')
                      navigate(`${path}?${query}&_t=${Date.now()}`, { replace: true })
                    } else {
                      navigate(`${item.to}?_t=${Date.now()}`, { replace: true })
                    }
                  }}
                  className={cn(
                    'flex items-center gap-3 py-2.5 text-sm font-medium transition-all duration-150',
                    collapsed ? 'justify-center px-0 mx-1' : 'px-3',
                    isActive(item.to)
                      ? admin
                        ? 'bg-[#087F3F] text-white border-l-[3px] border-[#F4B400] rounded-r-[10px] shadow-sm'
                        : tourism
                        ? 'bg-[#E9F7EF] text-[#087F3F] border-l-[3px] border-[#087F3F] rounded-r-[10px]'
                        : 'bg-primary/10 text-primary border-l-4 border-primary'
                      : admin
                        ? 'text-[#087F3F] hover:bg-[#E9F7EF] hover:text-[#056B35]'
                        : tourism
                        ? 'text-[#68736D] hover:bg-[#F3F8F4] hover:text-[#087F3F]'
                        : 'text-ink-soft hover:bg-white/70 hover:text-ink',
                    !collapsed && section.items.length > 1 && 'ml-3'
                  )}
                >
                  {item.icon && <span className="w-5 h-5 shrink-0">{item.icon}</span>}
                  {!collapsed && <span>{item.label}</span>}
                </Link>
                {collapsed && (
                  <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 bg-white text-ink text-xs font-medium rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg border border-ink/5">
                    {item.label}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })
    }
    return navItems?.map((item) => (
      <div key={item.to} className="relative group">
        <Link
          to={item.to}
          className={cn(
            'flex items-center gap-3 py-2.5 text-sm font-medium transition-all duration-150',
            collapsed ? 'justify-center px-0 mx-1' : 'px-3',
            isActive(item.to)
                ? admin
                  ? 'bg-[#087F3F] text-white border-l-[3px] border-[#F4B400] rounded-r-[10px] shadow-sm'
                  : tourism
                  ? 'bg-[#E9F7EF] text-[#087F3F] border-l-[3px] border-[#087F3F] rounded-r-[10px]'
                  : 'bg-primary/10 text-primary border-l-4 border-primary'
              : admin
                ? 'text-[#087F3F] hover:bg-[#E9F7EF] hover:text-[#056B35]'
                : tourism
                ? 'text-[#68736D] hover:bg-[#F3F8F4] hover:text-[#087F3F]'
                : 'text-ink-soft hover:bg-white/70 hover:text-ink'
          )}
        >
          {item.icon && <span className="w-5 h-5 shrink-0">{item.icon}</span>}
          {!collapsed && <span>{item.label}</span>}
        </Link>
{collapsed && (
          <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 bg-white text-ink text-xs font-medium rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg border border-ink/5">
            {item.label}
          </div>
        )}
      </div>
    ))
  }

  const bottomItems = sections
    ? sections.flatMap((section) => section.items)
    : (navItems ?? [])
  const riderBottomItems = [
    bottomItems.find((item) => item.to === '/rider'),
    {
      ...bottomItems.find((item) => item.to === '/rider/deliveries/pending'),
      label: user?.current_service === 'transport' ? 'Bookings' : 'Deliveries',
    },
    bottomItems.find((item) => item.to === '/rider/map'),
    bottomItems.find((item) => item.to === '/rider/wallet'),
    bottomItems.find((item) => item.to === '/rider/earnings'),
  ].filter((item): item is NavItem => Boolean(item))
  const navigationItems = roleLabel === 'Rider' && bottomNavigation ? riderBottomItems : bottomItems

  const toggleRiderAvailability = async () => {
    const response = await post<{ rider_status?: string }>('/rider/availability/toggle')
    const riderStatus = response?.rider_status
    const online = riderStatus === 'online' || riderStatus === 'available'
    setUser(user ? { ...user, rider_status: riderStatus as AppUser['rider_status'] } : null)
    setRiderOnline(online)
    navigate('/rider/map')
    if (online) {
      window.dispatchEvent(new Event('rider-go-online'))
    }
  }

  return (
    <div className={cn('flex h-[100dvh] w-full min-w-0 overflow-x-hidden text-ink', tourism ? 'tourism-bg text-[#17201B]' : 'glass-bg')}>
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 ease-in-out',
          bottomNavigation && 'hidden',
          admin ? 'bg-white text-[#087F3F] border-r border-[#E5E9E7] shadow-[4px_0_24px_rgba(8,127,63,0.08)]' : tourism ? 'tourism-sidebar' : 'glass-sidebar',
          collapsed ? 'w-16' : 'w-[220px] lg:w-[255px]'
        )}
      >
        <div className={cn('h-16 flex items-center shrink-0', admin ? 'border-b border-[#E5E9E7]' : tourism ? 'border-b border-[#E5E9E7]' : 'border-b border-white/30', collapsed ? 'justify-center px-2' : 'gap-3 px-5')}>
          <img
            src="/assets/logo/tracktour.png"
            alt="TrackTour Logo"
            className="w-24 h-24 object-contain shrink-0"
          />
          {!collapsed && (
            <span className={cn('text-base font-bold', admin ? 'text-[#087F3F]' : 'text-[#087F3F]')}>
              TrackTour
            </span>
          )}
        </div>

        {!collapsed && (
          <div className={cn('mx-3 mt-3 px-3 py-2.5 rounded-xl border', admin ? 'bg-[#F3F8F4] border-[#DDF4E6]' : tourism ? 'bg-[#E9F7EF] border-[#D7E8DB]' : 'bg-white/60 border-white/40')}>
            <p className={cn('text-[10px] font-medium uppercase tracking-wider', admin ? 'text-[#087F3F]' : tourism ? 'text-[#087F3F]' : 'text-primary')}>
              Signed in as
            </p>
            <div className="flex items-center gap-2.5 mt-1.5">
              <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0', admin ? 'bg-[#087F3F] text-white' : tourism ? 'bg-[#087F3F] text-white' : 'bg-white/70 backdrop-blur-md border border-white/50 text-primary')}>
                {getInitials(user?.name)}
              </div>
              <div className="min-w-0">
                <p className={cn('text-sm font-medium truncate', admin ? 'text-[#17201B]' : tourism ? 'text-[#17201B]' : 'text-ink-soft')}>{user?.name}</p>
                <p className={cn('text-[11px] truncate', admin ? 'text-[#68736D]' : tourism ? 'text-[#68736D]' : 'text-ink-soft')}>{roleLabel}</p>
              </div>
            </div>
          </div>
        )}

        {sidebarTopSlot && (
          <div className={collapsed ? 'mx-1 mt-3' : 'mx-3 mt-3'}>
            {isValidElement(sidebarTopSlot)
              ? cloneElement(sidebarTopSlot as React.ReactElement<{ collapsed?: boolean }>, { collapsed })
              : sidebarTopSlot}
          </div>
        )}

        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5 scrollbar-thin scrollbar-thumb-gray-300">
          {renderNavItems()}
        </nav>

        <div className={cn('p-2 space-y-1', admin ? 'border-t border-[#E5E9E7]' : tourism ? 'border-t border-[#E5E9E7]' : 'border-t border-white/30', collapsed && 'px-1')}>
          <div className="relative group">
            <button
              onClick={toggleCollapsed}
              className={cn(
                'flex items-center gap-3 py-2.5 text-sm font-medium transition-all w-full',
                collapsed ? 'justify-center px-0' : 'px-3',
                admin ? 'text-[#087F3F] hover:bg-[#E9F7EF] hover:text-[#056B35]' : tourism ? 'text-[#68736D] hover:bg-[#F3F8F4] hover:text-[#087F3F]' : 'text-ink-soft hover:bg-white/70 hover:text-ink'
              )}
            >
              {collapsed ? (
                <ChevronRight className="w-5 h-5 shrink-0" />
              ) : (
                <>
                  <ChevronLeft className="w-5 h-5 shrink-0" />
                  <span>Collapse</span>
                </>
              )}
            </button>
            {collapsed && (
              <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 bg-white text-ink text-xs font-medium rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg border border-ink/5">
                Expand
              </div>
            )}
          </div>
          {roleLabel !== 'Rider' && (
            <div className="relative group">
              <button
                onClick={logout}
                className={cn(
                  'flex items-center gap-3 py-2.5 text-sm font-medium transition-all w-full',
                  collapsed ? 'justify-center px-0' : 'px-3',
                  admin ? 'text-[#087F3F] hover:bg-[#E9F7EF] hover:text-[#056B35]' : tourism ? 'text-[#68736D] hover:bg-[#F3F8F4] hover:text-[#087F3F]' : 'text-ink-soft hover:bg-white/70 hover:text-ink'
                )}
              >
                <LogOut className="w-5 h-5 shrink-0" />
                {!collapsed && <span>Log Out</span>}
              </button>
              {collapsed && (
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 bg-white text-ink text-xs font-medium rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg border border-ink/5">
                  Log Out
                </div>
              )}
            </div>
          )}
        </div>
      </aside>

      <div
        className={cn(
          'flex-1 flex flex-col min-w-0 w-full transition-all duration-300',
          bottomNavigation ? 'ml-0' : collapsed ? 'ml-16' : 'ml-[220px] lg:ml-[255px]'
        )}
      >
        <header className={cn(
          'relative z-[1200] h-16 shrink-0 flex items-center w-full px-4 sm:px-6 gap-4',
          bottomNavigation && 'max-w-[480px] mx-auto',
          !bottomNavigation && (tourism ? 'tourism-nav' : 'glass-nav')
        )}>
          {!bottomNavigation && (
          <div className={cn('relative z-20 ml-auto flex items-center gap-3 pl-3 border-l', tourism ? 'border-[#E5E9E7]' : 'border-white/30')}>
            {profilePath ? (
              <>
                <button
                  type="button"
                  onClick={() => setProfileMenuOpen((open) => !open)}
                  aria-expanded={profileMenuOpen}
                  aria-haspopup="menu"
                  className="flex items-center gap-3 rounded-xl p-1.5 text-left transition hover:bg-black/5"
                >
<div className="flex flex-col items-center gap-1 mt-2">
                      <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-base font-bold', tourism ? 'bg-[#087F3F] text-white' : 'bg-white/70 backdrop-blur-md border border-white/50 shadow-glass text-primary')}>
                        {getInitials(user?.name)}
                      </div>
                      {roleLabel === 'Rider' && (
                        <div className="flex items-center gap-1 bg-[#E9F7EF] rounded-full px-2 py-0.5">
                          <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                          <span className="text-xs font-bold text-[#087F3F]">{(user?.rider_rating ?? 5.00).toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  <div className="hidden sm:block">
                    <p className={cn('text-sm font-semibold', tourism ? 'text-[#17201B]' : 'text-ink')}>{user?.name}</p>
                    <p className={cn('text-xs', tourism ? 'text-[#68736D]' : 'text-ink-soft')}>{roleLabel}</p>
                  </div>
                </button>
                {profileMenuOpen && (
                  <div role="menu" className="absolute right-0 top-full z-[1300] mt-2 w-44 overflow-hidden rounded-xl border border-[#E5E9E7] bg-white py-1 shadow-xl">
                    <Link to={profilePath} onClick={() => setProfileMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#17201B] transition hover:bg-[#F3F8F4]" role="menuitem">
                      <User className="h-4 w-4 text-[#087F3F]" />
                      Profile
                    </Link>
                    <Link to="/rider/settings" onClick={() => setProfileMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#17201B] transition hover:bg-[#F3F8F4]" role="menuitem">
                      <Settings className="h-4 w-4 text-[#087F3F]" />
                      Settings
                    </Link>
                    <button
                      type="button"
                      onClick={async () => {
                        setProfileMenuOpen(false)
                        await logout()
                        navigate('/login', { replace: true })
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
                      role="menuitem"
                    >
                      <LogOut className="h-4 w-4" />
                      Logout
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
<div className="flex flex-col items-center gap-1 mt-2">
                    <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-base font-bold', tourism ? 'bg-[#087F3F] text-white' : 'bg-white/70 backdrop-blur-md border border-white/50 shadow-glass text-primary')}>
                      {getInitials(user?.name)}
                    </div>
                    {roleLabel === 'Rider' && (
                      <div className="flex items-center gap-0.5">
                        <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                        <span className="text-xs font-bold text-[#17201B]">{(user?.rider_rating ?? 5.00).toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                <div className="hidden sm:block">
                  <p className={cn('text-sm font-semibold', tourism ? 'text-[#17201B]' : 'text-ink')}>{user?.name}</p>
                  <p className={cn('text-xs', tourism ? 'text-[#68736D]' : 'text-ink-soft')}>{roleLabel}</p>
                </div>
              </>
            )}
          </div>
          )}
        </header>
        <main className={cn("min-h-0 flex-1 w-full overflow-x-hidden scrollbar-hide", location.pathname === '/rider/map' ? 'overflow-hidden' : 'overflow-y-auto')}>
          <div className={cn(
            'box-border w-full pt-3 px-4 sm:pt-4 lg:pt-4',
            bottomNavigation && 'max-w-[480px] mx-auto',
            bottomNavigation
              ? 'pb-[calc(96px+env(safe-area-inset-bottom))]'
              : 'pb-5 sm:pb-6 lg:pb-6'
          )}>
            <Suspense fallback={<div />}>
              <Outlet key={location.pathname + location.search} />
            </Suspense>
          </div>
        </main>
      </div>

      {bottomNavigation && roleLabel === 'Rider' && (
        <div className={cn(
          'fixed bottom-[80px] left-2 right-2 sm:left-4 sm:right-4 z-[1150] max-w-[480px] mx-auto flex transition-all duration-[1000ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]',
          riderOnline ? 'justify-start' : 'justify-center'
        )}>
          <button
            type="button"
            onClick={toggleRiderAvailability}
            className={cn(
              'group flex items-center gap-2 shadow-lg transition-all duration-[1000ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]',
              riderOnline
                ? 'h-12 w-12 justify-center rounded-full bg-[#16803C] text-white rider-circle-bounce'
                : 'h-11 sm:h-12 rounded-full bg-[#17201B] px-4 sm:px-5 text-xs sm:text-sm font-semibold text-white border border-[#17201B] hover:bg-black'
            )}
          >
            {riderOnline && (
              <>
                <span className="online-pulse-ring" aria-hidden="true" />
                <span className="online-pulse-ring online-pulse-ring-delayed" aria-hidden="true" />
              </>
            )}
            <Power className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 relative z-10 text-white" />
            {!riderOnline && <span>Go Online</span>}
            {riderOnline && (
              <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-[#17201B] px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
                Go Offline
              </span>
            )}
          </button>
        </div>
      )}
      {bottomNavigation && (
        <nav className={cn(
          'fixed bottom-0 left-0 right-0 z-[1100] box-border h-[64px] sm:h-[72px] w-full rounded-none border-x-0 border-b-0 px-2 pt-2 pb-[env(safe-area-inset-bottom)] shadow-2xl',
          'bg-[#16803C]/95 border-[#126B32] backdrop-blur-md'
        )}>
          <div className="relative mx-auto grid h-full w-full max-w-[480px] grid-cols-5 items-stretch">
          {navigationItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex min-w-0 flex-col items-center justify-center gap-0.5 sm:gap-1 rounded-xl px-1 sm:px-2 py-1.5 sm:py-2 text-[10px] sm:text-[11px] font-medium whitespace-nowrap',
                isActive(item.to)
                  ? 'bg-white/20 text-white'
                  : 'text-white hover:bg-white/10'
              )}
            >
              {item.icon && <span className="w-4 h-4 sm:w-5 sm:h-5">{item.icon}</span>}
              <span>{item.label}</span>
            </Link>
          ))}
          </div>
        </nav>
      )}
      {bottomNavigation && roleLabel === 'Rider' && (
        <div className="fixed top-3 right-3 z-[1200] flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setProfileMenuOpen((open) => !open)}
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
          >
            <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-base font-bold', tourism ? 'bg-[#087F3F] text-white' : 'bg-white/70 backdrop-blur-md border border-white/50 shadow-glass text-primary')}>
              {getInitials(user?.name)}
            </div>
          </button>
          <div className="flex items-center gap-1 bg-[#E9F7EF] rounded-full px-2 py-0.5">
            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            <span className="text-[10px] font-bold text-[#087F3F]">{(user?.rider_rating ?? 5.00).toFixed(2)}</span>
          </div>
          {profileMenuOpen && (
            <div role="menu" className="absolute right-0 top-full z-[1300] mt-2 w-44 overflow-hidden rounded-xl border border-[#E5E9E7] bg-white py-1 shadow-xl">
              <Link to={profilePath} onClick={() => setProfileMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#17201B] transition hover:bg-[#F3F8F4]" role="menuitem">
                <User className="h-4 w-4 text-[#087F3F]" />
                Profile
              </Link>
              <Link to="/rider/settings" onClick={() => setProfileMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#17201B] transition hover:bg-[#F3F8F4]" role="menuitem">
                <Settings className="h-4 w-4 text-[#087F3F]" />
                Settings
              </Link>
              <button
                type="button"
                onClick={async () => {
                  setProfileMenuOpen(false)
                  await logout()
                  navigate('/login', { replace: true })
                }}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
                role="menuitem"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
