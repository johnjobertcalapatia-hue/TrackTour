import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/shared/services/api'
import { ArrowLeft, Smartphone, CheckCircle2, Shield, AlertCircle } from 'lucide-react'

export default function TouristGcashBind() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const returnTo = searchParams.get('return') || '/tourist/food/cart'
  const queryClient = useQueryClient()
  const [gcashNumber, setGcashNumber] = useState('')
  const [gcashName, setGcashName] = useState('')
  const [error, setError] = useState('')

  const { data: gcashStatus } = useQuery({
    queryKey: ['gcash-status'],
    queryFn: () => get<{ is_bound: boolean }>('/tourist/gcash/status'),
  })

  const bindMutation = useMutation({
    mutationFn: () => post('/tourist/gcash/bind', {
      gcash_number: gcashNumber,
      gcash_account_name: gcashName,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gcash-status'] })
      navigate(returnTo, { replace: true })
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message || 'Failed to bind GCash account. Please try again.')
    },
  })

  const isAlreadyBound = gcashStatus?.is_bound

  if (isAlreadyBound) {
    navigate(returnTo, { replace: true })
    return null
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (gcashNumber.length !== 11 || !gcashNumber.startsWith('09')) {
      setError('Please enter a valid 11-digit GCash number (09XXXXXXXXX).')
      return
    }
    if (gcashName.trim().length < 2) {
      setError('Please enter the account holder name.')
      return
    }
    bindMutation.mutate()
  }

  return (
    <div className="min-h-[calc(100vh-72px)] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-2 text-sm text-[#6B7280] hover:text-[#17201B] mb-6 transition">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>

        <div className="bg-white border border-[#E5E9E7] rounded-2xl overflow-hidden shadow-sm">
          {/* Header */}
          <div className="bg-gradient-to-br from-[#007DFC] to-[#0055CC] px-6 py-8 text-center">
            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Smartphone className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white">Bind GCash Account</h1>
            <p className="text-sm text-blue-100 mt-2">Link your GCash to pay for food orders</p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {/* Info banner */}
            <div className="flex items-start gap-3 p-3 bg-[#E9F7EF] border border-[#087F3F]/20 rounded-xl">
              <Shield className="w-4 h-4 text-[#087F3F] mt-0.5 shrink-0" />
              <p className="text-xs text-[#056B35]">Your GCash details are encrypted and stored securely. We only use the last 4 digits for display.</p>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
                <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-xs text-red-600">{error}</p>
              </div>
            )}

            {/* GCash Number */}
            <div>
              <label className="block text-sm font-medium text-[#17201B] mb-2">GCash Mobile Number</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-[#6B7280] font-medium">+63</span>
                <input
                  type="tel"
                  value={gcashNumber}
                  onChange={(e) => setGcashNumber(e.target.value.replace(/\D/g, '').slice(0, 11))}
                  placeholder="09XXXXXXXXX"
                  className="w-full pl-14 pr-4 py-3 bg-[#F8FAF9] border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#007DFC]/40 focus:border-[#007DFC] outline-none transition"
                />
              </div>
            </div>

            {/* Account Name */}
            <div>
              <label className="block text-sm font-medium text-[#17201B] mb-2">GCash Account Name</label>
              <input
                type="text"
                value={gcashName}
                onChange={(e) => setGcashName(e.target.value)}
                placeholder="e.g. Juan Dela Cruz"
                className="w-full px-4 py-3 bg-[#F8FAF9] border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#9CA3AF] focus:ring-2 focus:ring-[#007DFC]/40 focus:border-[#007DFC] outline-none transition"
              />
              <p className="text-[11px] text-[#9CA3AF] mt-1.5">Must match the name registered to your GCash account</p>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={bindMutation.isPending || gcashNumber.length < 11 || gcashName.trim().length < 2}
              className="w-full flex items-center justify-center gap-2 py-3 bg-[#007DFC] hover:bg-[#0055CC] text-white rounded-xl font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bindMutation.isPending ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Bind GCash Account
                </>
              )}
            </button>

            <p className="text-center text-xs text-[#9CA3AF]">
              You can update this anytime in your profile settings
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
