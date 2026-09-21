import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { useAuthStore } from '@/features/auth/services/auth-store'
import { formatCurrency } from '@/shared/utils'
import {
  Wallet,
  ChevronRight,
  Truck,
  Clock,
  ArrowDownLeft,
  ArrowUpRight,
  RotateCcw,
  Ban,
  HandCoins,
  CreditCard,
  CircleDollarSign,
  CheckCircle2,
  Circle,
  Zap,
  MapPin,
} from 'lucide-react'

interface DashboardData {
  pending_deliveries: number
  active_deliveries: number
  completed_today: number
  earnings_today: number
  total_earnings: number
  rating: number
}

interface CreditBalance {
  total_credits: number
  usable_credits: number
  reserved_credits: number
  minimum_reserve: number
}

interface CreditTransaction {
  id: number
  transaction_type: string
  amount: number
  description: string
  reference: string | null
  created_at: string
}

interface ActiveDelivery {
  id: number
  status: string
  order?: {
    id: number
    order_code: string
  }
  restaurant?: {
    name: string
  }
  customer?: {
    name: string
  }
}

const getTxIcon = (type: string) => {
  switch (type) {
    case 'CREDIT_TOPUP':
      return <CreditCard className="w-4 h-4 text-emerald-600" />
    case 'COD_RESERVE':
      return <ArrowUpRight className="w-4 h-4 text-amber-600" />
    case 'COD_RELEASE':
      return <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
    case 'FINALIZATION':
      return <CircleDollarSign className="w-4 h-4 text-emerald-600" />
    case 'DELIVERY_EARNING':
      return <HandCoins className="w-4 h-4 text-emerald-600" />
    case 'REFUND':
      return <RotateCcw className="w-4 h-4 text-blue-600" />
    case 'CREDIT_ADJUSTMENT':
    case 'DEBIT_ADJUSTMENT':
      return <Ban className="w-4 h-4 text-gray-500" />
    default:
      return <Clock className="w-4 h-4 text-gray-400" />
  }
}

const getTxLabel = (type: string) => {
  switch (type) {
    case 'CREDIT_TOPUP': return 'Credit Top-up'
    case 'COD_RESERVE': return 'COD Reservation'
    case 'COD_RELEASE': return 'Credit Release'
    case 'FINALIZATION': return 'Credit Finalization'
    case 'DELIVERY_EARNING': return 'Delivery Earnings'
    case 'REFUND': return 'Refund'
    case 'CREDIT_ADJUSTMENT': return 'Manual Credit Adjustment'
    case 'DEBIT_ADJUSTMENT': return 'Manual Debit Adjustment'
    default: return type
  }
}

const getTxAmountColor = (type: string) => {
  switch (type) {
    case 'CREDIT_TOPUP':
    case 'COD_RELEASE':
    case 'FINALIZATION':
    case 'DELIVERY_EARNING':
    case 'REFUND':
      return 'text-emerald-700'
    case 'COD_RESERVE':
    case 'DEBIT_ADJUSTMENT':
      return 'text-amber-700'
    default:
      return 'text-gray-600'
  }
}

