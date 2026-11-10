import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get } from '@/shared/services/api'
import { DashboardSkeleton } from '@/shared/components/Skeleton'
import { formatCurrency, formatDate } from '@/shared/utils'
import { MapPin, Navigation, X, Bike, Car, Bus, Search, ArrowRight, Clock, CheckCircle2, XCircle, ChevronRight, type LucideIcon } from 'lucide-react'
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

/** Handed over from the map's route card ("Book a Rider"). */
interface PendingBooking {
  destination: { name: string; address: string }
  distanceKm: number
  vehicle: string
  /** Destination coordinates (newer hand-offs): the booking starts at the pickup step. */
  lat?: number
  lng?: number
}

const PENDING_BOOKING_KEY = 'tracktour_pending_booking'

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

const VEHICLE_INFO: Record<string, { label: string; icon: LucideIcon }> = {
  motorcycle: { label: 'Motorcycle', icon: Bike },
  tricycle: { label: 'Tricycle', icon: Bike },
  car: { label: 'Car', icon: Car },
  van: { label: 'Van', icon: Bus },
}

function vehicleInfo(type: string): { label: string; icon: LucideIcon } {
  return VEHICLE_INFO[type] ?? { label: type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Ride', icon: Bike }
}

function readPendingBooking(): PendingBooking | null {
  const raw = localStorage.getItem(PENDING_BOOKING_KEY)
  if (!raw) return null
  localStorage.removeItem(PENDING_BOOKING_KEY)
  try {
    const parsed = JSON.parse(raw) as PendingBooking
    return parsed?.destination?.name ? parsed : null
  } catch {
    return null
  }
}

/** What the ride sheet opens with. */
type SheetSeed =
  | { kind: 'search'; query?: string }
  | { kind: 'booking'; booking: PendingBooking }

export default function TouristTransport() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [pendingBooking, setPendingBooking] = useState<PendingBooking | null>(null)
  const [sheet, setSheet] = useState<SheetSeed | null>(null)

  useEffect(() => {
    const booking = readPendingBooking()
    if (booking) setPendingBooking(booking)
  }, [])

  const { data, isLoading } = useQuery({
    queryKey: ['tourist-transport'],
    queryFn: () => get<{ data: TripRow[] }>('/tourist/transport'),
  })

  if (isLoading) return <DashboardSkeleton />

  const rows = data?.data ?? []
  const activeRide = rows.find((t) => ACTIVE_RIDE_STATUSES.includes(t.status))

  // The map's booking carries coordinates: continue at the pickup step.
  // Older hand-offs without them: search for the destination by name.
  const continueBooking = (booking: PendingBooking) => {
    if (booking.lat != null && booking.lng != null) setSheet({ kind: 'booking', booking })
    else setSheet({ kind: 'search', query: booking.destination.name })
  }
  const seededBooking = sheet?.kind === 'booking' ? sheet.booking : null

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl lg:text-3xl font-bold text-[#17201B]">Ride Hailing</h1>
        <p className="mt-1 text-sm text-[#68736D]">Book a motorcycle, tricycle, car, or van ride around Oriental Mindoro</p>
      </div>

      {/* Active ride banner */}
      {activeRide && (
        <button
          type="button"
          onClick={() => navigate(`/tourist/transport/tracking/${activeRide.id}`)}
          className="w-full mb-4 flex items-center gap-3 bg-[#E9F7EF] border border-[#087F3F]/30 rounded-2xl p-4 hover:border-[#087F3F]/60 transition-all"
        >
          <span className="relative flex h-3 w-3 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#087F3F] opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#087F3F]" />
          </span>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-[#087F3F]">{statusLabel(activeRide.status).label}</p>
            <p className="text-xs text-[#68736D] truncate">
              {activeRide.delivery_address || 'Destination'} • {activeRide.order_number}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-[#087F3F] shrink-0" />
        </button>
      )}

      {/* Trip handed over from the map: continue it instead of searching again. */}
      {pendingBooking && (() => {
        const vehicle = vehicleInfo(pendingBooking.vehicle)
        const VehicleIcon = vehicle.icon
        return (
          <section aria-label="Your trip" className="mb-4 bg-white rounded-2xl border border-[#087F3F]/30 shadow-sm p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center">
                  <Navigation className="w-4 h-4 text-[#087F3F]" aria-hidden="true" />
                </span>
                <div>
                  <h2 className="text-sm font-bold text-[#17201B]">Your trip</h2>
                  <p className="text-xs text-[#68736D]">Ready to book</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingBooking(null)}
                aria-label="Dismiss this trip"
                title="Dismiss"
                className="w-8 h-8 rounded-full flex items-center justify-center text-[#68736D] hover:bg-[#E9F7EF] hover:text-[#17201B] transition-colors"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <ol className="relative space-y-4 pl-6">
              <span className="absolute left-[5px] top-2 bottom-2 w-px bg-[#D7DED9]" aria-hidden="true" />
              <li className="relative">
                <span className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-[#087F3F] ring-4 ring-[#E9F7EF]" aria-hidden="true" />
                <p className="text-xs text-[#68736D]">From</p>
                <p className="text-sm font-semibold text-[#17201B]">Your location</p>
              </li>
              <li className="relative">
                <span className="absolute -left-6 top-1 w-3 h-3 rounded-full bg-[#F4B400] ring-4 ring-[#FEF6DD]" aria-hidden="true" />
                <p className="text-xs text-[#68736D]">To</p>
                <p className="text-sm font-semibold text-[#17201B] truncate">{pendingBooking.destination.name}</p>
                {pendingBooking.destination.address && (
                  <p className="text-xs text-[#68736D] truncate">{pendingBooking.destination.address}</p>
                )}
              </li>
            </ol>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F3F6F4] px-3 py-1 text-xs font-medium text-[#17201B]">
                <VehicleIcon className="w-3.5 h-3.5 text-[#087F3F]" aria-hidden="true" /> {vehicle.label}
              </span>
              {Number.isFinite(pendingBooking.distanceKm) && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#F3F6F4] px-3 py-1 text-xs font-medium text-[#17201B]">
                  <MapPin className="w-3.5 h-3.5 text-[#F4B400]" aria-hidden="true" /> {pendingBooking.distanceKm.toFixed(1)} km
                </span>
              )}
            </div>

            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setSheet({ kind: 'search' })}
                className="h-11 px-5 rounded-xl border border-[#E5E9E7] text-sm font-semibold text-[#17201B] hover:border-[#087F3F]/50 hover:bg-[#F3FAF6] transition"
              >
                Change destination
              </button>
              <button
                type="button"
                onClick={() => continueBooking(pendingBooking)}
                className="h-11 px-5 rounded-xl bg-[#087F3F] text-white text-sm font-semibold hover:bg-[#056B35] transition inline-flex items-center justify-center gap-2"
              >
                Continue booking <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </section>
        )
      })()}

      {/* Booking: where to? */}
      <section aria-label="Book a ride" className="mb-6 bg-white rounded-2xl border border-[#E5E9E7] p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-9 h-9 rounded-xl bg-[#E9F7EF] flex items-center justify-center">
            <Bike className="w-4 h-4 text-[#087F3F]" aria-hidden="true" />
          </span>
          <h2 className="text-sm font-bold text-[#17201B]">{pendingBooking ? 'Going somewhere else?' : 'Where are you going?'}</h2>
        </div>
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setSheet({ kind: 'search', query: query.trim() || undefined })
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8A948F]" aria-hidden="true" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search for a destination, hotel, resort or landmark"
              aria-label="Destination"
              // `!`: beats the global input rule (index.css, unlayered) so it matches the button.
              className="h-11 w-full pl-10 pr-4 rounded-xl! border! border-[#E5E9E7]! bg-white! shadow-none! text-sm text-[#17201B] placeholder:text-[#8A948F] focus:border-[#087F3F]! focus:ring-2 focus:ring-[#087F3F]/20 focus:outline-none transition"
            />
          </div>
          <button
            type="submit"
            className="h-11 shrink-0 inline-flex items-center justify-center gap-2 px-5 rounded-xl bg-[#087F3F] text-white text-sm font-semibold hover:bg-[#056B35] transition"
          >
            Book a Ride <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </form>
        <p className="mt-2.5 text-xs text-[#68736D]">
          Search, pick a spot on the map, or choose a recent destination, then confirm your pickup point.
        </p>
      </section>

      {/* Recent rides */}
      <section aria-label="Recent rides">
        <h2 className="text-sm font-bold text-[#17201B] mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4 text-[#087F3F]" aria-hidden="true" /> Recent Rides
        </h2>

        {rows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-[#D7DED9] px-6 py-8 text-center">
            <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F3F6F4]">
              <Bike className="w-6 h-6 text-[#8A948F]" aria-hidden="true" />
            </span>
            <p className="text-sm font-semibold text-[#17201B]">No rides yet</p>
            <p className="text-xs text-[#68736D] mt-1">Your rides will show here after you book one.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {rows.map((trip) => {
              const info = statusLabel(trip.status)
              return (
                <li key={trip.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/tourist/transport/tracking/${trip.id}`)}
                    className="group w-full text-left bg-white rounded-2xl border border-[#E5E9E7] p-4 hover:border-[#087F3F]/40 hover:shadow-sm transition-all duration-200"
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <span className="text-xs text-[#68736D]">{trip.order_number}</span>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          info.ok === false ? 'bg-red-50 text-red-600' : 'bg-[#E9F7EF] text-[#087F3F]'
                        }`}
                      >
                        {info.ok === false ? (
                          <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : info.ok === true ? (
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-[#087F3F] animate-pulse" aria-hidden="true" />
                        )}
                        {info.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#FEF6DD]">
                        <MapPin className="w-4 h-4 text-[#C98A00]" aria-hidden="true" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-[#17201B] truncate">{trip.delivery_address || 'Destination'}</p>
                        <p className="text-xs text-[#68736D] mt-0.5">{formatDate(trip.created_at)}</p>
                      </div>
                      <ChevronRight className="w-4 h-4 shrink-0 text-[#C4CEC8] group-hover:text-[#087F3F]" aria-hidden="true" />
                    </div>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#EEF1EF]">
                      <span className="text-sm font-bold text-[#087F3F]">{formatCurrency(trip.total)}</span>
                      <span className="text-xs text-[#68736D] capitalize">{trip.payment_method}</span>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <BookRideSheet
        isOpen={sheet != null}
        onClose={() => setSheet(null)}
        initialQuery={sheet?.kind === 'search' ? sheet.query : undefined}
        destination={seededBooking?.destination.name}
        destinationAddress={seededBooking?.destination.address}
        destinationCoords={seededBooking && seededBooking.lat != null && seededBooking.lng != null
          ? { lat: seededBooking.lat, lng: seededBooking.lng }
          : undefined}
        initialVehicle={seededBooking?.vehicle ?? pendingBooking?.vehicle}
      />
    </div>
  )
}
