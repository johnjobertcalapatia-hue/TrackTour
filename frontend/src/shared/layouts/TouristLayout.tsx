import { Suspense, useMemo, useState } from 'react'
import { Outlet, useLocation, Link } from 'react-router-dom'
import TouristHeader from '@/features/tourist/components/layout/TouristHeader'
import TouristSidebar from '@/features/tourist/components/layout/TouristSidebar'
import { X, Home, Map, Heart, Compass, User } from 'lucide-react'

const MOBILE_NAV = [
  { to: '/tourist/dashboard', label: 'Home', icon: Home },
  { to: '/tourist/explore', label: 'Explore', icon: Compass },
  { to: '/tourist/explore/map', label: 'Map', icon: Map },
  { to: '/tourist/favorites', label: 'Saved', icon: Heart },
  { to: '/tourist/profile', label: 'Profile', icon: User },
]

export default function TouristLayout() {
  const location = useLocation()
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false)

  const activeMobileNav = useMemo(() => {
    const current = location.pathname
    const candidates = MOBILE_NAV
      .map((i) => i.to)
      .filter((to) => current === to || current.startsWith(to + '/'))
    if (candidates.length === 0) return null
    return candidates.sort((a, b) => b.length - a.length)[0]
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-[#F7FAF7]">
      {/* Header */}
      <TouristHeader />

      {/* Body */}
      <div className="flex">
        {/* Desktop sidebar */}
        <TouristSidebar
          collapsed={desktopSidebarCollapsed}
          onToggleCollapse={() => setDesktopSidebarCollapsed((collapsed) => !collapsed)}
        />

        {/* Mobile sidebar overlay */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-[2001] lg:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setMobileSidebarOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-[280px] bg-white shadow-xl z-10 overflow-y-auto">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E9E7]">
                <span className="text-sm font-bold text-[#17201B]">Menu</span>
                <button onClick={() => setMobileSidebarOpen(false)} className="p-1.5 rounded-lg hover:bg-[#E9F7EF]">
                  <X className="w-5 h-5 text-[#68736D]" />
                </button>
              </div>
              <div className="[&>aside]:border-r-0 [&>aside]:h-auto">
                <TouristSidebar />
              </div>
            </div>
          </div>
        )}

        {/* Main content area */}
        <div className="flex-1 min-w-0">
          <main className="flex-1 min-w-0 p-6 pb-24 lg:pb-6">
            <Suspense fallback={
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border-2 border-[#087F3F] border-t-transparent rounded-full animate-spin" />
              </div>
            }>
              <Outlet key={location.pathname + location.search} />
            </Suspense>
          </main>
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-[2000] bg-white border-t border-[#E5E9E7] lg:hidden safe-bottom">
        <div className="flex items-center justify-around h-16 px-2">
          {MOBILE_NAV.map((item) => {
            const active = item.to === activeMobileNav
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all ${
                  active ? 'text-[#087F3F]' : 'text-[#9CA3AF]'
                }`}
              >
                <item.icon className={`w-5 h-5 ${active ? 'text-[#087F3F]' : ''}`} />
                <span className={`text-[10px] font-medium ${active ? 'text-[#087F3F]' : ''}`}>{item.label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