export default function RiderDashboard() {
  const user = useAuthStore((s) => s.user)
  const riderOnline = user?.rider_status === 'online' || user?.rider_status === 'available'

  const { data: dashboardData } = useQuery({
    queryKey: ['rider-dashboard'],
    queryFn: () => get<DashboardData>('/rider/dashboard'),
  })

  const { data: creditBalance, isLoading: creditLoading } = useQuery({
    queryKey: ['rider-credits-balance'],
    queryFn: () => get<CreditBalance>('/rider/credits/balance'),
  })

  const { data: transactions, isLoading: txLoading } = useQuery({
    queryKey: ['rider-credits-transactions'],
    queryFn: () => get<CreditTransaction[]>('/rider/credits/transactions'),
  })

  const { data: activeDeliveryData } = useQuery({
    queryKey: ['rider-deliveries-active'],
    queryFn: () => get<ActiveDelivery[]>('/rider/deliveries/active'),
    enabled: riderOnline,
  })

  const { data: pendingDeliveryData } = useQuery({
    queryKey: ['rider-deliveries-pending'],
    queryFn: () => get<ActiveDelivery[]>('/rider/deliveries/pending'),
    enabled: riderOnline,
  })

  const balance = creditBalance ?? { total_credits: 0, usable_credits: 0, reserved_credits: 0, minimum_reserve: 0 }
  const recentTransactions = (transactions ?? []).slice(0, 5)
  const dashboard = dashboardData ?? {
    pending_deliveries: 0,
    active_deliveries: 0,
    completed_today: 0,
    earnings_today: 0,
    total_earnings: 0,
    rating: 0,
  }

  const activeDelivery = (activeDeliveryData ?? [])[0] ?? null
  const pendingOffer = (pendingDeliveryData ?? [])[0] ?? null
  const codEligible = balance.usable_credits > 0

  const riderInitials = (user?.name ?? 'R').split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)
  const riderId = `RT-${String(user?.id ?? 0).padStart(5, '0')}`

  return (
    <div className="min-h-screen bg-[#F7FAF8]">
      <div className="max-w-[1100px] mx-auto px-4 sm:px-5 py-5 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[13px] sm:text-sm font-bold text-[#087F5B] tracking-wide uppercase">TrackTour</h1>
            <p className="text-[11px] sm:text-xs text-[#6B7F75]">Rider Dashboard</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-[#17201B]">{user?.name ?? 'Rider'}</p>
              <p className="text-[11px] text-[#6B7F75]">{riderId}</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-full bg-[#087F5B] flex items-center justify-center">
                <span className="text-xs font-bold text-white">{riderInitials}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile name + status */}
        <div className="flex items-center justify-between sm:hidden">
          <div>
            <p className="text-sm font-semibold text-[#17201B]">{user?.name ?? 'Rider'}</p>
            <p className="text-[11px] text-[#6B7F75]">{riderId}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${riderOnline ? 'bg-emerald-500' : 'bg-gray-400'}`} />
            <span className="text-xs text-[#6B7F75]">{riderOnline ? 'Online' : 'Offline'}</span>
          </div>
        </div>

        {/* Desktop online status */}
        <div className="hidden sm:flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${riderOnline ? 'bg-emerald-500' : 'bg-gray-400'}`} />
          <span className="text-xs text-[#6B7F75]">{riderOnline ? 'Online' : 'Offline'}</span>
        </div>

        {/* My Credits Card */}
        <Link
          to="/rider/wallet"
          className="block rounded-[22px] overflow-hidden shadow-[0_14px_35px_rgba(0,92,66,0.20)] hover:shadow-[0_18px_40px_rgba(0,92,66,0.25)] hover:scale-[1.005] transition-all duration-300"
        >
          <div className="relative bg-gradient-to-br from-[#005C42] to-[#087F5B] p-5 sm:p-6">
            {/* Decorative elements */}
            <div className="absolute top-0 right-0 w-40 h-40 opacity-[0.07]">
              <svg viewBox="0 0 200 200" className="w-full h-full">
                <path d="M10 180 L60 80 L90 120 L130 40 L190 160" fill="none" stroke="white" strokeWidth="3"/>
                <circle cx="160" cy="50" r="15" fill="white" opacity="0.5"/>
                <path d="M140 180 L150 140 L160 180" fill="white" opacity="0.3"/>
                <path d="M170 180 L178 150 L186 180" fill="white" opacity="0.3"/>
              </svg>
            </div>

            {/* Card header */}
            <div className="flex items-center justify-between mb-4 relative z-10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
                  <Wallet className="w-4 h-4 text-white" />
                </div>
                <span className="text-sm font-semibold text-white/90">My Credits</span>
              </div>
              <ChevronRight className="w-4 h-4 text-white/50" />
            </div>

            {/* Usable credits - main number */}
            <div className="relative z-10 mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-white/60 mb-1">Usable Credits</p>
              <p className="text-4xl sm:text-[42px] font-extrabold text-white leading-none tracking-tight">
                {creditLoading ? (
                  <span className="inline-block w-32 h-10 bg-white/10 rounded-lg animate-pulse" />
                ) : (
                  formatCurrency(balance.usable_credits)
                )}
              </p>
            </div>

            {/* COD eligibility */}
            <div className="relative z-10 mb-4">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold ${
                codEligible
                  ? 'bg-white/14 border border-white/18 text-white'
                  : 'bg-amber-500/20 border border-amber-400/30 text-amber-200'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${codEligible ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                {codEligible ? 'COD ELIGIBLE' : 'COD NOT ELIGIBLE'}
              </span>
              {!codEligible && (
                <p className="text-[11px] text-white/50 mt-2 leading-relaxed">
                  Your usable credits have reached the protected reserve.<br />
                  Top up to accept COD deliveries.
                </p>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-white/12 relative z-10" />

            {/* Credit breakdown */}
            <div className="relative z-10 grid grid-cols-3 gap-3 pt-3.5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-0.5">Total</p>
                <p className="text-sm font-bold text-white/90">{formatCurrency(balance.total_credits)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-0.5">Protected</p>
                <p className="text-sm font-bold text-white/90">{formatCurrency(balance.minimum_reserve)}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-white/45 mb-0.5">Reserved</p>
                <p className="text-sm font-bold text-white/90">{formatCurrency(balance.reserved_credits)}</p>
              </div>
            </div>
          </div>
        </Link>

        {/* Today's Earnings */}
        <Link
          to="/rider/earnings"
          className="block bg-white rounded-[18px] border border-[#E4ECE7] p-4 sm:p-5 shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:border-[#087F5B]/40 hover:shadow-[0_6px_16px_rgba(0,92,66,0.08)] transition-all duration-200"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FFF4B8] flex items-center justify-center">
                <CircleDollarSign className="w-5 h-5 text-[#087F5B]" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7F75]">Today's Earnings</p>
                <p className="text-xl font-bold text-[#17201B]">{formatCurrency(dashboard.earnings_today)}</p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[#9CA3AF]" />
          </div>
        </Link>

        {/* Delivery Status */}
        <Link
          to="/rider/deliveries"
          className="block bg-white rounded-[18px] border border-[#E4ECE7] p-4 sm:p-5 shadow-[0_4px_12px_rgba(0,0,0,0.06)] hover:border-[#087F5B]/40 hover:shadow-[0_6px_16px_rgba(0,92,66,0.08)] transition-all duration-200"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-[#EAF7F0] flex items-center justify-center">
                <Truck className="w-4 h-4 text-[#087F5B]" />
              </div>
              <span className="text-sm font-semibold text-[#17201B]">Delivery Status</span>
            </div>
            <ChevronRight className="w-4 h-4 text-[#9CA3AF]" />
          </div>

          {!riderOnline ? (
            <div className="flex items-start gap-2.5">
              <Circle className="w-2.5 h-2.5 text-gray-400 mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#6B7F75]">OFFLINE</p>
                <p className="text-xs text-[#9CA3AF] mt-0.5">Go online to receive delivery offers.</p>
              </div>
            </div>
          ) : activeDelivery ? (
            <div className="flex items-start gap-2.5">
              <Zap className="w-4 h-4 text-[#087F5B] mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#087F5B]">ACTIVE DELIVERY</p>
                {activeDelivery.order?.order_code && (
                  <p className="text-xs text-[#6B7F75] mt-0.5">Order {activeDelivery.order.order_code}</p>
                )}
                {activeDelivery.restaurant?.name && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <MapPin className="w-3 h-3 text-[#6B7F75] shrink-0" />
                    <p className="text-xs text-[#6B7F75] truncate">
                      {activeDelivery.restaurant.name}
                      {activeDelivery.customer?.name ? ` → ${activeDelivery.customer.name}` : ''}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ) : pendingOffer ? (
            <div className="flex items-start gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 mt-1 shrink-0 animate-pulse" />
              <div>
                <p className="text-sm font-semibold text-amber-700">NEW DELIVERY OFFER</p>
                <p className="text-xs text-[#6B7F75] mt-0.5">A delivery is waiting for your response.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-[#087F5B] mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-[#087F5B]">READY FOR DELIVERY</p>
                <p className="text-xs text-[#6B7F75] mt-0.5">You're online and ready to receive a delivery offer.</p>
              </div>
            </div>
          )}
        </Link>

        {/* Recent Activity */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-[#17201B]">Recent Activity</h2>
            <Link to="/rider/credit-activity" className="text-[13px] font-semibold text-[#087F5B] hover:text-[#005C42] transition">
              View All
            </Link>
          </div>

          <div className="space-y-2.5">
            {txLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-[18px] border border-[#E4ECE7] p-4 animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-gray-100 rounded-xl" />
                    <div className="flex-1">
                      <div className="w-24 h-3 bg-gray-100 rounded mb-2" />
                      <div className="w-32 h-2.5 bg-gray-50 rounded" />
                    </div>
                    <div className="text-right">
                      <div className="w-16 h-3 bg-gray-100 rounded mb-2" />
                      <div className="w-10 h-2.5 bg-gray-50 rounded" />
                    </div>
                  </div>
                </div>
              ))
            ) : recentTransactions.length === 0 ? (
              <div className="bg-white rounded-[18px] border border-[#E4ECE7] p-8 text-center">
                <p className="text-sm text-[#9CA3AF]">No recent activity yet.</p>
              </div>
            ) : (
              recentTransactions.map((tx) => (
                <div
                  key={tx.id}
                  className="bg-white rounded-[18px] border border-[#E4ECE7] px-4 py-3.5 flex items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-xl bg-[#F3F8F5] flex items-center justify-center shrink-0">
                    {getTxIcon(tx.transaction_type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#17201B] truncate">{getTxLabel(tx.transaction_type)}</p>
                    <p className="text-[11px] text-[#9CA3AF] truncate">{tx.description}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[13px] font-bold ${getTxAmountColor(tx.transaction_type)}`}>
                      {tx.transaction_type === 'COD_RESERVE' || tx.transaction_type === 'DEBIT_ADJUSTMENT' ? '-' : '+'}{formatCurrency(tx.amount)}
                    </p>
                    <p className="text-[10px] text-[#9CA3AF]">
                      {new Date(tx.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
