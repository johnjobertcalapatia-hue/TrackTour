import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDate } from '@/shared/utils'
import { MapPin, Navigation, X, Bike, Search, ArrowRight, Clock, CheckCircle2, XCircle } from 'lucide-react'
import BookRideSheet from '../components/BookRideSheet'

interface TripRow {
  id: number
  order_number: string
  status: string
  subtotal: number
  delivery_fee: number
  total: number
  payment_method: string
  created_at: string
  delivery_address: string | null
  delivery_latitude?: string | null
  delivery_longitude?: string | null
}

interface PendingBooking {
  destination: { name: string; address: string }
  distanceKm: number
  vehicle: string
}

const STATUS_INFO: Record<string, { label: string; ok?: boolean }> = {
  completed: { label: 'Completed', ok: true },
  delivered: { label: 'Completed', ok: true },
  cancelled: { label: 'Cancelled', ok: false },
  cancelled_by_tourist: { label: 'Cancelled', ok: false },
  searching: { label: 'Finding a Driver' },
  arriving: { label: 'Driver Arriving' },
  driver_arrived: { label: 'Driver Arrived' },
  in_progress: { label: 'Trip In Progress' },
}

function statusLabel(status: string): { label: string; ok?: boolean } {
  if (STATUS_INFO[status]) return STATUS_INFO[status]
  return { label: 'Active' }
}

const ACTIVE_RIDE_STATUSES = ['searching', 'arriving', 'assigned', 'driver_arrived', 'in_progress']

