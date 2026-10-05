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

export default function RiderDashboard() {
  const user = useAuthStore((s) => s.user)
  const riderOnline = user?.rider_status === 'online' || user?.rider_status === 'available'

  const { data: dashboardData } = useQuery({
    queryKey: ['rider-dashboard'],
    queryFn: () => get<DashboardData>('/rider/dashboard'),
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

        <Link to="/rider/history" className="block text-center text-sm font-semibold text-[#087F5B] hover:text-[#005C42]">
          View delivery history
        </Link>
      </div>
    </div>
  )
}
