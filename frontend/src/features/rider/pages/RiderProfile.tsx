import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { get, post, put } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, Camera, ChevronRight, DollarSign, History, Map as MapIcon, MessageSquare, Save, User } from 'lucide-react'
import { toAssetUrl, getInitials } from '@/shared/utils'

const settingsLinks = [
  { to: '/rider/profile', icon: User, title: 'Profile', description: 'Manage your account information' },
  { to: '/rider/history', icon: History, title: 'History', description: 'View your completed deliveries and ride history' },
  { to: '/rider/earnings', icon: DollarSign, title: 'Earnings', description: 'Track your delivery earnings and payouts' },
  { to: '/rider/messages', icon: MessageSquare, title: 'Messages', description: 'Read conversations with tourists and restaurants' },
  { to: '/rider/map', icon: MapIcon, title: 'Live Map', description: 'Open the map for your active trips' },
]

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  phone: z.string().min(1, 'Phone is required'),
  municipality: z.string().min(1, 'Municipality is required'),
  barangay: z.string().min(1, 'Barangay is required'),
})

type ProfileFormValues = z.infer<typeof schema>

interface RiderProfile {
  id: number
  name: string
  email: string
  phone: string
  municipality: string
  barangay: string
  role: string
  account_status: string
  current_service?: 'food' | 'transport' | null
  profile_photo?: string | null
}

