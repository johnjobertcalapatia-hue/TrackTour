import { Suspense, useContext, useState, useEffect, useCallback, useRef, cloneElement, isValidElement, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, Outlet } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { patch, post } from '@/shared/services/api'
import { Skeleton } from '@/shared/components/Skeleton'
import RiderOrderInfoSheet from '@/features/rider/components/RiderOrderInfoSheet'
import { RiderActiveTripContext } from '@/features/rider/context/RiderActiveTripContext'
import type { User as AppUser } from '@/shared/types'
import { cn, getInitials, toAssetUrl } from '@/shared/utils'
import { ChevronLeft, ChevronRight, ChevronDown, LogOut, Power, User, Settings, Star, Layers, MapPin, Activity, Zap, Bike, UtensilsCrossed, Check } from 'lucide-react'

const bottomPanelActions = [
  { label: 'Service Types', icon: Layers },
  { label: 'My Destination', icon: MapPin },
  { label: 'Diagnostics', icon: Activity },
] as const

// Cadence for the MySQL rider-location heartbeat (see the effect below).
// MUST stay well under `delivery.cod_location_max_age_minutes` (5 min) — the
// gate whose violation is logged as `gps_stale` and silently excludes a rider
// from every COD dispatch wave.
const RIDER_LOCATION_HEARTBEAT_MS = 60_000

// Rider-selectable service types. The value is persisted to
// rider_details.current_service, which is the column NearestRiderService
// filters candidates on — so picking one directly decides whether this rider
// is offered food-delivery or ride-hailing pings.
const serviceOptions = [
  { value: 'food' as const, label: 'Food Delivery', description: 'Receive food delivery pings', icon: UtensilsCrossed },
  { value: 'transport' as const, label: 'Ride Hailing', description: 'Receive ride hailing pings', icon: Bike },
] as const

const autoAcceptAction = { label: 'Auto accept', icon: Zap } as const

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
  bottomPanelSlot?: ReactNode
}

