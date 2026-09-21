import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDateTime } from '@/shared/utils'
import { ChevronLeft, ChevronRight, ClipboardList, Eye, Star, Car, Building2, ShoppingBag } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

interface HistoryOrder {
  id: number
  order_number: string
  business_name: string
  status: string
  total: number
  created_at: string
  items_count?: number
  is_rated?: boolean
}

interface GroupOrderSummary {
  id: number
  reference_number: string
  status: string
  grand_total: number
  paid_amount: number
  delivery_address?: string | null
  created_at: string
  orders?: { id: number; order_number: string; business?: { name: string } | null }[]
}

interface HistoryTrip {
  id: number
  order_number: string
  business_name: string
  status: string
  total: number
  created_at: string
}

interface HistoryBooking {
  id: number
  booking_number: string
  business_name: string
  status: string
  total_amount: number
  check_in_date: string
  check_out_date: string
  created_at: string
}

type Tab = 'food' | 'transport' | 'bookings'

const TABS: { key: Tab; label: string; icon: typeof ClipboardList }[] = [
  { key: 'food', label: 'Food Orders', icon: ClipboardList },
  { key: 'transport', label: 'Transport', icon: Car },
  { key: 'bookings', label: 'Bookings', icon: Building2 },
]

interface HistoryResponse {
  orders?: { data: HistoryOrder[] }
  group_orders?: { data: GroupOrderSummary[] }
  trips?: { data: HistoryTrip[] }
  bookings?: { data: HistoryBooking[] }
}

const ITEMS_PER_PAGE = 8

