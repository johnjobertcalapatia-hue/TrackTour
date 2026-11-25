import { useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, get, post } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import type { User } from '@/shared/types'
import { getInitials, cn, toAssetUrl } from '@/shared/utils'
import { ClipboardList, Heart, Star, Bell, LogOut, ChevronRight, Camera, Loader2, MapPin, Mail, type LucideIcon } from 'lucide-react'
import { currentPosition, useLocationSharing, useSetLocationSharing } from '@/features/tourist/location-sharing'

interface MenuItem {
  label: string
  description: string
  icon: LucideIcon
  to: string
  tint: string
}

const ACTIVITY_ITEMS: MenuItem[] = [
  // My Activities moved here from the navigation bar (2026-11-24).
  { label: 'My Activities', description: 'Orders, trips, bookings and places you explored', icon: ClipboardList, to: '/tourist/activities', tint: 'bg-[#E9F7EF] text-[#087F3F]' },
  { label: 'Favorites', description: 'Places and food you saved', icon: Heart, to: '/tourist/favorites', tint: 'bg-[#FDECEC] text-[#D93F3F]' },
  { label: 'My reviews', description: 'Ratings you have written', icon: Star, to: '/tourist/reviews', tint: 'bg-[#FFF5DB] text-[#B7791F]' },
  { label: 'Notifications', description: 'Order, ride and booking updates', icon: Bell, to: '/tourist/notifications', tint: 'bg-[#E8F1FD] text-[#2563EB]' },
]

/** Matches the backend rule: image/jpg|png|webp, max 2 MB. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_PHOTO_BYTES = 2 * 1024 * 1024

function memberSince(createdAt: string | undefined): string | null {
  if (!createdAt) return null
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
}

/**
 * Tourist profile: a header card (photo, name, email), then grouped
 * sections — Activity links, Safety (location sharing) — and Log out.
 */
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
  const email = profile?.email ?? authUser?.email
  const since = memberSince(profile?.created_at ?? authUser?.created_at)
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
    <div className="mx-auto lg:mx-0 w-full max-w-xl space-y-6 pb-4">
      {/* Header card */}
      <section aria-label="Your profile" className="overflow-hidden rounded-2xl border border-[#E5E9E7] bg-white shadow-sm">
        <div className="relative h-28 bg-gradient-to-br from-[#0A9A4C] via-[#087F3F] to-[#05592C]">
          {/* Soft shapes on the cover */}
          <span aria-hidden="true" className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
          <span aria-hidden="true" className="absolute right-16 top-10 h-16 w-16 rounded-full bg-white/10" />
          <span aria-hidden="true" className="absolute -left-6 bottom-0 h-20 w-20 rounded-full bg-[#FFD60A]/20" />
        </div>

        <div className="px-5 pb-5">
          <div className="-mt-12 flex items-end justify-between gap-3">
            <div className="relative">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={`${name ?? 'Your'} profile photo`}
                  className="h-24 w-24 rounded-full object-cover ring-4 ring-white shadow-md"
                />
              ) : (
                <div
                  data-testid="profile-initials"
                  className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-[#0A9A4C] to-[#05592C] text-3xl font-bold text-white ring-4 ring-white shadow-md"
                >
                  {getInitials(name)}
                </div>
              )}
              {busy && (
                <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40" aria-hidden="true">
                  <Loader2 className="h-7 w-7 animate-spin text-white" />
                </span>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={!!busy}
                aria-label={photoUrl ? 'Change profile photo' : 'Upload profile photo'}
                className="absolute -bottom-0.5 -right-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-[#087F3F] text-white ring-4 ring-white transition hover:bg-[#056B35] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087F3F]"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
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
            <span className="mb-1 rounded-full bg-[#E9F7EF] px-3 py-1 text-xs font-semibold text-[#087F3F]">Tourist</span>
          </div>

          <div className="mt-3 min-w-0">
            <h1 className="truncate text-xl font-bold text-[#17201B]">{name}</h1>
            {email && (
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-[#56615B]">
                <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{email}</span>
              </p>
            )}
            {since && <p className="mt-0.5 text-xs text-[#7A857F]">Member since {since}</p>}
          </div>

          <p className="mt-3 text-[11px] text-[#7A857F]">
            Tap the camera to {photoUrl ? 'change' : 'add'} your photo · JPG, PNG or WebP, up to 2 MB
          </p>
          <div aria-live="polite" className="min-h-[1.25rem] text-[13px]">
            {error && <p role="alert" className="text-[#B91C1C]">{error}</p>}
            {!error && notice && <p className="text-[#047332]">{notice}</p>}
          </div>
        </div>
      </section>

      <Section title="Activity">
        <ul className="divide-y divide-[#EEF1EF]">
          {ACTIVITY_ITEMS.map((item) => (
            <li key={item.label}>
              <Link
                to={item.to}
                className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-[#F3FAF6] focus-visible:bg-[#F3FAF6] focus-visible:outline-none"
              >
                <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', item.tint)}>
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-[#17201B]">{item.label}</span>
                  <span className="block truncate text-xs text-[#56615B]">{item.description}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-[#A3ADA7]" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Safety">
        <LocationSharingCard />
      </Section>

      <button
        type="button"
        onClick={() => { logout(); navigate('/login') }}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[#F3D4D4] bg-white py-3 text-sm font-semibold text-[#C53030] transition hover:bg-[#FEF2F2]"
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        Log Out
      </button>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-[#7A857F]">{title}</h2>
      <div className="overflow-hidden rounded-2xl border border-[#E5E9E7] bg-white shadow-sm">{children}</div>
    </section>
  )
}

/**
 * Opt-in: share my live location with the Bansud Tourism Office. Off by
 * default; turning it off deletes the shared location straight away.
 */
function LocationSharingCard() {
  const { data, isLoading } = useLocationSharing()
  const setSharing = useSetLocationSharing()
  const [error, setError] = useState<string | null>(null)
  const on = Boolean(data?.enabled)

  const toggle = async () => {
    setError(null)
    if (!on) {
      // Ask the browser first: no point switching on without a location.
      const pos = await currentPosition()
      if (!pos) {
        setError('Allow location access for this site in your browser, then try again.')
        return
      }
    }
    setSharing.mutate(!on, { onError: (err) => setError(apiErrorMessage(err, 'Could not change location sharing. Please try again.')) })
  }

  return (
    <div className="p-4">
      <div className="flex items-start gap-3">
        <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors', on ? 'bg-[#E9F7EF] text-[#087F3F]' : 'bg-[#F1F3F2] text-[#56615B]')}>
          <MapPin className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p id="share-location-label" className="text-sm font-semibold text-[#17201B]">Share my location with the tourism office</p>
          <p className="mt-0.5 text-xs leading-relaxed text-[#56615B]">
            Lets the Bansud Tourism Office, and the tourism office of the town you are in, see where you are while the app is open, so they can help you faster in an emergency.
            Only your latest location is kept, and it is deleted when you turn this off.
          </p>
          {on && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#E9F7EF] px-2.5 py-0.5 text-xs font-medium text-[#047332]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#087F3F]" aria-hidden="true" />
              Sharing is on.
            </p>
          )}
          {error && <p role="alert" className="mt-1.5 text-xs text-[#B91C1C]">{error}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby="share-location-label"
          disabled={isLoading || setSharing.isPending}
          onClick={() => { void toggle() }}
          className={cn('relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#087F3F]', on ? 'bg-[#087F3F]' : 'bg-[#D1D5DB]')}
        >
          <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
        </button>
      </div>
    </div>
  )
}
