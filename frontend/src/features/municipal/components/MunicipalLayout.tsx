import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Activity, Bike, ClipboardCheck, FileBarChart, FileCheck2, LayoutDashboard, Landmark, LogOut, Menu, Settings, Store, UserCheck, Users, X,
  type LucideIcon,
  Percent,
} from 'lucide-react'
import { get } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { cn, toAssetUrl } from '@/shared/utils'
import { MUNICIPAL_API, type MunicipalDashboardData, type MunicipalProfile } from '@/features/municipal/types'
import { POPPINS } from '@/features/municipal/theme'

interface NavEntry {
  to: string
  label: string
  icon: LucideIcon
  badge?: number
}

/**
 * Shell of the Municipal Tourism Office portal: dark forest-green sidebar with
 * Banana Gold accents, warm white workspace, Poppins type. The municipality's
 * identity comes from its own office profile.
 */
export default function MunicipalLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const { data: profile } = useQuery({
    queryKey: ['municipal', 'profile'],
    queryFn: () => get<MunicipalProfile>(MUNICIPAL_API.PROFILE),
    staleTime: 5 * 60_000,
  })
  const { data: dashboard } = useQuery({
    queryKey: ['municipal', 'dashboard'],
    queryFn: () => get<MunicipalDashboardData>(MUNICIPAL_API.DASHBOARD),
    staleTime: 60_000,
  })

  useEffect(() => {
    setDrawerOpen(false)
    setMenuOpen(false)
  }, [location.pathname])

  const stats = dashboard?.stats
  const documentsWaiting = stats ? stats.documents.business_pending + stats.documents.riders_pending : undefined
  const sections: { label?: string; items: NavEntry[] }[] = [
    { items: [{ to: '/municipal/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
    {
      label: 'Local management',
      items: [
        { to: '/municipal/business-owners', label: 'Business Owners', icon: Users, badge: stats?.business_owners.pending },
        { to: '/municipal/businesses', label: 'Businesses', icon: Store, badge: stats?.businesses.pending },
        { to: '/municipal/riders', label: 'Riders', icon: Bike, badge: stats?.riders.pending },
        { to: '/municipal/onboarding', label: 'Rider Onboarding', icon: ClipboardCheck },
        { to: '/municipal/tourists', label: 'Tourists', icon: UserCheck },
      ],
    },
    {
      label: 'Records',
      items: [
        { to: '/municipal/documents', label: 'Documents', icon: FileCheck2, badge: documentsWaiting },
        { to: '/municipal/reports', label: 'Reports', icon: FileBarChart },
        { to: '/municipal/activity-logs', label: 'Activity Logs', icon: Activity },
      ],
    },
    // Earnings Stage 1 (2026-11-24): this town's own commission rates.
    { label: 'Finance', items: [{ to: '/municipal/commission-rates', label: 'Commission Rates', icon: Percent }] },
    { label: 'Office', items: [{ to: '/municipal/profile', label: 'Profile & Settings', icon: Settings }] },
  ]

  const municipalityName = profile?.municipality.name ?? dashboard?.municipality.name ?? 'Municipality'
  const officeName = profile?.office_name ?? `${municipalityName} Tourism Office`
  const logo = profile?.logo_url ?? dashboard?.municipality.logo ?? null
  const displayName = profile?.account.name ?? user?.name ?? 'Tourism Officer'
  const today = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())

  const handleLogout = async () => {
    setMenuOpen(false)
    await logout()
    navigate('/login', { replace: true })
  }

  const sidebar: ReactNode = (
    <div className="flex h-full flex-col bg-[#0F2E1D] text-white">
      <div className="px-5 pt-6 pb-5 border-b border-white/10">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#FFD700]">TrackTour · Municipal Portal</p>
        <div className="mt-3 flex items-center gap-3">
          <span className="w-11 h-11 rounded-xl bg-white/10 ring-2 ring-[#FFD700]/70 overflow-hidden flex items-center justify-center shrink-0">
            {logo ? (
              <img src={toAssetUrl(logo)} alt="" className="w-full h-full object-cover" />
            ) : (
              <Landmark className="w-5 h-5 text-[#FFD700]" aria-hidden="true" />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-base font-semibold leading-tight truncate">{municipalityName}</span>
            <span className="block text-xs text-white/60 truncate">{officeName}</span>
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5" aria-label="Municipal navigation">
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
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                        isActive ? 'bg-[#18402A] text-white font-semibold' : 'text-white/75 hover:bg-[#18402A] hover:text-white'
                      )
                    }
                  >
                    {({ isActive }) => (
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
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-white/10 text-xs text-white/50">
        Under the supervision of the <span className="text-white/80 font-medium">Bansud Tourism Office</span>
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
        {/* z-40: above the pages' own sticky bars (z-20, e.g. Office Profile's Save changes),
            so the account menu that opens from this header is never covered. */}
        <header className="sticky top-0 z-40 bg-[#FAF7F0]/90 backdrop-blur border-b border-[#E7E2D6]">
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
                <span className="w-8 h-8 rounded-full bg-[#2E8B57] text-white text-sm font-semibold flex items-center justify-center">
                  {displayName.charAt(0).toUpperCase()}
                </span>
                <span className="hidden sm:block text-sm font-medium max-w-40 truncate">{displayName}</span>
              </button>
              {menuOpen && (
                <div role="menu" className="absolute right-0 mt-2 w-56 rounded-xl border border-[#E7E2D6] bg-white shadow-lg py-1 z-30">
                  <div className="px-4 py-2.5 border-b border-[#E7E2D6]">
                    <p className="text-sm font-medium truncate">{displayName}</p>
                    <p className="text-xs text-[#66736B] truncate">{profile?.account.email ?? user?.email}</p>
                  </div>
                  <NavLink to="/municipal/profile" role="menuitem" className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-[#FAF7F0]">
                    <Settings className="w-4 h-4" /> Profile & Settings
                  </NavLink>
                  <button type="button" role="menuitem" onClick={handleLogout} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
                    <LogOut className="w-4 h-4" /> Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="px-4 sm:px-6 lg:px-8 py-6 max-w-7xl">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
