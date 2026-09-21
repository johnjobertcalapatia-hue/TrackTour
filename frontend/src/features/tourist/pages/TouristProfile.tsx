import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { getInitials, cn } from '@/shared/utils'
import { Heart, Star, Bell, Settings, LogOut, ChevronRight } from 'lucide-react'

interface TouristProfile {
  id: number
  name: string
  email: string
  role: string
}

const MENU_ITEMS = [
  { label: 'Favorites', icon: Heart, to: '/tourist/favorites' },
  { label: 'Reviews', icon: Star, to: '/tourist/reviews' },
  { label: 'Notifications', icon: Bell, to: '/tourist/notifications' },
  { label: 'Settings', icon: Settings, to: '/tourist/profile' },
]

export default function TouristProfile() {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)

  const { data: profile } = useQuery({
    queryKey: ['tourist-profile-v2'],
    queryFn: () => get<TouristProfile>('/tourist/profile'),
  })

  return (
    <div className="space-y-6 px-4 pt-6 pb-4">
      {/* Avatar */}
      <div className="flex flex-col items-center gap-3">
        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#087F3F] to-[#056B35] text-white flex items-center justify-center text-2xl font-bold ring-2 ring-white/10">
          {getInitials(profile?.name)}
        </div>
        <div className="text-center">
          <h1 className="text-lg font-bold text-[#17201B]">{profile?.name}</h1>
          <p className="text-xs text-[#68736D]">Tourist</p>
        </div>
      </div>

      {/* Menu */}
      <div className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden">
        {MENU_ITEMS.map((item, i) => (
          <button
            key={item.label}
            onClick={() => navigate(item.to)}
            className={cn(
              'w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-[#E9F7EF] transition',
              i < MENU_ITEMS.length - 1 && 'border-b border-[#E5E9E7]'
            )}
          >
            <item.icon className="w-5 h-5 text-[#68736D]" />
            <span className="flex-1 text-sm text-[#17201B]">{item.label}</span>
            <ChevronRight className="w-4 h-4 text-[#9CA3AF]" />
          </button>
        ))}
      </div>

      {/* Logout */}
      <button
        onClick={() => { logout(); navigate('/login') }}
        className="w-full flex items-center justify-center gap-2 py-3 bg-white border border-[#E5E9E7] rounded-2xl text-sm text-red-500 font-medium hover:bg-red-50 transition"
      >
        <LogOut className="w-4 h-4" />
        Log Out
      </button>
    </div>
  )
}