export default function DashboardLayout({ navItems, roleLabel, sections, sidebarTopSlot, theme = 'default', profilePath, preferExpanded = false, bottomNavigation = false, bottomPanelSlot }: DashboardLayoutProps) {
  const tourism = theme === 'tourism'
  const admin = theme === 'admin'
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const fetchUser = useAuthStore((s) => s.fetchUser)
  const logout = useAuthStore((s) => s.logout)
  // null whenever this layout is rendered outside the /rider routes — every
  // trip flag below therefore stays inert for the other roles.
  const riderTrip = useContext(RiderActiveTripContext)
  const location = useLocation()
  const navigate = useNavigate()
  // Rider Settings (/rider/settings) is its own full content page, so the
  // floating rider chrome — the Go Online/Go Offline button + status panel and
  // the profile avatar/rating — is not rendered there instead of overlapping it.
  const riderSettingsPage = bottomNavigation && location.pathname === '/rider/settings'
  const [collapsed, setCollapsed] = useState(() => {
    if (preferExpanded && window.innerWidth >= 1024) return false
    const saved = localStorage.getItem('sidebar_collapsed')
    if (saved !== null) return saved === 'true'
    return window.innerWidth < 1024
  })

  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({})
  const [riderOnline, setRiderOnline] = useState(() => user?.rider_status === 'online' || user?.rider_status === 'available' || user?.rider_status === 'busy')
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [serviceMenuOpen, setServiceMenuOpen] = useState(false)
  const [serviceSwitching, setServiceSwitching] = useState(false)
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [autoAcceptSaving, setAutoAcceptSaving] = useState(false)
  const [autoAcceptError, setAutoAcceptError] = useState<string | null>(null)
  const serviceMenuRef = useRef<HTMLDivElement | null>(null)
  // Server-owned rider preference (rider_details.auto_accept). While it is on,
  // the rider's device accepts the first ping it receives — see
  // RiderDispatchNotification.
  const autoAcceptEnabled = Boolean(user?.auto_accept)
  const queryClient = useQueryClient()
  useEffect(() => {
    if (roleLabel === 'Rider' && user?.rider_status) {
      setRiderOnline(user.rider_status === 'online' || user.rider_status === 'available' || user.rider_status === 'busy')
    }
  }, [roleLabel, user?.rider_status])

  // The floating go-online chrome must mirror the AUTHORITATIVE trip state, not
  // just the rider_status flag. A rider bound to a live delivery (or a
  // delivered-but-unsettled COD) is mid-trip — exactly what the backend toggle
  // guard rejects with 409 — so the button shows "On a trip", never a grey
  // "Go Online", and cannot fire a toggle that is guaranteed to fail.
  const riderInTrip = Boolean(riderTrip?.activeDelivery) || Boolean(riderTrip?.pendingSettlement)
  const inTrip = riderInTrip || user?.rider_status === 'busy'
  const effectivelyOnline = riderOnline || inTrip

  // Keep MySQL `rider_locations.recorded_at` fresh while the rider is online.
  //
  // COD eligibility drops a rider whose latest fix is older than
  // `delivery.cod_location_max_age_minutes` (5 min) — logged as `gps_stale`.
  // The only other MySQL writer is RiderMap's `watchPosition`, which (a) runs
  // only while /rider/map is mounted and (b) never fires for a rider who is
  // sitting still. Socket telemetry is explicitly zero-DB-write, so it cannot
  // help here either. Without this heartbeat an online-but-idle rider aged out
  // of the primary COD query after 5 minutes and never received an offer.
  useEffect(() => {
    if (roleLabel !== 'Rider' || !riderOnline) return
    if (!navigator.geolocation) return

    const beat = () =>
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void post('/rider/map/location', {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }).catch(() => undefined)
        },
        // A rider without a fix simply stays eligible-until-stale; never log-spam.
        () => undefined,
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
      )

    beat()
    const id = window.setInterval(beat, RIDER_LOCATION_HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [roleLabel, riderOnline])

  // Auto-dismiss the availability conflict message so it never gets stuck.
  useEffect(() => {
    if (!toggleError) return
    const timer = setTimeout(() => setToggleError(null), 6000)
    return () => clearTimeout(timer)
  }, [toggleError])

  useEffect(() => {
    if (!serviceError) return
    const timer = setTimeout(() => setServiceError(null), 6000)
    return () => clearTimeout(timer)
  }, [serviceError])

  useEffect(() => {
    if (!autoAcceptError) return
    const timer = setTimeout(() => setAutoAcceptError(null), 6000)
    return () => clearTimeout(timer)
  }, [autoAcceptError])

  useEffect(() => {
    setProfileMenuOpen(false)
    setServiceMenuOpen(false)
  }, [location.pathname])

  // Close the Service Types dropdown on outside click or Escape.
  useEffect(() => {
    if (!serviceMenuOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (serviceMenuRef.current && !serviceMenuRef.current.contains(event.target as Node)) {
        setServiceMenuOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setServiceMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [serviceMenuOpen])

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

  // Switch the rider's service type. rider_details.current_service is what
  // NearestRiderService filters dispatch candidates on, so this is what makes
  // the rider receive (or stop receiving) each kind of ping.
  const switchService = async (service: AppUser['current_service']) => {
    if (serviceSwitching) return
    if (user?.current_service === service) {
      setServiceMenuOpen(false)
      return
    }

    setServiceSwitching(true)
    setServiceError(null)

    try {
      await post<{ current_service?: AppUser['current_service'] }>('/rider/service', { service })
      // The backend owns the rules (409 = busy or a request is pending), so
      // reconcile the store from it rather than optimistically flipping state.
      const currentUser = useAuthStore.getState().user
      if (currentUser) {
        setUser({ ...currentUser, current_service: service })
      }
      void queryClient.invalidateQueries({ queryKey: ['rider-profile'] })
      setServiceMenuOpen(false)
    } catch (error) {
      const err = error as { response?: { data?: { message?: string } } }
      setServiceError(err.response?.data?.message || 'Failed to switch service type.')
    } finally {
      setServiceSwitching(false)
    }
  }

  // Persist the Auto accept preference (rider_details.auto_accept). This call
  // only flips the flag — the actual accepting happens in
  // RiderDispatchNotification through the canonical atomic accept endpoint.
  const toggleAutoAccept = async () => {
    if (autoAcceptSaving) return
    const next = !autoAcceptEnabled

    setAutoAcceptSaving(true)
    setAutoAcceptError(null)

    try {
      const response = await patch<{ auto_accept?: boolean }>(
        '/rider/auto-accept',
        { auto_accept: next },
        // Generous 30s timeout, mirroring toggleRiderAvailability: `php artisan
        // serve` processes one request at a time while the rider app polls
        // offers every 4s and posts GPS — aborting on axios' 10s default
        // produced a false "Failed to update auto accept" even though the
        // write had landed.
        { timeout: 30000 }
      )
      // Adopt the value the server actually stored rather than assuming the
      // optimistic flip succeeded.
      const confirmed = Boolean(response?.auto_accept ?? next)
      const currentUser = useAuthStore.getState().user
      if (currentUser) {
        setUser({ ...currentUser, auto_accept: confirmed })
      }
      void queryClient.invalidateQueries({ queryKey: ['rider-profile'] })
    } catch (error) {
      const err = error as { code?: string; response?: { status?: number; data?: { message?: string } } }
      // No `response` means the request never completed (timeout / dropped
      // connection) — the server may still have applied it, so reconcile from
      // /api/user instead of claiming the write failed outright.
      if (!err.response) {
        setAutoAcceptError('The server took too long to respond — tap again if it did not change.')
      } else {
        setAutoAcceptError(err.response.data?.message || 'Failed to update auto accept.')
      }
      void fetchUser()
    } finally {
      setAutoAcceptSaving(false)
    }
  }

  const toggleRiderAvailability = async () => {
    // In-flight guard: this endpoint is a non-idempotent toggle, so duplicate
    // clicks must not fire overlapping requests.
    if (toggling) return
    setToggling(true)
    setToggleError(null)

    // Optimistic flip — apply the intended state at TAP time so the screen
    // reacts immediately instead of waiting out the round trip. The dev server
    // handles one request at a time (php -S, single worker) while this app is
    // constantly polling (dispatch offers every 4s, GPS posts, map location),
    // so a click can otherwise sit behind that queue for seconds before
    // anything moves on screen.
    const currentUser = user
    const previousStatus = currentUser?.rider_status
    const previousOnline = riderOnline
    const nextOnline = !previousOnline
    // A rider mid-delivery is rejected by the backend with 409, so flipping
    // here would only flash a wrong state before reverting — send it as-is
    // and let the server's own message surface instead.
    const optimistic = previousStatus !== 'busy'

    if (optimistic) {
      setRiderOnline(nextOnline)
      if (currentUser) {
        setUser({ ...currentUser, rider_status: nextOnline ? 'available' : 'offline' })
      }
      // Land on the map straight away — but ONLY when not already on it.
      // A navigate() to the path you are already standing on pushes a duplicate
      // history entry, and any path change re-keys the <Outlet> below (its key
      // is `pathname + search`), which unmounts the whole page and empties the
      // content area while the lazy map chunk suspends. DashboardLayout itself
      // stays mounted across /rider/* (it renders the Outlet), so the conflict
      // banner still shows if the server later rejects this toggle.
      if (location.pathname !== '/rider/map') navigate('/rider/map')
      if (nextOnline) {
        window.dispatchEvent(new Event('rider-go-online'))
      }
    }

    try {
      // Success: adopt the server-returned rider_status verbatim — never infer
      // it. Generous 30s timeout as a safety margin: the toggle is a single
      // MySQL write, but a slow dev server must never abort mid-flight.
      const response = await post<{ rider_status?: string }>('/rider/availability/toggle', undefined, {
        timeout: 30000,
      })
      // The server reply is authoritative and overrides the optimistic guess.
      const riderStatus = response?.rider_status
      const online = riderStatus === 'online' || riderStatus === 'available'
      if (currentUser) {
        setUser({ ...currentUser, rider_status: riderStatus as AppUser['rider_status'] })
      }
      setRiderOnline(online)
      if (!optimistic && location.pathname !== '/rider/map') {
        // Busy path never flipped above, so navigation still has to happen —
        // same guard: never re-navigate onto the page we are already showing.
        navigate('/rider/map')
      }
      if (online) {
        // Re-fired deliberately: the optimistic event went out before
        // RiderMap mounted, so its listener may not have been registered yet.
        window.dispatchEvent(new Event('rider-go-online'))
      }
    } catch (error) {
      // The backend owns the availability rules (409 = genuinely on a delivery).
      // Surface ITS message and reconcile the store from the server instead of
      // guessing the state — fetchUser() is the single source of truth.
      const err = error as {
        code?: string
        response?: { status?: number; data?: unknown }
      }
      // Diagnose instead of collapsing every failure into one vague string.
      // "Never reached the server", "server answered with a non-JSON body"
      // (dead tunnel / proxy error page) and "a real API error" are three
      // different problems — previously all three rendered the same message,
      // which made this unreportable.
      const body = err.response?.data
      const apiMessage =
        typeof body === 'object' && body !== null ? (body as { message?: string }).message : undefined
      setToggleError(
        !err.response
          ? err.code === 'ECONNABORTED'
            ? 'The server took too long to respond — tap again if it did not change.'
            : 'Could not reach the server — check that the API dev server is running on port 8000, then tap again.'
          : apiMessage ||
              `The server replied ${err.response.status} without a message — the request never reached the application.`
      )
      if (optimistic) {
        // Roll back the guess immediately, then let fetchUser() overwrite it
        // with whatever the server actually stored (a timed-out request may
        // still have committed).
        setRiderOnline(previousOnline)
        if (currentUser && previousStatus !== undefined) {
          setUser({ ...currentUser, rider_status: previousStatus })
        }
      }
      void fetchUser()
    } finally {
      setToggling(false)
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
              <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 overflow-hidden', admin ? 'bg-[#087F3F] text-white' : tourism ? 'bg-[#087F3F] text-white' : 'bg-white/70 backdrop-blur-md border border-white/50 text-primary')}>
                {toAssetUrl(user?.profile_photo) ? (
                  <img src={toAssetUrl(user?.profile_photo)} alt={user?.name} className="w-full h-full object-cover" />
                ) : (
                  getInitials(user?.name)
                )}
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
          'relative z-40 h-16 shrink-0 flex items-center w-full px-4 sm:px-6 gap-4',
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
                      <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-base font-bold overflow-hidden', tourism ? 'bg-[#087F3F] text-white' : 'bg-white/70 backdrop-blur-md border border-white/50 shadow-glass text-primary')}>
                        {toAssetUrl(user?.profile_photo) ? (
                          <img src={toAssetUrl(user?.profile_photo)} alt={user?.name} className="w-full h-full object-cover" />
                        ) : (
                          getInitials(user?.name)
                        )}
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
                    <Link to={profilePath ?? '/rider/profile'} onClick={() => setProfileMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#17201B] transition hover:bg-[#F3F8F4]" role="menuitem">
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
                    <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-base font-bold overflow-hidden', tourism ? 'bg-[#087F3F] text-white' : 'bg-white/70 backdrop-blur-md border border-white/50 shadow-glass text-primary')}>
        {toAssetUrl(user?.profile_photo) ? (
          <img src={toAssetUrl(user?.profile_photo)} alt={user?.name} className="w-full h-full object-cover" />
        ) : (
          getInitials(user?.name)
        )}
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
        <main className={cn(
          "min-h-0 flex-1 w-full overflow-x-hidden scrollbar-hide",
          location.pathname === '/rider/map' ? 'overflow-hidden' : 'overflow-y-auto'
        )}>
          <div className={cn(
            'box-border w-full pt-3 px-4 sm:pt-4 lg:pt-4',
            bottomNavigation && !riderSettingsPage && 'max-w-[480px] mx-auto',
            riderSettingsPage
              ? 'pb-6 sm:pb-8'
              : bottomNavigation
                ? 'pb-24'
                : 'pb-5 sm:pb-6 lg:pb-6'
          )}>
            <Suspense
              fallback={
                // Deliberately not `<div />`: the keyed Outlet below unmounts
                // the outgoing page the instant the path changes, so an empty
                // fallback makes the whole content area go blank while the lazy
                // route chunk loads — which reads as "the page just refreshed".
                <div className="space-y-4" role="status" aria-label="Loading page">
                  <Skeleton className="h-7 w-44" />
                  <Skeleton className="h-[55vh] w-full rounded-[24px]" />
                </div>
              }
            >
              <Outlet key={location.pathname + location.search} />
            </Suspense>
          </div>
        </main>
      </div>

      {bottomNavigation && !riderSettingsPage && (
        <div className={cn(
          'fixed bottom-6 left-2 right-2 sm:left-4 sm:right-4 z-[1150] max-w-[480px] mx-auto flex flex-col gap-3 transition-all duration-[1000ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]'
        )}>
          {toggleError && (
            <div role="alert" className="absolute -top-14 left-1/2 -translate-x-1/2 max-w-[90vw] rounded-lg bg-[#B3261E] px-4 py-2.5 text-xs font-medium text-white shadow-lg">
              {toggleError}
            </div>
          )}
          <div className={cn('flex w-full', effectivelyOnline ? 'justify-start' : 'justify-center')}>
            <button
              type="button"
              onClick={toggleRiderAvailability}
              disabled={toggling || inTrip}
              aria-busy={toggling}
              className={cn(
                'group flex items-center gap-2 shadow-lg transition-all duration-[1000ms] ease-[cubic-bezier(0.25,0.1,0.25,1)] disabled:cursor-wait disabled:opacity-60',
                effectivelyOnline
                  ? 'h-12 w-12 justify-center rounded-full bg-[#16803C] text-white rider-circle-bounce'
                  : 'h-11 sm:h-12 rounded-full bg-[#17201B] px-4 sm:px-5 text-xs sm:text-sm font-semibold text-white border border-[#17201B] hover:bg-black'
              )}
            >
              {effectivelyOnline && (
                <>
                  <span className="online-pulse-ring" aria-hidden="true" />
                  <span className="online-pulse-ring online-pulse-ring-delayed" aria-hidden="true" />
                </>
              )}
              <Power className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 relative z-10 text-white" />
              {!effectivelyOnline && <span>Go Online</span>}
              {effectivelyOnline && (
                <span className="pointer-events-none absolute left-full ml-3 whitespace-nowrap rounded-lg bg-[#17201B] px-3 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
                  {inTrip ? 'On a trip — complete the delivery to go offline' : 'Go Offline'}
                </span>
              )}
            </button>
          </div>
          {/* Rider status readout — mirrors the button: it follows the online
              state (server-confirmed via toggleRiderAvailability) AND the
              authoritative trip state, so a mid-trip rider reads "On a trip",
              never a misleading grey offline panel. */}
          <div
            role="status"
            aria-live="polite"
            aria-busy={toggling}
            className={cn(
              'flex w-full items-center justify-between gap-3 rounded-2xl border p-4 shadow-lg backdrop-blur-md transition-all duration-[1000ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]',
              effectivelyOnline
                ? 'border-[#16803C] bg-[#16803C] text-white'
                : 'border-[#E5E9E7] bg-white/95 text-[#6B7280]'
            )}
          >
            <span className="text-xs font-semibold uppercase tracking-wide">
              Rider Status
            </span>
            <span className="flex items-center gap-2 text-sm font-bold">
              <span
                aria-hidden="true"
                className={cn(
                  'h-2.5 w-2.5 rounded-full transition-colors duration-[1000ms]',
                  // animate-pulse is the fade: the dot breathes between full and
                  // ~30% opacity in BOTH states — white while online, gray while
                  // offline.
                  effectivelyOnline ? 'bg-white animate-pulse' : 'bg-[#9CA3AF] animate-pulse'
                )}
              />
              {/* Tracks effectivelyOnline directly: the toggle flips that
                  optimistically at tap time, so withholding the label for the
                  round trip would just re-hide the state we chose to show early. */}
              {inTrip ? 'On a trip' : effectivelyOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <div
            ref={serviceMenuRef}
            role="region"
            aria-label="Rider quick actions"
            className="relative w-full min-h-[10vh] rounded-2xl border border-[#E5E9E7] bg-white/95 backdrop-blur-md p-4 shadow-lg"
          >
            {serviceMenuOpen && (
              <div
                role="dialog"
                aria-label="Choose service type"
                className="rider-auto-accept-slide absolute bottom-full left-0 right-0 z-[10] mb-2 rounded-2xl border border-[#E5E9E7] bg-white p-3 shadow-xl"
              >
                <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-[#6B7280]">Service Types</p>
                <div className="grid grid-cols-2 gap-2">
                  {serviceOptions.map((option) => {
                    const selected = user?.current_service === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => void switchService(option.value)}
                        disabled={serviceSwitching}
                        aria-pressed={selected}
                        className={cn(
                          'flex flex-col items-start gap-1.5 rounded-xl border p-3 text-left transition disabled:cursor-wait disabled:opacity-60',
                          selected
                            ? 'border-emerald-500/60 bg-emerald-500/10'
                            : 'border-[#E5E9E7] bg-[#F3F8F5] hover:border-emerald-500/40 hover:bg-emerald-500/10'
                        )}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#087F3F] shadow-sm">
                          <option.icon className="h-5 w-5" />
                        </span>
                        <span className="flex w-full items-center justify-between gap-1">
                          <span className="text-sm font-semibold text-[#17201B]">{option.label}</span>
                          {selected && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                        </span>
                        <span className="text-[11px] leading-snug text-[#6B7280]">{option.description}</span>
                      </button>
                    )
                  })}
                </div>
                {serviceError && (
                  <p role="alert" className="mt-2 px-1 text-xs font-medium text-[#B3261E]">{serviceError}</p>
                )}
              </div>
            )}
            <div className={cn('grid gap-2', effectivelyOnline ? 'grid-cols-4' : 'grid-cols-3')}>
              {bottomPanelActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    if (action.label === 'Service Types') {
                      // Toggle: click once to reveal the two service-type choices,
                      // click again to hide them.
                      setServiceMenuOpen((open) => !open)
                    } else {
                      // Every other panel button dismisses the open choices.
                      setServiceMenuOpen(false)
                    }
                  }}
                  aria-expanded={action.label === 'Service Types' ? serviceMenuOpen : undefined}
                  className={cn(
                    'flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center transition',
                    action.label === 'Service Types' && serviceMenuOpen
                      ? 'border-emerald-500/60 bg-emerald-500/15'
                      : 'border-[#E5E9E7] bg-[#F3F8F5] hover:border-emerald-500/40 hover:bg-emerald-500/10'
                  )}
                >
                  <action.icon className="h-5 w-5 text-[#087F3F]" />
                  <span className="text-[11px] font-semibold leading-tight text-[#17201B]">{action.label}</span>
                </button>
              ))}
              {effectivelyOnline && (
                <button
                  type="button"
                  onClick={() => {
                    setServiceMenuOpen(false)
                    void toggleAutoAccept()
                  }}
                  disabled={autoAcceptSaving}
                  aria-pressed={autoAcceptEnabled}
                  aria-busy={autoAcceptSaving}
                  title={autoAcceptEnabled ? 'Auto accept is ON — the first ping is accepted automatically.' : 'Auto accept is OFF — tap to accept every ping automatically.'}
                  className={cn(
                    'rider-auto-accept-slide flex flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center transition disabled:cursor-wait disabled:opacity-60',
                    autoAcceptEnabled
                      ? 'border-[#16803C] bg-[#16803C] shadow-lg hover:bg-[#126B32] hover:border-[#126B32]'
                      : 'border-[#E5E9E7] bg-[#F3F8F5] hover:border-emerald-500/40 hover:bg-emerald-500/10'
                  )}
                >
                  <autoAcceptAction.icon className={cn('h-5 w-5', autoAcceptEnabled ? 'text-amber-400' : 'text-[#087F3F]')} />
                  <span className={cn(
                    'text-[11px] font-semibold leading-tight',
                    autoAcceptEnabled ? 'text-white' : 'text-[#17201B]'
                  )}>
                    Auto accept
                  </span>
                  <span className={cn(
                    'text-[10px] font-bold uppercase tracking-wider leading-none',
                    autoAcceptEnabled ? 'text-white' : 'text-[#9CA3AF]'
                  )}>
                    {autoAcceptSaving ? '…' : autoAcceptEnabled ? 'On' : 'Off'}
                  </span>
                </button>
              )}
            </div>
            {autoAcceptError && (
              <p role="alert" className="mt-2 px-1 text-xs font-medium text-[#B3261E]">{autoAcceptError}</p>
            )}
            {bottomPanelSlot}
          </div>
          <RiderOrderInfoSheet />
        </div>
      )}
      {bottomNavigation && roleLabel === 'Rider' && !riderSettingsPage && (
        <div className="fixed top-3 right-3 z-[1200] flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={() => setProfileMenuOpen((open) => !open)}
            aria-expanded={profileMenuOpen}
            aria-haspopup="menu"
          >
            <div className={cn('w-11 h-11 rounded-full flex items-center justify-center text-base font-bold overflow-hidden', tourism ? 'bg-[#087F3F] text-white' : 'bg-white/70 backdrop-blur-md border border-white/50 shadow-glass text-primary')}>
              {toAssetUrl(user?.profile_photo) ? (
                <img src={toAssetUrl(user?.profile_photo)} alt={user?.name} className="w-full h-full object-cover" />
              ) : (
                getInitials(user?.name)
              )}
            </div>
          </button>
          <div className="flex items-center gap-1 bg-[#E9F7EF] rounded-full px-2 py-0.5">
            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            <span className="text-[10px] font-bold text-[#087F3F]">{(user?.rider_rating ?? 5.00).toFixed(2)}</span>
          </div>
          {profileMenuOpen && (
            <div role="menu" className="absolute right-0 top-full z-[1300] mt-2 w-44 overflow-hidden rounded-xl border border-[#E5E9E7] bg-white py-1 shadow-xl">
              <Link to={profilePath ?? '/rider/profile'} onClick={() => setProfileMenuOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#17201B] transition hover:bg-[#F3F8F4]" role="menuitem">
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
