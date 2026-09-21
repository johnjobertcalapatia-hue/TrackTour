import { useLocation, Link } from 'react-router-dom'
import { cn } from '@/shared/utils'
import {
  Home, MapPin, Mountain, Compass, UtensilsCrossed, Building2, Calendar, Tag,
} from 'lucide-react'

interface Tab {
  key: string
  label: string
  to: string
  icon: React.ComponentType<{ className?: string }>
}

const TABS: Tab[] = [
  { key: 'for-you', label: 'For You', to: '/tourist/dashboard', icon: Home },
  { key: 'destinations', label: 'Tourist Spots', to: '/tourist/destinations', icon: MapPin },
  { key: 'food', label: 'Food', to: '/tourist/food', icon: UtensilsCrossed },
  { key: 'hotels', label: 'Hotels', to: '/tourist/stays', icon: Building2 },
  { key: 'activities', label: 'Activities', to: '/tourist/explore', icon: Compass },
  { key: 'events', label: 'Events', to: '/tourist/events', icon: Calendar },
]

export default function TouristTabs() {
  const location = useLocation()

  const isActive = (to: string) =>
    location.pathname === to || location.pathname.startsWith(to + '/')

  return (
    <div className="border-b border-[#E5E9E7] bg-white">
      <div className="px-6 overflow-x-auto scrollbar-hide">
        <div className="flex items-center gap-1 min-w-max py-1">
          {TABS.map((tab) => {
            const active = isActive(tab.to)
            return (
              <Link
                key={tab.key}
                to={tab.to}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap',
                  active
                    ? 'text-[#087F3F] bg-[#E9F7EF]'
                    : 'text-[#68736D] hover:text-[#17201B] hover:bg-[#F3F8F4]'
                )}
              >
                <tab.icon className={cn('w-4 h-4', active ? 'text-[#087F3F]' : 'text-[#9CA3AF]')} />
                {tab.label}
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
