import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'
import { getInitials, cn, toAssetUrl } from '@/shared/utils'
import { Heart, Star, Bell, Settings, LogOut, ChevronRight, Camera, Loader2 } from 'lucide-react'

const MENU_ITEMS = [
  { label: 'Favorites', icon: Heart, to: '/tourist/favorites' },
  { label: 'Reviews', icon: Star, to: '/tourist/reviews' },
  { label: 'Notifications', icon: Bell, to: '/tourist/notifications' },
  { label: 'Settings', icon: Settings, to: '/tourist/profile' },
]

/** Matches the backend rule: image/jpg|png|webp, max 2 MB. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTO_BYTES = 2 * 1024 * 1024

export default function TouristProfile() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logout = useAuthStore((s) => s.logout)
  const authUser = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'upload' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data: profile } = useQuery({
    queryKey: ['tourist-profile-v2'],
    queryFn: () => get<User>('/tourist/profile'),
  })

  const name = profile?.name ?? authUser?.name
  // Once loaded, the profile is authoritative (null = no photo); before that, use the signed-in user.
  const photoPath = profile ? profile.profile_photo : authUser?.profile_photo
  const photoUrl = photoPath ? toAssetUrl(photoPath) : ''

  /** One source of truth after a change: the profile query + the signed-in user (sidebar, map pin). */
  const applyUser = (updated: User) => {
    queryClient.setQueryData(['tourist-profile-v2'], updated)
    if (authUser) setUser({ ...authUser, profile_photo: updated.profile_photo ?? null })
  }

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setError(null)
    setNotice(null)
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please choose a JPG, PNG or WebP image.')
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError('That photo is larger than 2 MB. Please choose a smaller one.')
      return
    }
    const form = new FormData()
    form.append('photo', file)
    setBusy('upload')
    try {
      applyUser(await post<User>('/tourist/profile/photo', form))
      setNotice('Profile photo updated.')
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not upload the photo. Please try again.'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 pt-6 pb-4">
      {/* Avatar */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={`${name ?? 'Your'} profile photo`}
              className="w-24 h-24 rounded-full object-cover ring-4 ring-white shadow-md"
            />
          ) : (
            <div
              data-testid="profile-initials"
              className="w-24 h-24 rounded-full bg-gradient-to-br from-[#087F3F] to-[#056B35] text-white flex items-center justify-center text-3xl font-bold ring-4 ring-white shadow-md"
            >
              {getInitials(name)}
            </div>
          )}
          {busy && (
            <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center" aria-hidden="true">
              <Loader2 className="w-7 h-7 text-white animate-spin" />
            </span>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            aria-label={photoUrl ? 'Change profile photo' : 'Upload profile photo'}
            className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-[#087F3F] text-white flex items-center justify-center ring-4 ring-white hover:bg-[#056B35] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087F3F]"
          >
            <Camera className="w-4 h-4" aria-hidden="true" />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            onChange={onPick}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="profile-photo-input"
          />
        </div>

        <div className="text-center">
          <h1 className="text-lg font-bold text-[#17201B]">{name}</h1>
          <p className="text-xs text-[#56615B]">Tourist</p>
        </div>

        <p className="text-[11px] text-[#56615B]">Tap the camera to {photoUrl ? 'change' : 'add'} your photo · JPG, PNG or WebP, up to 2 MB</p>

        <div aria-live="polite" className="min-h-[1.25rem] text-center text-[13px]">
          {error && <p role="alert" className="text-[#B91C1C]">{error}</p>}
          {!error && notice && <p className="text-[#047332]">{notice}</p>}
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
            <item.icon className="w-5 h-5 text-[#56615B]" />
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
