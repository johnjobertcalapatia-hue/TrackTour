import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/shared/services/api'
import { StatusBadge } from '@/shared/components/StatusBadge'
import { formatCurrency, formatDateTime, cn } from '@/shared/utils'
import { Car, Building2, Eye, Star } from 'lucide-react'

interface TripItem {
  id: number
  type: 'transport' | 'booking'
  number: string
  business_name: string
  status: string
  total: number
  created_at: string
  check_in_date?: string
  check_out_date?: string
  is_rated?: boolean
}

type Tab = 'active' | 'upcoming' | 'done'

const TABS: { key: Tab; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'done', label: 'Done' },
]

const TYPE_ICONS = { transport: Car, booking: Building2 }
const TYPE_LABELS = { transport: 'Ride', booking: 'Resort' }
const TYPE_COLORS = { transport: 'text-[#0E7490]', booking: 'text-[#7C3AED]' }

export default function MyTrips() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<Tab>('active')

  const { data: transportData } = useQuery({
    queryKey: ['my-trips-v2', 'transport'],
    queryFn: () => get<{ trips: { data: TripItem[] } }>('/tourist/history?tab=transport'),
  })
  const { data: bookingsData } = useQuery({
    queryKey: ['my-trips-v2', 'bookings'],
    queryFn: () => get<{ bookings: { data: any[] } }>('/tourist/history?tab=bookings'),
  })

  const transport = (transportData?.trips?.data ?? []).map((t) => ({ ...t, type: 'transport' as const }))
  const bookings = (bookingsData?.bookings?.data ?? []).map((b) => ({ ...b, type: 'booking' as const, total: b.total_amount ?? 0 }))

  const allTrips = [...transport, ...bookings].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  const filterByTab = (trips: TripItem[]) => {
    if (activeTab === 'active')
      return trips.filter((t) =>
        ['pending', 'rider_assigned', 'arriving', 'in_progress', 'searching', 'driver_arrived'].includes(t.status)
      )
    if (activeTab === 'upcoming') return trips.filter((t) => ['ready_for_pickup', 'picked_up', 'out_for_delivery'].includes(t.status))
    return trips.filter((t) => ['delivered', 'completed', 'cancelled', 'cancelled_by_tourist', 'cancelled_by_rider'].includes(t.status))
  }

  const filtered = filterByTab(allTrips)

  const handleView = (trip: TripItem) => {
    if (trip.type === 'transport') navigate(`/tourist/transport/tracking/${trip.id}`)
    else navigate(`/tourist/stays/${trip.id}`)
  }

  return (
    <div className="space-y-4 px-4 pt-4 pb-4">
      <h1 className="text-xl lg:text-2xl font-bold text-[#17201B]">My Trips</h1>

      {/* Tabs */}
      <div className="flex gap-2">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={cn(
              'px-4 py-2 rounded-xl text-sm font-medium transition',
              activeTab === key ? 'bg-[#087F3F] text-white' : 'bg-white border border-[#E5E9E7] text-[#68736D] hover:text-[#17201B] hover:border-[#087F3F]/40'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Trip list */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Car className="w-12 h-12 text-[#9CA3AF] mx-auto mb-4" />
          <p className="text-[#68736D] font-medium">No {activeTab} trips</p>
          <p className="text-[#9CA3AF] text-sm mt-1">
            {activeTab === 'active' && 'Your active rides and bookings will appear here'}
            {activeTab === 'upcoming' && 'Ready for pickup trips will appear here'}
            {activeTab === 'done' && 'Completed trips will appear here'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((trip) => {
            const Icon = TYPE_ICONS[trip.type]
            return (
              <div
                key={`${trip.type}-${trip.id}`}
                className="bg-white border border-[#E5E9E7] rounded-2xl p-4 hover:border-[#087F3F]/40 transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-[#E9F7EF]', TYPE_COLORS[trip.type])}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[10px] text-[#68736D]">{TYPE_LABELS[trip.type]}</span>
                      <span className="text-[10px] text-[#9CA3AF]">·</span>
                      <span className="text-[10px] text-[#68736D]">#{trip.number}</span>
                    </div>
                    <p className="text-sm font-semibold text-[#17201B] truncate">{trip.business_name}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <StatusBadge status={trip.status} />
                      <span className="text-[10px] text-[#9CA3AF]">{formatDateTime(trip.created_at)}</span>
                    </div>
                    {trip.check_in_date && (
                      <p className="text-[10px] text-[#68736D] mt-1">{trip.check_in_date} → {trip.check_out_date || '—'}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <p className="text-sm font-bold text-[#17201B]">{formatCurrency(trip.total)}</p>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleView(trip)}
                        className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#087F3F] hover:bg-[#E9F7EF] transition"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {trip.status === 'delivered' && !trip.is_rated && (
                        <button
                          onClick={() => handleView(trip)}
                          className="p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#F4B400] hover:bg-[#F4B400]/10 transition"
                        >
                          <Star className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
