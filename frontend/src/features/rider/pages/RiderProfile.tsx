import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { get, post, put } from '@/shared/services/api'
import { Alert } from '@/shared/components/Alert'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { useLocation, useNavigate } from 'react-router-dom'
import { History, Save, ChevronRight } from 'lucide-react'

const schema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  phone: z.string().min(1, 'Phone is required'),
  municipality: z.string().min(1, 'Municipality is required'),
  barangay: z.string().min(1, 'Barangay is required'),
})

type FormData = z.infer<typeof schema>

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
}

interface CreditTransaction {
  id: number
  transaction_type: string
  amount: number
  description: string
  created_at: string
}

export default function RiderProfile() {
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const setUser = useAuthStore((state) => state.setUser)
  const queryClient = useQueryClient()
  const location = useLocation()
  const navigate = useNavigate()
  const isSettingsPage = location.pathname === '/rider/settings'

  const { data: profile, isLoading } = useQuery({
    queryKey: ['rider-profile'],
    queryFn: () => get<RiderProfile>('/rider/profile'),
  })

  const { data: transactions } = useQuery({
    queryKey: ['rider-credits-transactions'],
    queryFn: () => get<CreditTransaction[]>('/rider/credits/transactions'),
  })

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
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
    mutationFn: (data: FormData) => put('/rider/profile', data),
    onSuccess: () => setSuccess('Profile updated successfully.'),
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to update profile.'),
  })

  const serviceMutation = useMutation({
    mutationFn: (service: 'food' | 'transport') => post(`/rider/service`, { service }),
    onSuccess: (_data, service) => {
      const currentUser = useAuthStore.getState().user
      if (currentUser) {
        setUser({ ...currentUser, current_service: service })
      }
      queryClient.invalidateQueries({ queryKey: ['rider-profile'] })
    },
    onError: (err: any) => setError(err.response?.data?.message || 'Failed to switch rider mode.'),
  })

  if (isLoading) return <DashboardSkeleton />

  return (
    <div className="max-w-2xl mx-auto">
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
          <h2 className="text-lg font-semibold text-[#17201B]">Rider Mode</h2>
          <p className="mt-1 text-sm text-[#6B7280]">Choose which requests you want to receive.</p>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-[#F3F8F5] p-1">
            {([
              { value: 'food' as const, label: 'Food Delivery' },
              { value: 'transport' as const, label: 'Ride Hailing' },
            ]).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => serviceMutation.mutate(option.value)}
                disabled={serviceMutation.isPending || profile?.current_service === option.value}
                className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
                  profile?.current_service === option.value
                    ? 'bg-emerald-600 text-white'
                    : 'text-[#6B7280] hover:bg-[#E5E9E7] hover:text-[#17201B]'
                } disabled:cursor-not-allowed disabled:opacity-70`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>}

        {isSettingsPage && <div className="bg-white rounded-2xl border border-[#E5E9E7] p-6">
          <h2 className="text-lg font-semibold text-[#17201B]">Activity</h2>
          <p className="mt-1 text-sm text-[#6B7280]">View your completed deliveries and ride history.</p>
          <button
            type="button"
            onClick={() => navigate('/rider/history')}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-500/40 px-4 py-2.5 text-sm font-semibold text-emerald-400 transition hover:bg-emerald-500/10"
          >
            <History className="h-4 w-4" />
            View History
          </button>
        </div>}

        {isSettingsPage && <div className="bg-white rounded-2xl border border-[#E5E9E7] shadow-sm">
          <div className="p-5 border-b border-[#E5E9E7] flex items-center justify-between">
            <h2 className="text-lg font-semibold text-[#17201B]">Transaction History</h2>
            <button
              type="button"
              onClick={() => navigate('/rider/credit-activity')}
              className="text-xs text-[#087F3F] hover:text-[#065F2E] transition flex items-center gap-1"
            >
              View All <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E5E9E7] bg-[#F3F8F5]">
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Type</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Description</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Amount</th>
                  <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E9E7]">
                {(transactions ?? []).slice(0, 5).map((tx) => (
                  <tr key={tx.id} className="hover:bg-[#F3F8F5] transition-colors">
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        tx.transaction_type === 'CREDIT_TOPUP' || tx.transaction_type === 'COD_RELEASE'
                          ? 'bg-emerald-50 text-emerald-700'
                          : tx.transaction_type === 'COD_RESERVE'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-gray-50 text-gray-700'
                      }`}>
                        {tx.transaction_type === 'CREDIT_TOPUP' ? 'Credit Top-up'
                          : tx.transaction_type === 'COD_RESERVE' ? 'COD Reserved'
                          : tx.transaction_type === 'COD_RELEASE' ? 'COD Released'
                          : 'Adjustment'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[#4B5563]">{tx.description}</td>
                    <td className={`px-5 py-3 text-right font-medium whitespace-nowrap ${
                      tx.transaction_type === 'CREDIT_TOPUP' || tx.transaction_type === 'COD_RELEASE'
                        ? 'text-emerald-600' : 'text-amber-600'
                    }`}>
                      {tx.transaction_type === 'COD_RESERVE' ? '-' : '+'}{new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(tx.amount)}
                    </td>
                    <td className="px-5 py-3 text-[#6B7280] text-right whitespace-nowrap">
                      {new Date(tx.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {(!transactions || transactions.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-5 py-12 text-center text-[#9CA3AF]">No transactions yet</td>
                  </tr>
                )}
              </tbody>
            </table>
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