export default function RiderProfile() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string>('')
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fetchUser = useAuthStore((s) => s.fetchUser)
  const isSettingsPage = location.pathname === '/rider/settings'

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1)
    else navigate('/rider/map')
  }

  const { data: profile, isLoading } = useQuery({
    queryKey: ['rider-profile'],
    queryFn: () => get<RiderProfile>('/rider/profile'),
  })

  const { register, handleSubmit, formState: { errors } } = useForm<ProfileFormValues>({
    resolver: zodResolver(schema),
    values: profile ? {
      name: profile.name,
      email: profile.email,
      phone: profile.phone ?? '',
      municipality: profile.municipality ?? '',
      barangay: profile.barangay ?? '',
    } : undefined,
  })

  const mutation = useMutation({
    mutationFn: (data: ProfileFormValues) => put('/rider/profile', data),
    onSuccess: () => setSuccess('Profile updated successfully.'),
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to update profile.'),
  })

  const photoMutation = useMutation({
    mutationFn: (formData: FormData) => post('/rider/profile/photo', formData),
    onSuccess: () => {
      setPhotoFile(null)
      setPhotoPreview('')
      setSuccess('Profile photo updated successfully.')
      queryClient.invalidateQueries({ queryKey: ['rider-profile'] })
      void fetchUser()
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to update profile photo.'),
  })

  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const uploadPhoto = () => {
    if (!photoFile) return
    const fd = new FormData()
    fd.append('photo', photoFile)
    photoMutation.mutate(fd)
  }

  const avatarSrc = photoPreview || toAssetUrl(profile?.profile_photo)

  if (isLoading) return <DashboardSkeleton />

  return (
    <div className="max-w-2xl mx-auto">
      {isSettingsPage && (
        <div className="mb-3 flex justify-start">
          <button
            type="button"
            onClick={handleBack}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E5E9E7] bg-white px-3.5 py-2 text-sm font-semibold text-[#17201B] transition hover:bg-[#F3F8F5] hover:text-[#087F3F]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
        </div>
      )}

      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">{isSettingsPage ? 'Settings' : 'My Profile'}</h1>
        <p className="mt-1 text-sm text-[#6B7280]">
          {isSettingsPage ? 'Manage your rider preferences' : 'Manage your account information'}
        </p>
      </div>

      {error && <Alert type="error" message={error} onDismiss={() => setError('')} />}
      {success && <Alert type="success" message={success} onDismiss={() => setSuccess('')} />}

      <form onSubmit={handleSubmit((data) => mutation.mutate(data))} className="space-y-6">
        {!isSettingsPage && <div className="bg-white rounded-2xl border border-[#E5E9E7] p-6 space-y-4">
          <h2 className="text-lg font-semibold text-[#17201B]">Personal Information</h2>

          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="w-20 h-20 rounded-full overflow-hidden bg-[#E9F7EF] flex items-center justify-center border border-[#D7E2DC]">
                {avatarSrc ? (
                  <img src={avatarSrc} alt={profile?.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-bold text-[#087F3F]">{getInitials(profile?.name)}</span>
                )}
              </div>
              <label htmlFor="profile-photo" className="absolute bottom-0 right-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-emerald-600 text-white shadow-md transition hover:bg-emerald-700">
                <Camera className="h-3.5 w-3.5" />
                <span className="sr-only">Upload profile photo</span>
              </label>
              <input
                id="profile-photo"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handlePhotoFile}
              />
            </div>

            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#17201B]">Profile Photo</p>
              <p className="mt-0.5 text-xs text-[#6B7280]">Upload a photo of yourself so tourists can recognize you.</p>
              {photoPreview && (
                <button
                  type="button"
                  onClick={uploadPhoto}
                  disabled={photoMutation.isPending}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {photoMutation.isPending ? 'Uploading...' : 'Save photo'}
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#4B5563] mb-1">Full Name</label>
            <input {...register('name')} className="w-full bg-[#F3F8F5] border border-[#D7E2DC] rounded-xl px-4 py-2.5 text-sm text-[#17201B] focus:ring-2 focus:ring-emerald-500/40 focus:outline-none" />
            {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1">Email</label>
              <input {...register('email')} type="email" className="w-full bg-[#F3F8F5] border border-[#D7E2DC] rounded-xl px-4 py-2.5 text-sm text-[#17201B] focus:ring-2 focus:ring-emerald-500/40 focus:outline-none" />
              {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1">Phone</label>
              <input {...register('phone')} className="w-full bg-[#F3F8F5] border border-[#D7E2DC] rounded-xl px-4 py-2.5 text-sm text-[#17201B] focus:ring-2 focus:ring-emerald-500/40 focus:outline-none" />
              {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone.message}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1">Municipality</label>
              <input {...register('municipality')} className="w-full bg-[#F3F8F5] border border-[#D7E2DC] rounded-xl px-4 py-2.5 text-sm text-[#17201B] focus:ring-2 focus:ring-emerald-500/40 focus:outline-none" />
              {errors.municipality && <p className="text-red-400 text-xs mt-1">{errors.municipality.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-[#4B5563] mb-1">Barangay</label>
              <input {...register('barangay')} className="w-full bg-[#F3F8F5] border border-[#D7E2DC] rounded-xl px-4 py-2.5 text-sm text-[#17201B] focus:ring-2 focus:ring-emerald-500/40 focus:outline-none" />
              {errors.barangay && <p className="text-red-400 text-xs mt-1">{errors.barangay.message}</p>}
            </div>
          </div>

          {profile && (
            <div className="pt-2 flex items-center gap-3 text-sm text-[#6B7280]">
              <span className="capitalize">Role: {profile.role}</span>
              <span>&bull;</span>
              <span className="capitalize">Status: {profile.account_status}</span>
            </div>
          )}
        </div>}

        {isSettingsPage && <div className="bg-white rounded-2xl border border-[#E5E9E7] p-6">
          <h2 className="text-lg font-semibold text-[#17201B]">Settings</h2>
          <p className="mt-1 text-sm text-[#6B7280]">Open a section to manage your rider account.</p>

          <ul className="mt-4 divide-y divide-[#E5E9E7]">
            {settingsLinks.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className="group flex items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-[#F3F8F5]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#E9F7EF] text-[#087F3F] transition group-hover:bg-emerald-600 group-hover:text-white">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#17201B]">{item.title}</span>
                    <span className="block truncate text-xs text-[#6B7280]">{item.description}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-[#9CA3AF] transition group-hover:translate-x-0.5 group-hover:text-[#087F3F]" />
                </Link>
              </li>
            ))}
          </ul>
        </div>}

        {isSettingsPage && <div className="bg-white rounded-2xl border border-[#E5E9E7] p-6">
          <h2 className="text-lg font-semibold text-[#17201B]">Activity</h2>
          <p className="mt-1 text-sm text-[#6B7280]">View your completed deliveries and ride history.</p>
          <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => navigate('/rider/history')}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-2.5 text-sm font-semibold text-emerald-400 transition hover:bg-emerald-500/10"
          >
            <History className="h-4 w-4" />
            View History
          </button>
          <button
            type="button"
            onClick={() => navigate('/rider/earnings')}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-2.5 text-sm font-semibold text-emerald-400 transition hover:bg-emerald-500/10"
          >
            <DollarSign className="h-4 w-4" />
            View Earnings
          </button>
          </div>
        </div>}

        {!isSettingsPage && <div className="flex items-center justify-end">
          <button type="submit" disabled={mutation.isPending} className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition">
            <Save className="w-4 h-4" />
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>}
      </form>

    </div>
  )
}