export default function TouristHistory() {
  const navigate = useNavigate()
  const [page, setPage] = useState(1)
  const [activeTab, setActiveTab] = useState<Tab>('food')

  const { data, isLoading } = useQuery<HistoryResponse>({
    queryKey: ['tourist-history', activeTab],
    queryFn: () => get<HistoryResponse>(`/tourist/history?tab=${activeTab}`),
  })

  if (isLoading) return <DashboardSkeleton />

  const orders = data?.orders?.data ?? []
  const groupOrders = data?.group_orders?.data ?? []
  const trips = data?.trips?.data ?? []
  const bookings = data?.bookings?.data ?? []

  const items = activeTab === 'food' ? orders : activeTab === 'transport' ? trips : bookings
  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE)
  const paginated = items.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">History</h1>
        <p className="mt-1 text-sm text-[#6B7280]">Your activity across all services</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => { setActiveTab(key); setPage(1) }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition whitespace-nowrap ${
              activeTab === key
                ? 'bg-[#087F3F] text-white shadow-md'
                : 'bg-white border border-[#E5E9E7] text-[#6B7280] hover:border-[#087F3F]/40'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {items.length === 0 && (activeTab !== 'food' || groupOrders.length === 0) ? (
        <div className="bg-white border border-[#E5E9E7] rounded-2xl p-12 text-center">
          <ClipboardList className="w-12 h-12 text-[#6B7280]/30 mx-auto mb-4" />
          <p className="text-[#6B7280] mb-4">
            {activeTab === 'food' && 'No food orders yet. Start ordering food!'}
            {activeTab === 'transport' && 'No transport trips yet. Request a ride!'}
            {activeTab === 'bookings' && 'No bookings yet. Explore resorts and accommodations!'}
          </p>
          <button
            onClick={() => {
              if (activeTab === 'food') navigate('/tourist/food')
              else if (activeTab === 'transport') navigate('/tourist/transport')
              else navigate('/tourist/booking')
            }}
            className="bg-[#087F3F] hover:bg-[#056B35] text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition"
          >
            {activeTab === 'food' && 'Browse Food'}
            {activeTab === 'transport' && 'Request Ride'}
            {activeTab === 'bookings' && 'Browse Stays'}
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {activeTab === 'food' && groupOrders.length > 0 && (
              <div className="space-y-3 mb-4">
                {groupOrders.map((group) => (
                  <div
                    key={`group-${group.id}`}
                    className="bg-white border border-purple-200 rounded-2xl p-4 flex items-center justify-between hover:shadow-md hover:border-purple-300 transition-all"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 bg-purple-50 rounded-xl flex items-center justify-center shrink-0">
                        <ShoppingBag className="w-5 h-5 text-purple-600" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-[#17201B] truncate">{group.reference_number}</p>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                            Group
                          </span>
                        </div>
                        <p className="text-xs text-[#6B7280]">
                          {group.orders?.length ?? 0} restaurant{(group.orders?.length ?? 0) !== 1 ? 's' : ''} · {formatDateTime(group.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <div className="text-right">
                        <p className="text-sm font-bold text-[#17201B]">{formatCurrency(group.grand_total)}</p>
                        <StatusBadge status={group.status} />
                      </div>
                      <button
                        onClick={() => navigate(`/tourist/food/group-order/${group.id}`)}
                        className="p-2 rounded-lg text-purple-600 hover:text-purple-800 hover:bg-purple-50 transition"
                        title="View Group Receipt"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {activeTab === 'food' && paginated.map((item) => {
              const order = item as HistoryOrder
              return (
                <div
                  key={order.id}
                  className="bg-white border border-[#E5E9E7] rounded-2xl p-4 flex items-center justify-between hover:shadow-md hover:border-[#087F3F]/30 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-[#087F3F]/10 rounded-xl flex items-center justify-center shrink-0">
                      <ClipboardList className="w-5 h-5 text-[#087F3F]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#17201B] truncate">{order.business_name}</p>
                      <p className="text-xs text-[#6B7280]">#{order.order_number}</p>
                      <p className="text-xs text-[#6B7280]">{formatDateTime(order.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#17201B]">{formatCurrency(order.total)}</p>
                      <StatusBadge status={order.status} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => navigate(`/tourist/food/order/${order.id}/status`)}
                        className="p-2 rounded-lg text-[#6B7280] hover:text-[#087F3F] hover:bg-[#087F3F]/10 transition"
                        title="View Order"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {order.status === 'delivered' && !order.is_rated && (
                        <button
                          onClick={() => navigate(`/tourist/food/order/${order.id}/status`)}
                          className="p-2 rounded-lg text-[#6B7280] hover:text-[#F4B400] hover:bg-[#F4B400]/10 transition"
                          title="Rate Order"
                        >
                          <Star className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}

            {activeTab === 'transport' && paginated.map((item) => {
              const trip = item as HistoryTrip
              return (
                <div
                  key={trip.id}
                  className="bg-white border border-[#E5E9E7] rounded-2xl p-4 flex items-center justify-between hover:shadow-md hover:border-[#087F3F]/30 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center shrink-0">
                      <Car className="w-5 h-5 text-blue-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#17201B] truncate">{trip.business_name || 'Transport Trip'}</p>
                      <p className="text-xs text-[#6B7280]">#{trip.order_number}</p>
                      <p className="text-xs text-[#6B7280]">{formatDateTime(trip.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#17201B]">{formatCurrency(trip.total)}</p>
                      <StatusBadge status={trip.status} />
                    </div>
                    <button
                      onClick={() => navigate('/tourist/transport')}
                      className="p-2 rounded-lg text-[#6B7280] hover:text-blue-500 hover:bg-blue-500/10 transition"
                      title="View Trip"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}

            {activeTab === 'bookings' && paginated.map((item) => {
              const booking = item as HistoryBooking
              return (
                <div
                  key={booking.id}
                  className="bg-white border border-[#E5E9E7] rounded-2xl p-4 flex items-center justify-between hover:shadow-md hover:border-[#087F3F]/30 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 bg-purple-500/10 rounded-xl flex items-center justify-center shrink-0">
                      <Building2 className="w-5 h-5 text-purple-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#17201B] truncate">{booking.business_name}</p>
                      <p className="text-xs text-[#6B7280]">#{booking.booking_number}</p>
                      <p className="text-xs text-[#6B7280]">{formatDateTime(booking.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-3">
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#17201B]">{formatCurrency(booking.total_amount)}</p>
                      <StatusBadge status={booking.status} />
                    </div>
                    <button
                      onClick={() => navigate(`/tourist/booking/${booking.id}`)}
                      className="p-2 rounded-lg text-[#6B7280] hover:text-purple-500 hover:bg-purple-500/10 transition"
                      title="View Booking"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-[#6B7280]">
                Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, items.length)} of {items.length}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-2 rounded-lg border border-[#E5E9E7] text-[#6B7280] hover:bg-[#E5E9E7] disabled:opacity-40 transition">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm text-[#6B7280]">Page {page} of {totalPages}</span>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-2 rounded-lg border border-[#E5E9E7] text-[#6B7280] hover:bg-[#E5E9E7] disabled:opacity-40 transition">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
