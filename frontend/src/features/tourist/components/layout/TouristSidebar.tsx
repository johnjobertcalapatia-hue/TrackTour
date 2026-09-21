import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { getInitials, toAssetUrl } from '@/shared/utils'
import { cn } from '@/shared/utils'
import {
  Home, Compass, Map, Heart, Luggage, Package, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-react'

interface NavItem {
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const PRIMARY_ITEMS: NavItem[] = [
  { to: '/tourist/dashboard', label: 'Home', icon: Home },
  { to: '/tourist/explore', label: 'Explore', icon: Compass },
  { to: '/tourist/explore/map', label: 'Map', icon: Map },
  { to: '/tourist/favorites', label: 'Saved', icon: Heart },
  { to: '/tourist/trips', label: 'My Trips', icon: Luggage },
]

const ACTIVITY_ITEMS: NavItem[] = [
  { to: '/tourist/orders', label: 'Orders & Bookings', icon: Package },
]

const ALL_ITEMS: NavItem[] = [...PRIMARY_ITEMS, ...ACTIVITY_ITEMS]

interface TouristSidebarProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
}

export default function TouristSidebar({ collapsed = false, onToggleCollapse }: TouristSidebarProps) {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const location = useLocation()
  const profilePhoto = toAssetUrl(user?.profile_photo)

  const activeNavPath = useMemo(() => {
    const current = location.pathname
    const candidates = ALL_ITEMS
      .map((i) => i.to)
      .filter((to) => current === to || current.startsWith(to + '/'))
    if (candidates.length === 0) return null
    return candidates.sort((a, b) => b.length - a.length)[0]
  }, [location.pathname])

  const isActive = (to: string) => to === activeNavPath

  const renderSection = (title: string, items: NavItem[]) => (
    <div className="mb-4">
      {!collapsed && <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#9CA3AF]">{title}</p>}
      {items.map((item) => {
        const active = isActive(item.to)
        return (
          <Link
            key={item.label + item.to}
            to={item.to}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150',
              collapsed ? 'justify-center' : '',
              active
                ? 'bg-[#E9F7EF] text-[#087F3F] border-l-[3px] border-[#087F3F] ml-0'
                : 'text-[#68736D] hover:bg-[#F3F8F4] hover:text-[#17201B]'
            )}
          >
            <item.icon className={cn('w-[18px] h-[18px] shrink-0', active ? 'text-[#087F3F]' : 'text-[#9CA3AF]')} />
            {!collapsed && <span className="flex-1">{item.label}</span>}
          </Link>
        )
      })}
    </div>
  )

  return (
    <aside className={cn(
      'relative hidden lg:flex flex-col shrink-0 bg-white border-r border-[#E5E9E7] h-[calc(100vh-64px)] sticky top-16 overflow-y-auto transition-[width] duration-200',
      collapsed ? 'w-[76px]' : 'w-[260px]'
    )}>
      {/* User Card */}
      <div className={cn('pt-5 pb-3', collapsed ? 'px-2' : 'px-4')}>
        {!collapsed && <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#9CA3AF]">SIGNED IN AS</p>}
        <div className={cn('flex items-center gap-3', collapsed ? 'justify-center' : '')}>
          <div className="relative">
            {profilePhoto ? (
              <img src={profilePhoto} alt={user?.name} className="w-11 h-11 rounded-full object-cover ring-2 ring-[#087F3F]/20" />
            ) : (
              <span className="w-11 h-11 rounded-full bg-gradient-to-br from-[#087F3F] to-[#056B35] text-white flex items-center justify-center text-sm font-bold shrink-0">
                {getInitials(user?.name)}
              </span>
            )}
            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-[#087F3F] rounded-full border-2 border-white" />
          </div>
          {!collapsed && <div className="min-w-0">
            <p className="text-sm font-bold text-[#17201B] truncate">{user?.name || 'Tourist'}</p>
            <p className="text-xs text-[#68736D]">Tourist</p>
          </div>}
        </div>
      </div>

      <div className={cn('pb-2', collapsed ? 'px-2' : 'px-4')}>
        <div className="border-t border-[#E5E9E7]" />
      </div>

      {/* Nav sections */}
      <nav className={cn('flex-1 pb-4 space-y-1', collapsed ? 'px-1' : 'px-2')}>
        {renderSection('DISCOVER', PRIMARY_ITEMS)}
        {renderSection('ACTIVITY', ACTIVITY_ITEMS)}
      </nav>

      {/* Logout */}
      <div className={cn('pb-4 mt-auto', collapsed ? 'px-1' : 'px-3')}>
        <div className="border-t border-[#E5E9E7] pt-3">
          {onToggleCollapse && (
            <div className="relative group">
              <button
                type="button"
                onClick={onToggleCollapse}
                className={cn(
                  'hidden lg:flex items-center gap-3 py-2.5 text-sm font-medium text-[#68736D] hover:bg-[#F3F8F4] hover:text-[#087F3F] transition w-full',
                  collapsed ? 'justify-center px-0' : 'px-3'
                )}
                aria-label={collapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
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
                <div className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2.5 py-1 bg-white text-[#17201A] text-xs font-medium rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg border border-[#E5E9E7]">
                  Expand
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => { logout(); window.location.href = '/login' }}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium text-[#68736D] hover:text-red-500 hover:bg-red-50 transition w-full',
              collapsed ? 'justify-center' : ''
            )}
            title={collapsed ? 'Log out' : undefined}
          >
            <LogOut className="w-[18px] h-[18px]" />
            {!collapsed && 'Log Out'}
          </button>
        </div>
      </div>
    </aside>
  )
}
