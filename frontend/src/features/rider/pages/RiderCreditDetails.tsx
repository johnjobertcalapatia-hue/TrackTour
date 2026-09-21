import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get } from '@/shared/services/api'
import { formatCurrency } from '@/shared/utils'
import { TableSkeleton } from '@/shared/components/Skeleton'
import { ChevronLeft, Coins, Lock } from 'lucide-react'

interface CreditBalance {
  total_credits: number
  usable_credits: number
  reserved_credits: number
  minimum_reserve: number
}

const HOW_IT_WORKS = [
  {
    step: 1,
    title: 'Top up your credits',
    description: 'Use GCash to add credits to your wallet.',
  },
  {
    step: 2,
    title: 'Credits are added after successful payment',
    description: 'Your available credits increase once payment is confirmed.',
  },
  {
    step: 3,
    title: 'Use available credits to accept COD deliveries',
    description: 'Your credits determine your eligibility for cash-on-delivery orders.',
  },
  {
    step: 4,
    title: 'Credits are reserved while COD deliveries are active',
    description: 'The order amount is temporarily locked from your available balance.',
  },
  {
    step: 5,
    title: 'After successful delivery and COD collection, the reservation is released',
    description: 'Your credits return to available once the customer pays.',
  },
]

export default function RiderCreditDetails() {
  const navigate = useNavigate()

  const { data: balanceData, isLoading } = useQuery({
    queryKey: ['rider-credits-balance'],
    queryFn: () => get<CreditBalance>('/rider/credits/balance'),
  })

  if (isLoading) return <TableSkeleton rows={5} cols={4} />

  const balance = balanceData ?? { total_credits: 0, usable_credits: 0, reserved_credits: 0, minimum_reserve: 0 }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-xl bg-[#F3F8F5] border border-[#D7E2DC] flex items-center justify-center text-[#6B7280] hover:text-[#17201B] transition"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Credit Details</h1>
          <p className="text-sm text-[#6B7280]">How the credits system works</p>
        </div>
      </div>

      {/* Total Credits Card */}
      <div className="bg-gradient-to-br from-[#087F3F] via-[#065F2E] to-[#044D24] rounded-2xl p-5 shadow-lg shadow-emerald-900/20 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center">
            <Coins className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-white/90">Total Credits</span>
        </div>
        <p className="text-3xl font-bold text-white">{formatCurrency(balance.total_credits)}</p>
      </div>

      {/* Available & Reserved */}
      <div className="space-y-3 mb-6">
        <div className="bg-white rounded-2xl border border-[#E5E9E7] p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-900/30 rounded-xl flex items-center justify-center">
              <Coins className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#17201B]">Available Credits</p>
              <p className="text-lg font-bold text-emerald-400">{formatCurrency(balance.usable_credits)}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-[#E5E9E7] p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-900/30 rounded-xl flex items-center justify-center">
              <Lock className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[#17201B]">Reserved Credits</p>
              <p className="text-lg font-bold text-amber-400">{formatCurrency(balance.reserved_credits)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* How It Works */}
      <div>
        <h2 className="text-lg font-semibold text-[#17201B] mb-4">How It Works</h2>
        <div className="space-y-3">
          {HOW_IT_WORKS.map((item) => (
            <div
              key={item.step}
              className="bg-white rounded-xl border border-[#E5E9E7] p-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-[#087F3F] flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-xs font-bold text-white">{item.step}</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#17201B]">{item.title}</p>
                  <p className="text-xs text-[#6B7280] mt-1">{item.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