export default function TouristTransport() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [pendingBooking, setPendingBooking] = useState<PendingBooking | null>(null)
  const [rideSheetOpen, setRideSheetOpen] = useState(false)

  useEffect(() => {
    const raw = localStorage.getItem('tracktour_pending_booking')
    if (raw) {
      try {
        setPendingBooking(JSON.parse(raw))
      } catch { /* ignore */ }
      localStorage.removeItem('tracktour_pending_booking')
    }
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-transport'],
    queryFn: () => get<{ data: TripRow[] }>('/tourist/transport'),
  })

  if (isLoading) return <DashboardSkeleton />

  const rows = data?.data ?? []

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Ride Hailing</h1>
        <p className="mt-1 text-sm text-[#68736D]">Book a motorcycle, tricycle, car, or van ride around Oriental Mindoro</p>
      </div>

      {/* Active ride banner */}
      {(() => {
        const activeRide = rows.find((t) => ACTIVE_RIDE_STATUSES.includes(t.status))
        if (!activeRide) return null
        return (
          <button
            onClick={() => navigate(`/tourist/transport/tracking/${activeRide.id}`)}
            className="w-full mb-6 flex items-center gap-3 bg-[#E9F7EF] border border-[#087F3F]/30 rounded-2xl p-4 hover:border-[#087F3F]/60 transition-all"
          >
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#087F3F] opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#087F3F]" />
            </span>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-[#087F3F]">{statusLabel(activeRide.status).label}</p>
              <p className="text-xs text-[#68736D] truncate">
                {activeRide.delivery_address || 'Destination'} • {activeRide.order_number}
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-[#087F3F] shrink-0" />
          </button>
        )
      })()}

      {/* Booking CTA */}
      <div className="mb-6 bg-white rounded-2xl border border-[#E5E9E7] p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="w-8 h-8 rounded-lg bg-[#E9F7EF] flex items-center justify-center">
            <Bike className="w-4 h-4 text-[#087F3F]" />
          </span>
          <p className="text-sm font-semibold text-[#17201B]">Where are you going?</p>
        </div>
        <form
          className="flex flex-col sm:flex-row gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setRideSheetOpen(true)
          }}
        >
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9CA3AF]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a destination, hotel, resort or landmark"
              className="w-full pl-10 pr-4 py-3 bg-white border border-[#E5E9E7] rounded-xl text-sm text-[#17201B] placeholder-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#087F3F]/20 focus:border-[#087F3F] transition"
            />
          </div>
          <button
            type="submit"
            className="flex items-center justify-center gap-2 px-5 py-3 bg-[#087F3F] text-white rounded-xl hover:bg-[#056B35] transition-all text-sm font-medium"
          >
            Book a Ride <ArrowRight className="w-4 h-4" />
          </button>
        </form>
        <p className="text-[10px] text-[#9CA3AF] mt-2">
          Search, pick on the map, or choose a recent destination, then confirm your pickup point.
        </p>
      </div>

      {/* Pending Booking Card */}
      {pendingBooking && (
        <div className="mb-6 bg-white rounded-2xl border border-[#E5E9E7] p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-lg bg-[#E9F7EF] flex items-center justify-center">
                <Navigation className="w-4 h-4 text-[#087F3F]" />
              </span>
              <p className="text-sm font-semibold text-[#17201B]">Your Booking</p>
            </div>
            <button
              onClick={() => setPendingBooking(null)}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[#9CA3AF] hover:bg-[#E9F7EF] hover:text-[#68736D] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center gap-1 mt-1">
              <span className="w-2.5 h-2.5 rounded-full bg-[#087F3F] shrink-0" />
              <div className="w-px h-6 bg-[#E5E9E7]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#F4B400] shrink-0" />
            </div>
            <div className="flex flex-col gap-3 flex-1 min-w-0">
              <div>
                <p className="text-xs text-[#68736D]">From</p>
                <p className="text-sm font-medium text-[#17201B]">Your location</p>
              </div>
              <div>
                <p className="text-xs text-[#68736D]">To</p>
                <p className="text-sm font-medium text-[#17201B] truncate">
                  {pendingBooking.destination.name} — {pendingBooking.destination.address}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 mt-4 pt-3 border-t border-[#E5E9E7]">
            <div className="flex items-center gap-1.5">
              <Bike className="w-3.5 h-3.5 text-[#087F3F]" />
              <span className="text-xs text-[#68736D] capitalize">{pendingBooking.vehicle}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#F4B400]" />
              <span className="text-xs text-[#68736D]">{pendingBooking.distanceKm.toFixed(2)} km</span>
            </div>
          </div>
        </div>
      )}

      {/* Recent rides */}
      <div>
        <h2 className="text-sm font-semibold text-[#17201B] mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#087F3F]" /> Recent Rides
        </h2>

        {rows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#E5E9E7] p-12 text-center">
            <Bike className="w-12 h-12 text-[#C4CEC8] mx-auto mb-4" />
            <p className="text-[#68736D]">No rides yet.</p>
            <p className="text-xs text-[#9CA3AF] mt-1">Search for a destination above to book your first ride.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((trip) => {
              const info = statusLabel(trip.status)
              return (
                <button
                  key={trip.id}
                  onClick={() => navigate(`/tourist/transport/tracking/${trip.id}`)}
                  className="w-full text-left bg-white rounded-2xl border border-[#E5E9E7] p-5 hover:border-[#087F3F]/40 hover:shadow-sm transition-all duration-200"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-[#9CA3AF]">{trip.order_number}</span>
                    <span className="flex items-center gap-1.5 text-xs">
                      {info.ok === false ? (
                        <XCircle className="w-3.5 h-3.5 text-red-500" />
                      ) : info.ok === true ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#087F3F]" />
                      ) : (
                        <span className="w-3.5 h-3.5 rounded-full bg-[#087F3F] animate-pulse" />
                      )}
                      <span className={info.ok === false ? 'text-red-500' : 'text-[#087F3F]'}>{info.label}</span>
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1 mt-0.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-[#087F3F] shrink-0" />
                      <div className="w-px h-5 bg-[#E5E9E7]" />
                      <span className="w-2.5 h-2.5 rounded-full bg-[#F4B400] shrink-0" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#17201B] truncate">{trip.delivery_address || 'Destination'}</p>
                      <p className="text-xs text-[#9CA3AF] mt-0.5">{formatDate(trip.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#E5E9E7]">
                    <span className="text-sm font-bold text-[#087F3F]">{formatCurrency(trip.total)}</span>
                    <span className="text-xs text-[#68736D] capitalize">{trip.payment_method}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      <BookRideSheet
        isOpen={rideSheetOpen}
        onClose={() => setRideSheetOpen(false)}
        initialQuery={query || undefined}
      />
    </div>
  )
}