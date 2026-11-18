import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Bell, Bike, Building2, CircleAlert, ClipboardCheck, FileBarChart, HandCoins, IdCard, LayoutDashboard, LogOut, Map,
  MapPin, Menu, Package, ScrollText, Settings, Users, Wallet, X, type LucideIcon,
} from 'lucide-react'
import { get } from '@/shared/services/api'
import { API_ENDPOINTS } from '@/shared/constants'
import { Skeleton } from '@/shared/components/Skeleton'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { useOfficeProfile } from '@/features/admin/hooks/use-office-profile'
import { cn, toAssetUrl } from '@/shared/utils'
import { POPPINS } from '@/features/municipal/theme'

interface NavEntry {
  to: string
  label: string
  icon: LucideIcon
  badge?: number
  /** Path prefixes that make this entry active (defaults to NavLink matching). */
  match?: string[]
}

interface DashboardStats {
  stats: { pending_verifications: number; pending_review: number; total_municipalities: number }
}

/**
 * Shell of the Bansud Tourism Office (super admin) portal. Same visual
 * identity as the Municipal portal — dark forest-green sidebar with Banana
 * Gold accents, warm white workspace, Poppins — with the TrackTour mark in the
 * sidebar header and the full admin navigation.
 */
export default function AdminLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const { data: office } = useOfficeProfile()
  const { data: dashboard } = useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: () => get<DashboardStats>(API_ENDPOINTS.ADMIN.DASHBOARD),
    staleTime: 60_000,
  })

  useEffect(() => {
    setDrawerOpen(false)
    setMenuOpen(false)
  }, [location.pathname])

  const stats = dashboard?.stats
  // Tourism-focused navigation. Related screens live as tabs inside their
  // module (Users → Tourists, Businesses → Categories, Municipalities →
  // Accounts, Settings → Access Control / Document Verification / …).
  const sections: { label?: string; items: NavEntry[] }[] = [
    { label: 'Overview', items: [{ to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
    {
      label: 'Live operations',
      items: [
        { to: '/admin/live/map', label: 'Live Map', icon: Map },
        { to: '/admin/live/deliveries', label: 'Deliveries', icon: Package },
        { to: '/admin/rider-cash', label: 'Rider Cash', icon: Wallet },
        { to: '/admin/live/sos', label: 'SOS Alerts', icon: CircleAlert },
      ],
    },
    {
      label: 'Tourism management',
      items: [
        { to: '/admin/businesses', label: 'Businesses', icon: Building2 },
        { to: '/admin/users', label: 'Users', icon: Users, badge: stats?.pending_verifications },
        { to: '/admin/riders', label: 'Riders', icon: Bike },
        { to: '/admin/rider-onboarding', label: 'Rider Onboarding', icon: ClipboardCheck },
        { to: '/admin/cashouts', label: 'Cashouts', icon: HandCoins },
      ],
    },
    {
      label: 'Municipality management',
      items: [{ to: '/admin/municipalities', label: 'Municipalities', icon: MapPin }],
    },
    {
      label: 'Records & analytics',
      items: [
        { to: '/admin/reports', label: 'Reports', icon: FileBarChart },
        { to: '/admin/audit-logs', label: 'Audit Logs', icon: ScrollText },
        { to: '/admin/notifications', label: 'Notifications', icon: Bell },
      ],
    },
    {
      label: 'System',
      items: [
        { to: '/admin/profile', label: 'Office Profile', icon: IdCard },
        // One entry: Security, Backup, Diagnostics and Incident History are tabs inside Settings.
        // /admin/settings opens Platform Configuration; the link stays current on every tab.
        { to: '/admin/settings', label: 'Settings', icon: Settings },
      ],
    },
  ]
  const isActiveEntry = (item: NavEntry, navActive: boolean) => (item.match ? item.match.some((m) => location.pathname.startsWith(m)) : navActive)

  const officeName = office?.name || 'Bansud Tourism Office'
  const displayName = user?.name || officeName
  const avatar = office?.logo_url ?? null
  const today = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

  const handleLogout = async () => {
    setMenuOpen(false)
    await logout()
    navigate('/login', { replace: true })
  }

  const sidebar: ReactNode = (
    <div className="flex h-full flex-col bg-[#0F2E1D] text-white">
      <div className="px-5 pt-6 pb-5 border-b border-white/10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#FFD700]">TrackTour · Tourism Admin</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl bg-white ring-2 ring-[#FFD700]/70 overflow-hidden flex items-center justify-center shrink-0 p-1">
            <img src="/assets/logo/tracktour.png" alt="TrackTour Logo" className="w-full h-full object-contain" />
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold leading-tight truncate">Bansud</span>
            <span className="block text-xs text-white/60 truncate">{officeName}</span>
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Admin navigation">
        {sections.map((section, i) => (
          <div key={i}>
            {section.label && (
              <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">{section.label}</p>
            )}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive: navActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                        isActiveEntry(item, navActive) ? 'bg-[#18402A] text-white font-semibold' : 'text-white/75 hover:bg-[#18402A] hover:text-white'
                      )
                    }
                  >
                    {({ isActive: navActive }) => {
                      const isActive = isActiveEntry(item, navActive)
                      return (
                      <>
                        {isActive && <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r bg-[#FFD700]" aria-hidden="true" />}
                        <item.icon className={cn('w-[18px] h-[18px]', isActive ? 'text-[#FFD700]' : 'text-white/60 group-hover:text-white')} aria-hidden="true" />
                        <span className="flex-1">{item.label}</span>
                        {!!item.badge && (
                          <span className="min-w-5 h-5 px-1.5 rounded-full bg-[#FFD700] text-[#5C4A00] text-[11px] font-bold flex items-center justify-center" aria-label={`${item.badge} waiting`}>
                            {item.badge}
                          </span>
                        )}
                      </>
                      )
                    }}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-white/10 text-xs text-white/50">
        Home of TrackTour · overseeing{' '}
        <span className="text-white/80 font-medium">{stats ? `${stats.total_municipalities} municipalities` : 'all municipalities'}</span>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#FAF7F0] text-[#1C2B22]" style={POPPINS}>
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-64 z-30">{sidebar}</aside>

      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-[1200]">
          <button type="button" aria-label="Close menu" className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 shadow-xl">
            {sidebar}
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setDrawerOpen(false)}
              className="absolute top-4 right-3 p-1.5 rounded-lg text-white/70 hover:bg-white/10"
            >
              <X className="w-5 h-5" />
            </button>
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 bg-[#FAF7F0]/90 backdrop-blur border-b border-[#E7E2D6]">
          <div className="flex items-center gap-3 px-4 sm:px-6 lg:px-8 h-16">
            <button
              type="button"
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-[#1C2B22] hover:bg-[#E6F2EB]"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold truncate">{officeName}</p>
              <p className="text-xs text-[#66736B] truncate">{today}</p>
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 hover:bg-[#E6F2EB]"
              >
                <span className="w-8 h-8 rounded-full bg-[#2E8B57] text-white text-sm font-semibold flex items-center justify-center overflow-hidden">
                  {avatar ? <img src={toAssetUrl(avatar)} alt="" className="w-full h-full object-cover" /> : displayName.charAt(0).toUpperCase()}
                </span>
                <span className="hidden sm:block text-sm font-medium max-w-40 truncate">{displayName}</span>
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 mt-2 w-56 rounded-xl border border-[#E7E2D6] bg-white shadow-lg py-1 z-30">
                  <div className="px-4 py-2.5 border-b border-[#E7E2D6]">
                    <p className="text-sm font-medium truncate">{displayName}</p>
                    <p className="text-xs text-[#66736B] truncate">{user?.email}</p>
                  </div>
                  <NavLink to="/admin/profile" role="menuitem" className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[#FAF7F0]">
                    <IdCard className="w-4 h-4" /> Office Profile
                  </NavLink>
                  <button type="button" role="menuitem" onClick={handleLogout} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
                    <LogOut className="w-4 h-4" /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px]">
          <Suspense
            fallback={
              <div className="space-y-4" role="status" aria-label="Loading page">
                <Skeleton className="h-7 w-44" />
                <Skeleton className="h-[55vh] w-full rounded-2xl" />
              </div>
            }
          >
            <Outlet key={location.pathname + location.search} />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
